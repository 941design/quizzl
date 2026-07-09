/**
 * Unit tests for S5 (epic: contact-card-exchange) — group invite-by-card.
 *
 * Drives the REAL production down-conversion + invite orchestration exported
 * from InviteMemberModal.tsx (resolveInviteTarget, submitInvite — this
 * story's pure/async core, extracted per this repo's hooks-via-pure-
 * function-extraction convention, matching S4's processContactInput idiom).
 * No spy-only proxy over parseContactCard: every "no cache write" assertion
 * below reads real contactCache/contacts/knownPeers state
 * (readContactEntry / readStoredContacts / loadKnownPeers), matching
 * VQ-S5-001/004/006's "not merely asserting inviteByNpub was called"
 * requirement.
 *
 * Mocking: idb-keyval is Map-backed (not spied) and ndkClient is stubbed for
 * the same transitive-import reason as addContactCardWiring.test.ts —
 * InviteMemberModal.tsx imports useMarmot from MarmotContext, whose
 * transitive dependency groupStorage.ts calls idb-keyval's createStore() at
 * module load time.
 *
 * AC-GRP-2 / no_key_package test-seam note: no pre-existing unit test
 * exercises MarmotContext.inviteByNpub's no_key_package branch, and
 * MarmotContext.tsx is outside this story's file scope (sole production
 * file in scope is InviteMemberModal.tsx — see architecture.json
 * "notes.test_seam_decision"). AC-GRP-2 is verified as a PARITY property
 * instead: a stub inviteByNpub whose internal rule mirrors the real
 * function's actual decision (KeyPackage-set membership -> no_key_package,
 * exactly as MarmotContext.tsx's fetchEventsWithTimeout-empty-array check)
 * is invoked once via submitInvite with a bare npub for a KeyPackage-less
 * pubkey, and once via submitInvite with a card for the SAME pubkey. Both
 * calls must produce an identical (groupId, npub) argument pair and an
 * identical { ok: false, error: 'no_key_package' } result — proving the
 * down-conversion introduces zero divergence into the KeyPackage-dependency
 * path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

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

const { encodeCard, buildShareUrl, base64UrlToBytes, bytesToBase64Url } = await import('@/src/lib/contactCard');
const { createPrivateKeySigner } = await import('@/src/lib/marmot/signerAdapter');
const { readStoredContacts } = await import('@/src/lib/contacts');
const { readContactEntry } = await import('@/src/lib/contactCache');
const { loadKnownPeers } = await import('@/src/lib/knownPeers');
const { pubkeyToNpub, npubToPubkeyHex } = await import('@/src/lib/nostrKeys');
const { normaliseScanPayload } = await import('@/src/lib/qr');
// S5: pure/async core extracted from InviteMemberModal.tsx (this repo's
// convention — see AddContactModal.tsx / dmMessageEdits.test.ts precedent).
// Importing the component module does not mount React or touch the DOM.
const { resolveInviteTarget, submitInvite } = await import('@/src/components/groups/InviteMemberModal');

function makeIdentity() {
  const sk = generateSecretKey();
  const skHex = bytesToHex(sk);
  const pubkeyHex = getPublicKey(sk);
  const signer = createPrivateKeySigner(skHex);
  return { skHex, pubkeyHex, signer };
}

async function buildSignedCardPayload(
  pubkeyHex: string,
  signer: ReturnType<typeof createPrivateKeySigner>,
  nickname: string,
  createdAt: number,
): Promise<string> {
  return encodeCard(pubkeyHex, { nickname, createdAt }, signer.signEvent);
}

function tamperSignature(payload: string): string {
  const bytes = base64UrlToBytes(payload)!;
  const mutated = new Uint8Array(bytes);
  mutated[mutated.length - 1] = mutated[mutated.length - 1] ^ 0xff;
  return bytesToBase64Url(mutated);
}

beforeEach(() => {
  localStorageMock.clear();
  idbStore.clear();
});

const GROUP_ID = 'group-under-test';

// ── AC-GRP-1 — card down-conversion invites the card's pubkey, zero writes ─

describe('submitInvite — inviting via a card down-converts to pubkeyHex, zero contactCache/contacts/knownPeers writes (AC-GRP-1)', () => {
  it('invites the card pubkey from a pasted raw card payload and leaves the cache/contacts/knownPeers untouched for the invitee', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await buildSignedCardPayload(pubkeyHex, signer, 'Alice', 1735689600);
    const expectedNpub = pubkeyToNpub(pubkeyHex);

    const inviteByNpub = vi.fn(async (groupId: string, npub: string) => {
      expect(groupId).toBe(GROUP_ID);
      expect(npub).toBe(expectedNpub);
      return { ok: true };
    });

    const result = await submitInvite(payload, GROUP_ID, inviteByNpub);

    expect(result).toEqual({ ok: true });
    expect(inviteByNpub).toHaveBeenCalledTimes(1);
    expect(inviteByNpub).toHaveBeenCalledWith(GROUP_ID, expectedNpub);
    // The load-bearing DD-8 assertion: no cache/contacts/knownPeers write for
    // the invitee happened as a side effect of this invite.
    expect(readContactEntry(pubkeyHex)).toBeUndefined();
    expect(readStoredContacts()[pubkeyHex]).toBeUndefined();
    expect(loadKnownPeers().has(pubkeyHex)).toBe(false);
  });

  it('invites the card pubkey from a full onboarding card link and leaves the cache/contacts/knownPeers untouched', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await buildSignedCardPayload(pubkeyHex, signer, 'Bob', 1735689600);
    const link = buildShareUrl(payload);
    const expectedNpub = pubkeyToNpub(pubkeyHex);

    const inviteByNpub = vi.fn(async () => ({ ok: true }));

    const result = await submitInvite(link, GROUP_ID, inviteByNpub);

    expect(result).toEqual({ ok: true });
    expect(inviteByNpub).toHaveBeenCalledWith(GROUP_ID, expectedNpub);
    expect(readContactEntry(pubkeyHex)).toBeUndefined();
    expect(readStoredContacts()[pubkeyHex]).toBeUndefined();
    expect(loadKnownPeers().has(pubkeyHex)).toBe(false);
  });

  it('invites the card pubkey when the card arrives via the scanner validation seam (normaliseScanPayload, S4) before submitInvite runs — the real scan-to-invite path', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const link = buildShareUrl(await buildSignedCardPayload(pubkeyHex, signer, 'Carol', 1735689600));
    const expectedNpub = pubkeyToNpub(pubkeyHex);

    // Scan path: NpubQrScanner validates via normaliseScanPayload (the real
    // scan entry point, unchanged by this story) — its output is what lands
    // in npubInput via onScan, and the user then submits via handleInvite.
    const normalised = normaliseScanPayload(link);
    expect(normalised).not.toBeNull();

    const inviteByNpub = vi.fn(async () => ({ ok: true }));
    const result = await submitInvite(normalised!, GROUP_ID, inviteByNpub);

    expect(result).toEqual({ ok: true });
    expect(inviteByNpub).toHaveBeenCalledWith(GROUP_ID, expectedNpub);
    expect(readContactEntry(pubkeyHex)).toBeUndefined();
    expect(readStoredContacts()[pubkeyHex]).toBeUndefined();
    expect(loadKnownPeers().has(pubkeyHex)).toBe(false);
  });

  it('discards the card profile field entirely — an unsigned (pubkey-only) card and a signed card for the same pubkey resolve to the identical invite target', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const signedPayload = await buildSignedCardPayload(pubkeyHex, signer, 'Dana', 1735689600);
    // An unsigned card (empty nickname -> encodeCard emits pubkey-only, AC-CARD-6/DD-10).
    const unsignedPayload = await buildSignedCardPayload(pubkeyHex, signer, '', 1735689600);

    expect(resolveInviteTarget(signedPayload)).toEqual(resolveInviteTarget(unsignedPayload));
  });
});

// ── invalid card signature — hard failure, never a silent downgrade ────────

describe('submitInvite — a signature-invalid card is rejected before inviteByNpub is ever called', () => {
  it('returns invalid_npub, never invokes inviteByNpub, and writes nothing', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await buildSignedCardPayload(pubkeyHex, signer, 'Eve', 1735689600);
    const tampered = tamperSignature(payload);

    const inviteByNpub = vi.fn(async () => ({ ok: true }));
    const result = await submitInvite(tampered, GROUP_ID, inviteByNpub);

    expect(result).toEqual({ ok: false, error: 'invalid_npub' });
    expect(inviteByNpub).not.toHaveBeenCalled();
    expect(readContactEntry(pubkeyHex)).toBeUndefined();
    expect(readStoredContacts()[pubkeyHex]).toBeUndefined();
    expect(loadKnownPeers().has(pubkeyHex)).toBe(false);
  });

  it('also rejects a tampered card that reaches submitInvite via the scanner validation seam — normaliseScanPayload already rejects it, so it never lands in npubInput to begin with', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await buildSignedCardPayload(pubkeyHex, signer, 'Mallory', 1735689600);
    const tampered = tamperSignature(payload);

    expect(normaliseScanPayload(tampered)).toBeNull();
  });

  it('returns invalid_npub for unparseable garbage input, without throwing', async () => {
    const inviteByNpub = vi.fn(async () => ({ ok: true }));
    await expect(submitInvite('not-an-npub-or-card', GROUP_ID, inviteByNpub)).resolves.toEqual({
      ok: false,
      error: 'invalid_npub',
    });
    expect(inviteByNpub).not.toHaveBeenCalled();
  });
});

// ── bare npub — unchanged behavior ──────────────────────────────────────────

describe('submitInvite — a bare npub still invites exactly as before this story', () => {
  it('round-trips a bare npub unchanged through resolveInviteTarget and invites it', async () => {
    const pubkeyHex = 'a'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);

    expect(resolveInviteTarget(npub)).toEqual({ ok: true, npub });

    const inviteByNpub = vi.fn(async () => ({ ok: true }));
    const result = await submitInvite(npub, GROUP_ID, inviteByNpub);

    expect(result).toEqual({ ok: true });
    expect(inviteByNpub).toHaveBeenCalledWith(GROUP_ID, npub);
  });
});

// ── AC-GRP-2 — KeyPackage dependency unchanged (parity, see file header) ───

describe('submitInvite — KeyPackage dependency is unchanged by card down-conversion (AC-GRP-2, parity test)', () => {
  /**
   * Mirrors MarmotContext.inviteByNpub's actual decision rule (fetch the
   * invitee's KeyPackage events; an empty result -> { ok: false, error:
   * 'no_key_package' }), scoped to a fixed set of pubkeys that "have" a
   * published KeyPackage. This is the parity stub described in
   * architecture.json's notes.test_seam_decision — its job is to prove the
   * down-conversion is behaviorally inert on this path, not to fabricate an
   * arbitrary canned result.
   */
  function makeKeyPackageAwareInviteByNpub(pubkeysWithKeyPackage: ReadonlySet<string>) {
    const calls: Array<{ groupId: string; npub: string }> = [];
    const inviteByNpub = vi.fn(async (groupId: string, npub: string) => {
      calls.push({ groupId, npub });
      const pk = npubToPubkeyHex(npub);
      if (!pk || !pubkeysWithKeyPackage.has(pk)) {
        return { ok: false, error: 'no_key_package' };
      }
      return { ok: true };
    });
    return { inviteByNpub, calls };
  }

  it('a card for a KeyPackage-less pubkey fails identically (same error, same underlying npub) to a bare-npub invite for the same pubkey', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await buildSignedCardPayload(pubkeyHex, signer, 'Frank', 1735689600);
    const npub = pubkeyToNpub(pubkeyHex);

    // No KeyPackage published for this pubkey (empty set).
    const npubRun = makeKeyPackageAwareInviteByNpub(new Set());
    const npubResult = await submitInvite(npub, GROUP_ID, npubRun.inviteByNpub);

    const cardRun = makeKeyPackageAwareInviteByNpub(new Set());
    const cardResult = await submitInvite(payload, GROUP_ID, cardRun.inviteByNpub);

    expect(npubResult).toEqual({ ok: false, error: 'no_key_package' });
    expect(cardResult).toEqual(npubResult);
    // Parity: both paths reached the invite call with the identical
    // (groupId, npub) argument pair — the card does not substitute for or
    // otherwise alter the KeyPackage-dependent invite call.
    expect(cardRun.calls).toEqual(npubRun.calls);
    expect(cardRun.calls).toEqual([{ groupId: GROUP_ID, npub }]);
  });

  it('the same pubkey succeeds once a KeyPackage is present, via either a bare npub or a card', async () => {
    const { pubkeyHex, signer } = makeIdentity();
    const payload = await buildSignedCardPayload(pubkeyHex, signer, 'Grace', 1735689600);
    const npub = pubkeyToNpub(pubkeyHex);

    const hasKeyPackage = new Set([pubkeyHex]);
    const npubRun = makeKeyPackageAwareInviteByNpub(hasKeyPackage);
    const cardRun = makeKeyPackageAwareInviteByNpub(hasKeyPackage);

    await expect(submitInvite(npub, GROUP_ID, npubRun.inviteByNpub)).resolves.toEqual({ ok: true });
    await expect(submitInvite(payload, GROUP_ID, cardRun.inviteByNpub)).resolves.toEqual({ ok: true });
  });
});
