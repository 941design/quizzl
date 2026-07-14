/**
 * Unit tests for `wipeSinglePeerHistory` / `HistoryWipeResult` — the S3
 * single-peer history-wipe helper (epic-block-contact).
 *
 * Covers AC-WIPE-1 through AC-WIPE-6:
 *   AC-WIPE-1 — clearMessages(directConversationId(peer)) deletes the
 *               idb-keyval thread record.
 *   AC-WIPE-2 — clearDirectMessageContact(peer) clears the unread counter
 *               and last-read timestamp.
 *   AC-WIPE-3 — the StoredContact record is never touched by this helper
 *               (contact retention is the caller's concern — archiveContact,
 *               invoked by S4 before this helper).
 *   AC-WIPE-4 — the storage key is derived exclusively via
 *               directConversationId, never a hand-built `dm:<peer>` literal.
 *   AC-WIPE-5 — a thrown/rejected error from either call is logged and
 *               swallowed; the helper never throws, and a failure in one
 *               call does not prevent the other from running.
 *   AC-WIPE-6 — an in-flight appendMessage write for the peer's thread does
 *               not resurrect the thread key once the wipe settles.
 *
 * Gate-remediation finding 4 (2026-07-14): the wipe's THIRD step,
 * `reactions/api.ts#clearDmReactionsForPeer`, deletes the DM reaction
 * aggregate (`few:reactions:dm:<peerHexLower>`) so it no longer survives a
 * block — DD-3 "permanently deletes the locally stored DM history" covers
 * reactions too. Covered below under "reaction-aggregate deletion".
 *
 * Follows chatPersistence-purge.test.ts's conventions: Map-backed idb-keyval
 * mock, a minimal localStorage mock, real (non-mocked) imports of the SUT
 * and its collaborators wherever no fault injection is required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Shared test pubkeys ────────────────────────────────────────────────────

const PEER_HEX = 'ee'.repeat(32);
const OTHER_PEER_HEX = 'ff'.repeat(32);

// ── idb-keyval mock (Map-backed, shared store) ─────────────────────────────

const idbStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); }),
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  delMany: vi.fn(async (ks: string[]) => { ks.forEach((k) => idbStore.delete(k)); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
}));

// ── localStorage mock ───────────────────────────────────────────────────────

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => lsStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { lsStore.set(key, value); }),
  removeItem: vi.fn((key: string) => { lsStore.delete(key); }),
  clear: vi.fn(() => { lsStore.clear(); }),
  get length() { return lsStore.size; },
  key: vi.fn((i: number) => [...lsStore.keys()][i] ?? null),
};
vi.stubGlobal('localStorage', localStorageMock);

// ── unreadStore mock: wraps the REAL clearDirectMessageContact so normal
// behavior is unchanged, but lets individual tests force a throw via
// mockImplementationOnce (AC-WIPE-5's storage-failure simulation). ─────────

vi.mock('@/src/lib/unreadStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/unreadStore')>();
  return {
    ...actual,
    clearDirectMessageContact: vi.fn(actual.clearDirectMessageContact),
  };
});

// ── SUT + collaborator imports (after mocks are declared) ──────────────────

const { wipeSinglePeerHistory, appendMessage } = await import('@/src/lib/marmot/chatPersistence');
const { directConversationId } = await import('@/src/lib/directMessages');
const {
  incrementDirectMessage,
  getDirectMessageLastReadAt,
  markDirectMessagesRead,
  clearDirectMessageContact,
} = await import('@/src/lib/unreadStore');
const { readStoredContacts, rememberContact, archiveContact } = await import('@/src/lib/contacts');

beforeEach(() => {
  idbStore.clear();
  lsStore.clear();
  // vi.clearAllMocks() clears call history only, never the base implementation
  // (`actual.clearDirectMessageContact`, wired at vi.fn() creation time above)
  // or a still-pending mockImplementationOnce queue — so it is safe here and
  // does not need re-wiring per test.
  vi.clearAllMocks();
});

afterEach(() => {
  idbStore.clear();
  lsStore.clear();
});

// ─── AC-WIPE-1 / AC-WIPE-4 — thread deletion via directConversationId only ─

describe('wipeSinglePeerHistory — AC-WIPE-1 / AC-WIPE-4: thread deletion', () => {
  it('deletes the idb-keyval thread record at the directConversationId-derived key', async () => {
    const threadId = directConversationId(PEER_HEX);
    const key = `few:messages:${threadId}`;
    idbStore.set(key, [{ id: 'm1', content: 'hi', senderPubkey: PEER_HEX, groupId: threadId, createdAt: 1000 }]);

    await wipeSinglePeerHistory(PEER_HEX);

    expect(idbStore.has(key)).toBe(false);
  });

  it('derives the key exclusively via directConversationId — mixed-case input still resolves to the lowercase key', async () => {
    const mixedCase = PEER_HEX.slice(0, 10).toUpperCase() + PEER_HEX.slice(10);
    const lowerKey = `few:messages:${directConversationId(PEER_HEX)}`;
    idbStore.set(lowerKey, [{ id: 'm1', content: 'hi', senderPubkey: PEER_HEX, groupId: directConversationId(PEER_HEX), createdAt: 1000 }]);

    await wipeSinglePeerHistory(mixedCase);

    expect(idbStore.has(lowerKey)).toBe(false);
  });

  it('does not touch a different peer\'s thread record', async () => {
    const otherKey = `few:messages:${directConversationId(OTHER_PEER_HEX)}`;
    idbStore.set(otherKey, [{ id: 'm2', content: 'keep', senderPubkey: OTHER_PEER_HEX, groupId: directConversationId(OTHER_PEER_HEX), createdAt: 1000 }]);

    await wipeSinglePeerHistory(PEER_HEX);

    expect(idbStore.has(otherKey)).toBe(true);
  });
});

// ─── AC-WIPE-2 — unread counter + last-read clearing ───────────────────────

describe('wipeSinglePeerHistory — AC-WIPE-2: unread counter + last-read clearing', () => {
  it('clears the unread counter and last-read timestamp for the peer', async () => {
    incrementDirectMessage(PEER_HEX);
    markDirectMessagesRead(PEER_HEX);
    expect(getDirectMessageLastReadAt(PEER_HEX)).toBeGreaterThan(0);

    await wipeSinglePeerHistory(PEER_HEX);

    expect(getDirectMessageLastReadAt(PEER_HEX)).toBe(0);
  });

  it('leaves another peer\'s unread counter/last-read untouched', async () => {
    incrementDirectMessage(OTHER_PEER_HEX);
    markDirectMessagesRead(OTHER_PEER_HEX);
    const otherLastRead = getDirectMessageLastReadAt(OTHER_PEER_HEX);
    expect(otherLastRead).toBeGreaterThan(0);

    await wipeSinglePeerHistory(PEER_HEX);

    expect(getDirectMessageLastReadAt(OTHER_PEER_HEX)).toBe(otherLastRead);
  });
});

// ─── AC-WIPE-3 — contact retention: helper never touches lp_contacts_v1 ────

describe('wipeSinglePeerHistory — AC-WIPE-3: contact retention', () => {
  it('leaves the StoredContact record (and its archivedAt) completely unchanged', async () => {
    rememberContact(PEER_HEX, '2020-01-01T00:00:00.000Z');
    archiveContact(PEER_HEX, '2021-06-01T00:00:00.000Z');
    const before = readStoredContacts()[PEER_HEX];
    expect(before.archivedAt).toBe('2021-06-01T00:00:00.000Z');

    await wipeSinglePeerHistory(PEER_HEX);

    const after = readStoredContacts()[PEER_HEX];
    expect(after).toEqual(before);
  });

  it('does not create a StoredContact entry when none existed', async () => {
    await wipeSinglePeerHistory(PEER_HEX);
    expect(readStoredContacts()[PEER_HEX]).toBeUndefined();
  });
});

// ─── AC-WIPE-5 — storage-failure resilience ────────────────────────────────

describe('wipeSinglePeerHistory — AC-WIPE-5: storage-failure resilience', () => {
  it('when clearMessages/idb del() throws, still runs the counters clear, logs, and never throws out', async () => {
    const idb = await import('idb-keyval');
    vi.mocked(idb.del).mockRejectedValueOnce(new Error('quota exceeded'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    incrementDirectMessage(PEER_HEX);
    markDirectMessagesRead(PEER_HEX);

    const result = await wipeSinglePeerHistory(PEER_HEX);

    expect(result.threadCleared).toBe(false);
    expect(result.countersCleared).toBe(true);
    // The mockRejectedValueOnce above is consumed by clearMessages's own
    // del() call (the first of the two del() calls this wipe now makes) —
    // clearDmReactionsForPeer's del() call is unaffected and still succeeds.
    expect(result.reactionsCleared).toBe(true);
    expect(getDirectMessageLastReadAt(PEER_HEX)).toBe(0);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('when clearDirectMessageContact throws, still clears the thread record, logs, and never throws out', async () => {
    const threadId = directConversationId(PEER_HEX);
    const key = `few:messages:${threadId}`;
    idbStore.set(key, [{ id: 'm1', content: 'hi', senderPubkey: PEER_HEX, groupId: threadId, createdAt: 1000 }]);

    vi.mocked(clearDirectMessageContact).mockImplementationOnce(() => {
      throw new Error('localStorage quota exceeded');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await wipeSinglePeerHistory(PEER_HEX);

    expect(result.threadCleared).toBe(true);
    expect(result.countersCleared).toBe(false);
    expect(result.reactionsCleared).toBe(true);
    expect(idbStore.has(key)).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('never rejects even when all three calls fail (clearMessages, clearDirectMessageContact, clearDmReactionsForPeer)', async () => {
    const idb = await import('idb-keyval');
    // clearDmReactionsForPeer now deletes via an enumerate-then-delMany()
    // pass (case-insensitive fix), not a single del() call — so the
    // thread-key delete (clearMessages, still a single del()) and the
    // reaction-key delete (clearDmReactionsForPeer, now delMany()) are
    // failed independently via *Once() rejections on their respective mocks.
    // Each is a *Once() — NOT a persistent mockRejectedValue — so the mock's
    // implementation reverts to the shared base (successful) behavior
    // afterward and doesn't leak into later tests, since this suite's
    // beforeEach only calls vi.clearAllMocks() (clears call history, not
    // queued *Once() implementations).
    //
    // A reaction key must exist for PEER_HEX or clearDmReactionsForPeer's
    // enumerate pass finds nothing to delete and short-circuits before ever
    // calling delMany() (a true no-op success, not a failure to inject).
    idbStore.set(`few:reactions:dm:${PEER_HEX}`, [
      { id: 'r-fail', messageId: 'm-fail', reactorPubkey: PEER_HEX, emoji: '😢', eventId: 'e-fail', createdAt: 1000, removed: false },
    ]);
    vi.mocked(idb.del).mockRejectedValueOnce(new Error('quota exceeded'));
    vi.mocked(idb.delMany).mockRejectedValueOnce(new Error('quota exceeded'));
    vi.mocked(clearDirectMessageContact).mockImplementationOnce(() => {
      throw new Error('localStorage quota exceeded');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(wipeSinglePeerHistory(PEER_HEX)).resolves.toEqual({
      threadCleared: false,
      countersCleared: false,
      reactionsCleared: false,
    });
  });

  it('a wipe failure does not prevent the block action from setting archivedAt (simulated caller sequence)', async () => {
    const idb = await import('idb-keyval');
    vi.mocked(idb.del).mockRejectedValueOnce(new Error('quota exceeded'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    rememberContact(PEER_HEX, '2020-01-01T00:00:00.000Z');
    // Caller (S4) sets archivedAt via archiveContact BEFORE invoking the wipe —
    // this test proves the wipe's own failure cannot roll that back.
    archiveContact(PEER_HEX, '2022-01-01T00:00:00.000Z');

    await wipeSinglePeerHistory(PEER_HEX);

    expect(readStoredContacts()[PEER_HEX].archivedAt).toBe('2022-01-01T00:00:00.000Z');
  });
});

// ─── AC-WIPE-6 — in-flight appendMessage drain ─────────────────────────────

describe('wipeSinglePeerHistory — AC-WIPE-6: in-flight write drain', () => {
  it('an appendMessage in flight at block time does not resurrect the thread key once the wipe settles', async () => {
    const threadId = directConversationId(PEER_HEX);
    const key = `few:messages:${threadId}`;

    // Start an in-flight append WITHOUT awaiting it, then immediately trigger
    // the wipe — simulating a message arriving at the exact moment block is
    // triggered. Both promises are then allowed to settle in either order.
    const appendPromise = appendMessage(threadId, {
      id: 'inflight-msg',
      content: 'racing write',
      senderPubkey: PEER_HEX,
      groupId: threadId,
      createdAt: Date.now(),
    });
    const wipePromise = wipeSinglePeerHistory(PEER_HEX);

    await Promise.all([appendPromise, wipePromise]);

    expect(idbStore.has(key)).toBe(false);
  });

  it('documents FIFO ordering: a write enqueued AFTER the wipe already started is outside the in-flight guarantee and does land (AC-WIPE-6 covers only writes in flight before the wipe)', async () => {
    const threadId = directConversationId(PEER_HEX);
    const key = `few:messages:${threadId}`;

    // Reverse start order: wipe first, then an append enqueued on the same
    // per-thread queue immediately after — the queue serializes them, so the
    // append (queued after wipe's clearMessages turn) must not leave a
    // resurrected row once both settle.
    const wipePromise = wipeSinglePeerHistory(PEER_HEX);
    const appendPromise = appendMessage(threadId, {
      id: 'post-wipe-enqueued-msg',
      content: 'queued right after wipe started',
      senderPubkey: PEER_HEX,
      groupId: threadId,
      createdAt: Date.now(),
    });

    await Promise.all([wipePromise, appendPromise]);

    // The append was enqueued strictly after the wipe's clearMessages turn on
    // the same per-thread queue, so it is expected to land AFTER the delete —
    // this assertion documents the queue's actual FIFO ordering guarantee
    // rather than asserting an unconditional absence regardless of enqueue
    // order (that stronger claim only holds for writes already in flight
    // *before* the wipe is triggered, covered by the previous test).
    expect(idbStore.has(key)).toBe(true);
  });
});

// ─── HistoryWipeResult contract (consumed by S4) ───────────────────────────

describe('wipeSinglePeerHistory — HistoryWipeResult contract', () => {
  it('resolves { threadCleared: true, countersCleared: true, reactionsCleared: true } on full success', async () => {
    await expect(wipeSinglePeerHistory(PEER_HEX)).resolves.toEqual({
      threadCleared: true,
      countersCleared: true,
      reactionsCleared: true,
    });
  });
});

// ─── Gate-remediation finding 4 — DM reaction-aggregate deletion ──────────

describe('wipeSinglePeerHistory — reaction-aggregate deletion (gate-remediation finding 4)', () => {
  it('deletes the few:reactions:dm:<peer> aggregate key', async () => {
    const reactionKey = `few:reactions:dm:${PEER_HEX}`;
    idbStore.set(reactionKey, [
      { id: 'r1', messageId: 'm1', reactorPubkey: PEER_HEX, emoji: '👍', eventId: 'e1', createdAt: 1000, removed: false },
    ]);

    await wipeSinglePeerHistory(PEER_HEX);

    expect(idbStore.has(reactionKey)).toBe(false);
  });

  it('does not touch a different peer\'s reaction aggregate', async () => {
    const otherReactionKey = `few:reactions:dm:${OTHER_PEER_HEX}`;
    idbStore.set(otherReactionKey, [
      { id: 'r2', messageId: 'm2', reactorPubkey: OTHER_PEER_HEX, emoji: '❤️', eventId: 'e2', createdAt: 1000, removed: false },
    ]);

    await wipeSinglePeerHistory(PEER_HEX);

    expect(idbStore.has(otherReactionKey)).toBe(true);
  });

  it('does not touch the few:reactions:group: namespace', async () => {
    const groupReactionKey = 'few:reactions:group:some-group-id';
    idbStore.set(groupReactionKey, [
      { id: 'r3', messageId: 'm3', reactorPubkey: PEER_HEX, emoji: '🎉', eventId: 'e3', createdAt: 1000, removed: false },
    ]);

    await wipeSinglePeerHistory(PEER_HEX);

    expect(idbStore.has(groupReactionKey)).toBe(true);
  });

  it('normalizes mixed-case input to the lowercase reaction key (matches AC-WIPE-4\'s discipline)', async () => {
    const mixedCase = PEER_HEX.slice(0, 10).toUpperCase() + PEER_HEX.slice(10);
    const lowerReactionKey = `few:reactions:dm:${PEER_HEX}`;
    idbStore.set(lowerReactionKey, [
      { id: 'r4', messageId: 'm4', reactorPubkey: PEER_HEX, emoji: '🙂', eventId: 'e4', createdAt: 1000, removed: false },
    ]);

    await wipeSinglePeerHistory(mixedCase);

    expect(idbStore.has(lowerReactionKey)).toBe(false);
  });

  it('reactionsCleared is false, and threadCleared/countersCleared still succeed, when only the reaction-key delete fails', async () => {
    const reactionKey = `few:reactions:dm:${PEER_HEX}`;
    idbStore.set(reactionKey, [
      { id: 'r5', messageId: 'm5', reactorPubkey: PEER_HEX, emoji: '😀', eventId: 'e5', createdAt: 1000, removed: false },
    ]);
    const idb = await import('idb-keyval');
    // clearMessages's del() call (thread-key delete) behaves normally;
    // clearDmReactionsForPeer's delMany() call (reaction-key delete) is the
    // one that fails — isolates the failure to reactionsCleared only.
    vi.mocked(idb.delMany).mockRejectedValueOnce(new Error('quota exceeded'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await wipeSinglePeerHistory(PEER_HEX);

    expect(result.threadCleared).toBe(true);
    expect(result.countersCleared).toBe(true);
    expect(result.reactionsCleared).toBe(false);
    expect(idbStore.has(reactionKey)).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
