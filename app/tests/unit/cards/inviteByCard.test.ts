/**
 * Unit tests for S2 (epic: invite-group-member-from-contacts) — group
 * invite-by-picker.
 *
 * Drives the REAL production down-conversion + invite orchestration exported
 * from InviteMemberModal.tsx (resolveInviteTarget, submitInvite — this
 * story's pure/async core, extracted per this repo's hooks-via-pure-
 * function-extraction convention, matching S4/S5's processContactInput /
 * card-invite idiom).
 *
 * Reshape note (DD-11, AC-STRUCT-2): prior to this story these two functions
 * accepted arbitrary free-text/card/link input and routed it through
 * parseContactCard (app/src/lib/contactCard.ts) — the app's single npub/card
 * decode seam (DD-1 of epic-contact-card-exchange). The invite-modal picker
 * now supplies a pubkey directly (sourced from a stored ContactListItem via
 * S1's selectableContactsForGroup predicate), so resolveInviteTarget's job
 * narrows to re-encoding that pubkeyHex to canonical npub form — it no
 * longer parses free text, cards, links, or scanner payloads, and this file
 * no longer exercises that surface (card/QR/tampered-signature tests removed
 * per AC-STRUCT-2 — that coverage lives at parseContactCard's own call sites,
 * unaffected by this epic).
 *
 * Mocking: idb-keyval is Map-backed (not spied) and ndkClient is stubbed for
 * the same transitive-import reason as addContactCardWiring.test.ts —
 * InviteMemberModal.tsx imports useMarmot from MarmotContext, whose
 * transitive dependency groupStorage.ts calls idb-keyval's createStore() at
 * module load time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const idbStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => {
    idbStore.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idbStore.delete(key);
  }),
  delMany: vi.fn(async (ks: string[]) => {
    ks.forEach((k) => idbStore.delete(k));
  }),
  keys: vi.fn(async () => [...idbStore.keys()]),
  createStore: vi.fn(() => ({})),
}));

vi.mock('@/src/lib/ndkClient', () => ({
  getNdk: vi.fn(),
  connectNdk: vi.fn(),
}));

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// ── Module imports (after mocks are set up) ────────────────────────────────

const { readStoredContacts } = await import('@/src/lib/contacts');
const { readContactEntry } = await import('@/src/lib/contactCache');
const { loadKnownPeers } = await import('@/src/lib/knownPeers');
const { pubkeyToNpub } = await import('@/src/lib/nostrKeys');
// S2: pure/async core extracted from InviteMemberModal.tsx (this repo's
// convention — see AddContactModal.tsx / dmMessageEdits.test.ts precedent).
// Importing the component module does not mount React or touch the DOM.
const { resolveInviteTarget, submitInvite } = await import('@/src/components/groups/InviteMemberModal');

function makePubkeyHex(): string {
  const sk = generateSecretKey();
  return getPublicKey(sk);
}

beforeEach(() => {
  localStorageMock.clear();
  idbStore.clear();
});

const GROUP_ID = 'group-under-test';

// ── resolveInviteTarget — pubkeyHex-in, npub-out ────────────────────────────

describe('resolveInviteTarget — converts a stored contact pubkeyHex to its canonical npub', () => {
  it('resolves a valid 64-char hex pubkey to pubkeyToNpub(pubkeyHex)', () => {
    const pubkeyHex = makePubkeyHex();
    expect(resolveInviteTarget(pubkeyHex)).toEqual({ ok: true, npub: pubkeyToNpub(pubkeyHex) });
  });

  it('resolves an uppercase-hex pubkey identically to its lowercase form', () => {
    const pubkeyHex = makePubkeyHex();
    expect(resolveInviteTarget(pubkeyHex.toUpperCase())).toEqual(resolveInviteTarget(pubkeyHex));
  });

  it('rejects an empty string as invalid_npub, without throwing', () => {
    expect(resolveInviteTarget('')).toEqual({ ok: false, error: 'invalid_npub' });
  });

  it('rejects a malformed/short pubkeyHex as invalid_npub, without throwing', () => {
    expect(resolveInviteTarget('not-a-pubkey')).toEqual({ ok: false, error: 'invalid_npub' });
    expect(resolveInviteTarget('a'.repeat(63))).toEqual({ ok: false, error: 'invalid_npub' });
  });

  /**
   * The validation must match the FULL 64-hex string, not merely contain a
   * 64-hex substring — a longer string with valid-hex padding on either
   * side must still be rejected. No AC pins this exact-match/anchoring
   * contract (filed as a spec-gap finding); worth asserting anyway since
   * this is identity-shaped input validation.
   */
  it('rejects a 64-hex substring padded with extra leading or trailing characters', () => {
    const validHex = 'a'.repeat(64);
    expect(resolveInviteTarget(`${validHex}x`)).toEqual({ ok: false, error: 'invalid_npub' });
    expect(resolveInviteTarget(`x${validHex}`)).toEqual({ ok: false, error: 'invalid_npub' });
  });
});

// ── submitInvite — happy path, zero contactCache/contacts/knownPeers writes ─

describe('submitInvite — invites the resolved npub for a valid pubkeyHex, zero contactCache/contacts/knownPeers writes', () => {
  it('invites the derived npub and leaves the cache/contacts/knownPeers untouched for the invitee', async () => {
    const pubkeyHex = makePubkeyHex();
    const expectedNpub = pubkeyToNpub(pubkeyHex);

    const inviteByNpub = vi.fn(async (groupId: string, npub: string) => {
      expect(groupId).toBe(GROUP_ID);
      expect(npub).toBe(expectedNpub);
      return { ok: true };
    });

    const result = await submitInvite(pubkeyHex, GROUP_ID, inviteByNpub);

    expect(result).toEqual({ ok: true });
    expect(inviteByNpub).toHaveBeenCalledTimes(1);
    expect(inviteByNpub).toHaveBeenCalledWith(GROUP_ID, expectedNpub);
    expect(readContactEntry(pubkeyHex)).toBeUndefined();
    expect(readStoredContacts()[pubkeyHex]).toBeUndefined();
    expect(loadKnownPeers().has(pubkeyHex)).toBe(false);
  });
});

// ── invalid pubkeyHex — hard failure, never a silent downgrade ─────────────

describe('submitInvite — an invalid pubkeyHex is rejected before inviteByNpub is ever called', () => {
  it('returns invalid_npub and never invokes inviteByNpub for garbage input', async () => {
    const inviteByNpub = vi.fn(async () => ({ ok: true }));
    await expect(submitInvite('not-a-pubkey', GROUP_ID, inviteByNpub)).resolves.toEqual({
      ok: false,
      error: 'invalid_npub',
    });
    expect(inviteByNpub).not.toHaveBeenCalled();
  });

  it('returns invalid_npub and never invokes inviteByNpub for an empty pubkeyHex', async () => {
    const inviteByNpub = vi.fn(async () => ({ ok: true }));
    await expect(submitInvite('', GROUP_ID, inviteByNpub)).resolves.toEqual({
      ok: false,
      error: 'invalid_npub',
    });
    expect(inviteByNpub).not.toHaveBeenCalled();
  });
});

// ── inviteByNpub failure results are forwarded verbatim ────────────────────

describe('submitInvite — forwards inviteByNpub failure results verbatim (AC-UX-5 mapping surface)', () => {
  it.each([
    ['no_key_package', { ok: false, error: 'no_key_package' }],
    ['offline', { ok: false, error: 'offline' }],
    ['timeout', { ok: false, error: 'timeout' }],
  ] as const)('forwards a %s failure unchanged', async (_label, expected) => {
    const pubkeyHex = makePubkeyHex();
    const inviteByNpub = vi.fn(async () => expected);
    await expect(submitInvite(pubkeyHex, GROUP_ID, inviteByNpub)).resolves.toEqual(expected);
  });
});
