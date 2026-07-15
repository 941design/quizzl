import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Mock idb-keyval — Map-backed so chatPersistence.ts's `appendMessage` (used by
// several tests below to seed persisted DM history the way a real received DM
// would) and unreadStore.ts's own raw `idb-keyval` reads (both
// `initDirectMessageCounts` and `reconcileConfirmedContactDirectMessageCount`,
// epic: pending-contact-confirmation, S2 gate-remediation) share the same fake
// store as the bottom-of-file reconciliation tests, which grab `idb.get`
// directly and temporarily override its implementation.
const idbStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); }),
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  delMany: vi.fn(async (ks: string[]) => { ks.forEach((k) => idbStore.delete(k)); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
}));

// Mock react — useSyncExternalStore just calls getSnapshot
vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: any, getSnapshot: any) => getSnapshot(),
}));

beforeEach(() => {
  localStorageMock.clear();
  idbStore.clear();
});

describe('unreadStore join request counters', () => {
  // We import once — module state persists across tests in same describe,
  // but that's fine since we test incremental behavior.
  // For isolation we test sequences within individual tests.

  it('incrementJoinRequest increases counter for a group', async () => {
    const {
      incrementJoinRequest,
      markJoinRequestsRead,
      clearJoinRequestGroup,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    // Reset any prior state by clearing
    clearJoinRequestGroup('group-a');
    clearJoinRequestGroup('group-b');

    incrementJoinRequest('group-a');
    const s1 = useUnreadCounts();
    expect(s1.joinRequests['group-a']).toBe(1);

    incrementJoinRequest('group-a');
    const s2 = useUnreadCounts();
    expect(s2.joinRequests['group-a']).toBe(2);

    incrementJoinRequest('group-b');
    const s3 = useUnreadCounts();
    expect(s3.joinRequests['group-b']).toBe(1);
    expect(s3.joinRequests['group-a']).toBe(2);
  });

  it('markJoinRequestsRead resets counter to 0', async () => {
    const {
      incrementJoinRequest,
      markJoinRequestsRead,
      clearJoinRequestGroup,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    clearJoinRequestGroup('group-c');
    incrementJoinRequest('group-c');
    incrementJoinRequest('group-c');
    incrementJoinRequest('group-c');

    markJoinRequestsRead('group-c');
    const s = useUnreadCounts();
    expect(s.joinRequests['group-c']).toBeUndefined();
  });

  it('clearJoinRequestGroup removes tracking', async () => {
    const {
      incrementJoinRequest,
      clearJoinRequestGroup,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    clearJoinRequestGroup('group-d');
    incrementJoinRequest('group-d');
    incrementJoinRequest('group-d');

    clearJoinRequestGroup('group-d');
    const s = useUnreadCounts();
    expect(s.joinRequests['group-d']).toBeUndefined();
  });

  it('markJoinRequestsRead is a no-op for unknown group', async () => {
    const { markJoinRequestsRead, useUnreadCounts } = await import('@/src/lib/unreadStore');
    // Should not throw
    markJoinRequestsRead('nonexistent');
    const s = useUnreadCounts();
    expect(s.joinRequests['nonexistent']).toBeUndefined();
  });

  it('totalUnread sums both counts and joinRequests', async () => {
    const {
      incrementUnread,
      incrementJoinRequest,
      markAsRead,
      clearJoinRequestGroup,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    // Clear prior state
    markAsRead('group-e');
    markAsRead('group-f');
    clearJoinRequestGroup('group-e');
    clearJoinRequestGroup('group-f');

    incrementUnread('group-e');
    incrementUnread('group-e');
    incrementJoinRequest('group-f');

    const s = useUnreadCounts();
    // 2 unread messages + 1 join request = 3
    expect(s.totalUnread).toBeGreaterThanOrEqual(3);
    expect(s.counts['group-e']).toBe(2);
    expect(s.joinRequests['group-f']).toBe(1);
  });

  it('useUnreadCounts returns joinRequests field', async () => {
    const { useUnreadCounts } = await import('@/src/lib/unreadStore');
    const s = useUnreadCounts();
    expect(s).toHaveProperty('joinRequests');
    expect(typeof s.joinRequests).toBe('object');
  });

  it('exports all join request functions for test bridge', async () => {
    // The window.__fewUnread bridge is set at module load time only when
    // typeof window !== 'undefined'. In Vitest (no jsdom), window is undefined.
    // Instead we verify the functions are exported — the bridge just
    // re-exports these same references.
    const mod = await import('@/src/lib/unreadStore');
    expect(typeof mod.incrementJoinRequest).toBe('function');
    expect(typeof mod.markJoinRequestsRead).toBe('function');
    expect(typeof mod.clearJoinRequestGroup).toBe('function');
  });

  it('join request operations do not affect message counts', async () => {
    const {
      incrementUnread,
      incrementJoinRequest,
      clearJoinRequestGroup,
      markAsRead,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    // Set up known state
    markAsRead('group-g');
    clearJoinRequestGroup('group-g');

    incrementUnread('group-g');
    incrementUnread('group-g');
    incrementJoinRequest('group-g');

    const s1 = useUnreadCounts();
    expect(s1.counts['group-g']).toBe(2);
    expect(s1.joinRequests['group-g']).toBe(1);

    // Clear join requests — counts should remain
    clearJoinRequestGroup('group-g');
    const s2 = useUnreadCounts();
    expect(s2.counts['group-g']).toBe(2);
    expect(s2.joinRequests['group-g']).toBeUndefined();
  });
});

describe('unreadStore direct-message counters', () => {
  const PEER_A = 'aa'.repeat(32);
  const PEER_B = 'bb'.repeat(32);

  it('incrementDirectMessage tracks per-peer counts and feeds totalUnread', async () => {
    const {
      incrementDirectMessage,
      clearDirectMessageContact,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    clearDirectMessageContact(PEER_A);
    clearDirectMessageContact(PEER_B);

    incrementDirectMessage(PEER_A);
    incrementDirectMessage(PEER_A);
    incrementDirectMessage(PEER_B);

    const s = useUnreadCounts();
    expect(s.directMessages[PEER_A]).toBe(2);
    expect(s.directMessages[PEER_B]).toBe(1);
    // 3 DMs counted in totalUnread
    expect(s.totalUnread).toBeGreaterThanOrEqual(3);
  });

  it('peer pubkey is normalised to lowercase', async () => {
    const {
      incrementDirectMessage,
      clearDirectMessageContact,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    const mixed = 'AbCdEf' + '00'.repeat(29);
    clearDirectMessageContact(mixed);

    incrementDirectMessage(mixed);
    incrementDirectMessage(mixed.toLowerCase());

    const s = useUnreadCounts();
    expect(s.directMessages[mixed.toLowerCase()]).toBe(2);
    // The mixed-case key should not also exist
    expect(s.directMessages[mixed]).toBeUndefined();
  });

  it('markDirectMessagesRead resets the counter and persists timestamp', async () => {
    const {
      incrementDirectMessage,
      markDirectMessagesRead,
      getDirectMessageLastReadAt,
      clearDirectMessageContact,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    const PEER = 'cc'.repeat(32);
    clearDirectMessageContact(PEER);

    incrementDirectMessage(PEER);
    incrementDirectMessage(PEER);
    expect(useUnreadCounts().directMessages[PEER]).toBe(2);

    markDirectMessagesRead(PEER);
    const after = useUnreadCounts();
    expect(after.directMessages[PEER]).toBeUndefined();
    expect(getDirectMessageLastReadAt(PEER)).toBeGreaterThan(0);
  });

  it('clearDirectMessageContact removes both count and last-read timestamp', async () => {
    const {
      incrementDirectMessage,
      markDirectMessagesRead,
      clearDirectMessageContact,
      getDirectMessageLastReadAt,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    const PEER = 'dd'.repeat(32);
    incrementDirectMessage(PEER);
    markDirectMessagesRead(PEER);
    expect(getDirectMessageLastReadAt(PEER)).toBeGreaterThan(0);

    clearDirectMessageContact(PEER);
    expect(useUnreadCounts().directMessages[PEER]).toBeUndefined();
    expect(getDirectMessageLastReadAt(PEER)).toBe(0);
  });

  it('exports DM functions for the test bridge', async () => {
    const mod = await import('@/src/lib/unreadStore');
    expect(typeof mod.incrementDirectMessage).toBe('function');
    expect(typeof mod.markDirectMessagesRead).toBe('function');
    expect(typeof mod.clearDirectMessageContact).toBe('function');
    expect(typeof mod.getDirectMessageLastReadAt).toBe('function');
    expect(typeof mod.initDirectMessageCounts).toBe('function');
  });
});

describe('unreadStore init reconciliation (live increment during init)', () => {
  it('preserves a live increment that arrives during initUnreadCounts (no startup clobber)', async () => {
    const unread = await import('@/src/lib/unreadStore');
    const idb = await import('idb-keyval');
    const getMock = idb.get as unknown as ReturnType<typeof vi.fn>;
    const prev = getMock.getMockImplementation();

    // Scan sees 1 message and, mid-scan, a live message arrives for the same
    // group (chatHandler persists BEFORE incrementUnread, so by re-read time IDB
    // holds 2). The old wholesale-replace would clobber the count back to the
    // stale scan value (1); reconciliation re-reads and reports the true 2.
    let reads = 0;
    getMock.mockImplementation(async (key: string) => {
      if (key === 'few:messages:race-g1') {
        reads += 1;
        if (reads === 1) {
          unread.incrementUnread('race-g1');
          return [{ id: 'a', createdAt: 10, senderPubkey: 'peer' }];
        }
        return [
          { id: 'a', createdAt: 10, senderPubkey: 'peer' },
          { id: 'b', createdAt: 20, senderPubkey: 'peer' },
        ];
      }
      return undefined;
    });

    await unread.initUnreadCounts(['race-g1'], 'own');
    expect(unread.useUnreadCounts().counts['race-g1']).toBe(2);

    getMock.mockImplementation(prev ?? (async () => undefined));
  });

  it('does not double-count when the live message was already in the scan snapshot', async () => {
    const unread = await import('@/src/lib/unreadStore');
    const idb = await import('idb-keyval');
    const getMock = idb.get as unknown as ReturnType<typeof vi.fn>;
    const prev = getMock.getMockImplementation();

    // Here the scan already sees both messages (the live one was persisted before
    // the scan read the key). The re-read returns the same 2 — authoritative IDB
    // count, NOT scan(2) + live-bump(1) = 3.
    getMock.mockImplementation(async (key: string) => {
      if (key === 'few:messages:race-g2') {
        unread.incrementUnread('race-g2');
        return [
          { id: 'a', createdAt: 10, senderPubkey: 'peer' },
          { id: 'b', createdAt: 20, senderPubkey: 'peer' },
        ];
      }
      return undefined;
    });

    await unread.initUnreadCounts(['race-g2'], 'own');
    expect(unread.useUnreadCounts().counts['race-g2']).toBe(2);

    getMock.mockImplementation(prev ?? (async () => undefined));
  });
});

describe('reconcileConfirmedContactDirectMessageCount — raw idb-keyval read path (epic: pending-contact-confirmation, AC-OBS-2)', () => {
  // Gate-remediation (2026-07-15, second round): reconcileConfirmedContactDirectMessageCount
  // was originally routed through chatPersistence.ts#loadMessages on the theory
  // that triggering its self-heal pass early was safe here, since the user is
  // about to open that exact thread anyway. That was wrong: loadMessages
  // self-heals a thread only ONCE per session, and this function runs on
  // EVERY confirm (including the still-live detail-view confirm path via
  // PendingConfirmationPrompt.tsx) — so it could easily be the FIRST caller
  // to touch loadMessages for a thread, permanently consuming the one-time
  // repair opportunity (and discarding its refetchIds) before ContactChat's
  // own later loadMessages call ever got to see them. Fixed to use the same
  // raw, side-effect-free idb-keyval read that initDirectMessageCounts uses.
  //
  // These tests seed persisted messages through chatPersistence's own
  // `appendMessage` (the real write path a received DM goes through), not by
  // poking the fake idb-keyval store directly — appendMessage writes to the
  // exact same `few:messages:dm:<peer>` key the raw read consumes, so this
  // still exercises the real on-disk shape without depending on
  // loadMessages. See the describe block below (mirroring
  // initDirectMessageCounts's own coverage) for the proof that this function
  // never touches loadMessages / never triggers self-heal.

  it('counts DM messages persisted via chatPersistence#appendMessage, excluding own messages', async () => {
    const { directConversationId } = await import('@/src/lib/directMessages');
    const { appendMessage } = await import('@/src/lib/marmot/chatPersistence');
    const { reconcileConfirmedContactDirectMessageCount, useUnreadCounts, clearDirectMessageContact } = await import('@/src/lib/unreadStore');

    const OWN = 'ff'.repeat(32);
    const PEER = 'ee'.repeat(32);
    clearDirectMessageContact(PEER);

    const threadId = directConversationId(PEER);
    await appendMessage(threadId, { id: 'm1', content: 'hi', senderPubkey: PEER, groupId: threadId, createdAt: 1000 });
    await appendMessage(threadId, { id: 'm2', content: 'hi again', senderPubkey: PEER, groupId: threadId, createdAt: 2000 });
    await appendMessage(threadId, { id: 'm3', content: 'reply', senderPubkey: OWN, groupId: threadId, createdAt: 3000 });

    await reconcileConfirmedContactDirectMessageCount(PEER, OWN);
    expect(useUnreadCounts().directMessages[PEER]).toBe(2);
  });

  it('counts N already-persisted messages the way the confirm-action reconciliation call would (AC-OBS-2)', async () => {
    const { directConversationId } = await import('@/src/lib/directMessages');
    const { appendMessage } = await import('@/src/lib/marmot/chatPersistence');
    const { reconcileConfirmedContactDirectMessageCount, useUnreadCounts, clearDirectMessageContact } = await import('@/src/lib/unreadStore');

    const OWN = 'aa'.repeat(32);
    const PEER = 'bb'.repeat(32);
    clearDirectMessageContact(PEER);

    const threadId = directConversationId(PEER);
    // This seeds persisted messages directly, which exercises
    // reconcileConfirmedContactDirectMessageCount's counting mechanics in
    // isolation — `confirmPendingContact` (PendingConfirmationPrompt.tsx)
    // calls this exact function. It is NOT a simulation of the real
    // pending-contact timeline: per AC-OBS-2 (amended 2026-07-15, spec.md
    // `## Amendments`), a contact's messages are only persisted once their
    // `ContactChat` has mounted at least once, which never happens while
    // still pending — so at real confirm time this read typically finds
    // nothing yet and resolves to 0. The real catch-up for a genuinely-
    // never-opened conversation happens on first open instead, via
    // `ContactChat`'s own history load + `markDirectMessagesRead` (see the
    // e2e coverage in dm-pairing-pending-confirmation.spec.ts).
    for (let i = 0; i < 3; i++) {
      await appendMessage(threadId, { id: `held-${i}`, content: `msg ${i}`, senderPubkey: PEER, groupId: threadId, createdAt: 1000 + i * 100 });
    }

    await reconcileConfirmedContactDirectMessageCount(PEER, OWN);
    expect(useUnreadCounts().directMessages[PEER]).toBe(3);
  });

  it('a mixed-case peer input resolves to the same lowercase thread key chatPersistence itself writes under', async () => {
    const { directConversationId } = await import('@/src/lib/directMessages');
    const { appendMessage } = await import('@/src/lib/marmot/chatPersistence');
    const { reconcileConfirmedContactDirectMessageCount, useUnreadCounts, clearDirectMessageContact } = await import('@/src/lib/unreadStore');

    const OWN = 'cc'.repeat(32);
    const PEER_MIXED = 'Dd'.repeat(32);
    const PEER_LOWER = PEER_MIXED.toLowerCase();
    clearDirectMessageContact(PEER_LOWER);

    const threadId = directConversationId(PEER_MIXED); // directConversationId lowercases internally
    await appendMessage(threadId, { id: 'mix-1', content: 'hi', senderPubkey: PEER_LOWER, groupId: threadId, createdAt: 1000 });

    await reconcileConfirmedContactDirectMessageCount(PEER_MIXED, OWN);
    expect(useUnreadCounts().directMessages[PEER_LOWER]).toBe(1);
  });

  it('does not lose a live incrementDirectMessage bump that lands while the reconcile read is in flight (Codex P2, gate-remediation 2026-07-15)', async () => {
    // Unlike incrementUnread's group-chat counterpart, incrementDirectMessage
    // never persists message content — only ContactChat mounting does. So a
    // DM that arrives WHILE this reconcile's raw idb-keyval read is in flight
    // can never be seen by the recompute; the recompute must not be allowed
    // to overwrite that live bump back down (reconcileInit's own "authoritative
    // recompute supersedes the live bump" behavior is correct for its other
    // callers, but wrong for this one — see reconcileFloor's comment in
    // unreadStore.ts).
    const { directConversationId } = await import('@/src/lib/directMessages');
    const { appendMessage } = await import('@/src/lib/marmot/chatPersistence');
    const {
      reconcileConfirmedContactDirectMessageCount,
      useUnreadCounts,
      clearDirectMessageContact,
      incrementDirectMessage,
    } = await import('@/src/lib/unreadStore');
    const idb = await import('idb-keyval');
    const getMock = idb.get as unknown as ReturnType<typeof vi.fn>;
    const prev = getMock.getMockImplementation();

    const OWN = '11'.repeat(32);
    const PEER = '22'.repeat(32);
    clearDirectMessageContact(PEER);

    const threadId = directConversationId(PEER);
    const storageKey = `few:messages:${threadId}`;

    // Two messages already persisted AND already live-counted — a baseline
    // unread count the reconcile is expected to reproduce.
    await appendMessage(threadId, { id: 'p1', content: 'held-1', senderPubkey: PEER, groupId: threadId, createdAt: 1000 });
    await appendMessage(threadId, { id: 'p2', content: 'held-2', senderPubkey: PEER, groupId: threadId, createdAt: 2000 });
    incrementDirectMessage(PEER);
    incrementDirectMessage(PEER);
    expect(useUnreadCounts().directMessages[PEER]).toBe(2);

    // Simulate a THIRD DM landing on the wire while the raw idb-keyval read
    // is still in flight: the live bell bump fires (directMessageNotifications.ts),
    // bumping the visible count to 3, but its content is never persisted by
    // the bump itself — so the reconcile's persisted-history recompute keeps
    // finding only the 2 already-persisted messages.
    let fired = false;
    getMock.mockImplementation(async (key: string) => {
      if (key === storageKey && !fired) {
        fired = true;
        incrementDirectMessage(PEER);
      }
      return prev ? prev(key) : undefined;
    });

    await reconcileConfirmedContactDirectMessageCount(PEER, OWN);

    // Without the fix, the recompute (2, matching only the persisted
    // messages) would overwrite the live bump (3) back down. The final count
    // must never be lower than what the live increment alone produced.
    expect(useUnreadCounts().directMessages[PEER]).toBeGreaterThanOrEqual(3);

    getMock.mockImplementation(prev ?? (async () => undefined));
  });

  it('never calls chatPersistence#loadMessages, so it can never consume that thread\'s one-time self-heal/refetch opportunity (gate-remediation, second round, 2026-07-15)', async () => {
    // The structural bug this test guards against: loadMessages self-heals a
    // thread only on its FIRST call in a session and returns real refetchIds
    // only that once; every later call to the same thread short-circuits to
    // refetchIds: []. reconcileConfirmedContactDirectMessageCount runs on
    // EVERY confirm (including the still-live detail-view confirm path), so
    // if it called loadMessages it could easily be the first caller for a
    // thread — permanently and silently discarding a genuine repair
    // opportunity before ContactChat's own mount-time loadMessages call ever
    // got a chance to see it.
    const { directConversationId } = await import('@/src/lib/directMessages');
    const chatPersistence = await import('@/src/lib/marmot/chatPersistence');
    const { reconcileConfirmedContactDirectMessageCount, clearDirectMessageContact } = await import('@/src/lib/unreadStore');
    const loadMessagesSpy = vi.spyOn(chatPersistence, 'loadMessages');

    const OWN = '55'.repeat(32);
    const PEER = '66'.repeat(32);
    clearDirectMessageContact(PEER);

    // Seed a malformed row (non-canonical id) directly via the raw idb-keyval
    // key reconcileConfirmedContactDirectMessageCount itself reads —
    // simulating a thread that genuinely needs a self-heal/refetch repair
    // and hasn't been opened yet.
    const idb = await import('idb-keyval');
    await idb.set(`few:messages:dm:${PEER}`, [
      { id: 'not-a-canonical-hex-id', content: 'hi', senderPubkey: PEER, groupId: directConversationId(PEER), createdAt: 1000 },
    ]);

    await reconcileConfirmedContactDirectMessageCount(PEER, OWN);

    expect(loadMessagesSpy).not.toHaveBeenCalled();

    // The reconcile must not have marked the thread healed either — loadMessages,
    // called later (as ContactChat would on mount), must still see the
    // malformed row and report it via refetchIds.
    const { refetchIds } = await chatPersistence.loadMessages(directConversationId(PEER));
    expect(refetchIds).toContain('not-a-canonical-hex-id');

    loadMessagesSpy.mockRestore();
  });
});

describe('initDirectMessageCounts — batch/startup path never touches self-heal (epic: pending-contact-confirmation, S2 gate-remediation)', () => {
  // Codex P2 finding (2026-07-15): initDirectMessageCounts (called by
  // DirectMessageNotificationsWatcher at startup for every known peer) must
  // NOT route through chatPersistence.ts#loadMessages — doing so runs the DM
  // self-heal pass and marks the thread "healed" before ContactChat ever
  // mounts for that peer, discarding loadMessages' refetchIds and starving
  // ContactChat's own later call of the self-heal/refetch signal for a
  // thread that genuinely needed repair. These tests prove the batch path
  // never invokes loadMessages at all, so it can never trigger or discard
  // that side effect.

  it('does not call chatPersistence#loadMessages (raw idb-keyval read only)', async () => {
    const chatPersistence = await import('@/src/lib/marmot/chatPersistence');
    const { initDirectMessageCounts, clearDirectMessageContact } = await import('@/src/lib/unreadStore');
    const loadMessagesSpy = vi.spyOn(chatPersistence, 'loadMessages');

    const OWN = '11'.repeat(32);
    const PEER = '22'.repeat(32);
    clearDirectMessageContact(PEER);

    await initDirectMessageCounts([PEER], OWN);

    expect(loadMessagesSpy).not.toHaveBeenCalled();
    loadMessagesSpy.mockRestore();
  });

  it('does not mark a never-opened DM thread as self-healed, preserving refetchIds for ContactChat', async () => {
    const { directConversationId } = await import('@/src/lib/directMessages');
    const chatPersistence = await import('@/src/lib/marmot/chatPersistence');
    const { initDirectMessageCounts, clearDirectMessageContact } = await import('@/src/lib/unreadStore');

    const OWN = '33'.repeat(32);
    const PEER = '44'.repeat(32);
    clearDirectMessageContact(PEER);

    // Seed a malformed row (non-canonical id) directly via the raw idb-keyval
    // key initDirectMessageCounts itself reads — simulating a thread that
    // genuinely needs a self-heal/refetch repair and hasn't been opened yet.
    const idb = await import('idb-keyval');
    await idb.set(`few:messages:dm:${PEER}`, [
      { id: 'not-a-canonical-hex-id', content: 'hi', senderPubkey: PEER, groupId: directConversationId(PEER), createdAt: 1000 },
    ]);

    await initDirectMessageCounts([PEER], OWN);

    // The startup scan must not have run self-heal / marked the thread
    // healed — loadMessages, called later (as ContactChat would on mount),
    // must still see the malformed row and report it via refetchIds.
    const { refetchIds } = await chatPersistence.loadMessages(directConversationId(PEER));
    expect(refetchIds).toContain('not-a-canonical-hex-id');
  });
});

describe('unreadStore mutation-gate: single-key mutations must not leak into sibling keys', () => {
  // Mutation-gate finding (Stryker id 70, line 189): `const next = { ...state.counts }`
  // is required — replacing it with `{}` produces a store where marking one
  // group as read wipes every other group's count as well. That mutant
  // survives the existing tests because they only ever hold one group's
  // count when they call markAsRead. Same-shape guards for the two other
  // single-key mutations that follow the same pattern (clearUnreadGroup /
  // clearDirectMessageContact) — cheap symmetry, and it prevents the
  // sibling-wipe regression from creeping back in via any of the three paths.

  it('markAsRead removes only the target group and leaves other groups\' counts intact', async () => {
    const { incrementUnread, markAsRead, useUnreadCounts } = await import('@/src/lib/unreadStore');

    markAsRead('mg-a');
    markAsRead('mg-b');

    incrementUnread('mg-a');
    incrementUnread('mg-a');
    incrementUnread('mg-b');
    expect(useUnreadCounts().counts['mg-a']).toBe(2);
    expect(useUnreadCounts().counts['mg-b']).toBe(1);

    markAsRead('mg-a');
    const after = useUnreadCounts();
    expect(after.counts['mg-a']).toBeUndefined();
    expect(after.counts['mg-b']).toBe(1);
  });

  it('clearUnreadGroup removes only the target group and leaves other groups\' counts intact', async () => {
    const { incrementUnread, clearUnreadGroup, markAsRead, useUnreadCounts } = await import('@/src/lib/unreadStore');

    markAsRead('cu-a');
    markAsRead('cu-b');

    incrementUnread('cu-a');
    incrementUnread('cu-b');
    incrementUnread('cu-b');
    expect(useUnreadCounts().counts['cu-a']).toBe(1);
    expect(useUnreadCounts().counts['cu-b']).toBe(2);

    clearUnreadGroup('cu-a');
    const after = useUnreadCounts();
    expect(after.counts['cu-a']).toBeUndefined();
    expect(after.counts['cu-b']).toBe(2);
  });

  it('clearDirectMessageContact removes only the target peer and leaves other peers\' counts intact', async () => {
    const { incrementDirectMessage, clearDirectMessageContact, useUnreadCounts } = await import('@/src/lib/unreadStore');

    const PEER_X = '77'.repeat(32);
    const PEER_Y = '99'.repeat(32);
    clearDirectMessageContact(PEER_X);
    clearDirectMessageContact(PEER_Y);

    incrementDirectMessage(PEER_X);
    incrementDirectMessage(PEER_X);
    incrementDirectMessage(PEER_Y);
    expect(useUnreadCounts().directMessages[PEER_X]).toBe(2);
    expect(useUnreadCounts().directMessages[PEER_Y]).toBe(1);

    clearDirectMessageContact(PEER_X);
    const after = useUnreadCounts();
    expect(after.directMessages[PEER_X]).toBeUndefined();
    expect(after.directMessages[PEER_Y]).toBe(1);
  });
});

describe('unreadStore mutation-gate: reconcileInit re-read must not clobber a live-bumped state with a stale zero', () => {
  // Mutation-gate finding (Stryker ids 41 & 43, line 118): the re-read loop's
  // `if (n > 0) next[key] = n; else delete next[key]` is required — if the
  // guard is relaxed (`if (true)` / `n >= 0`), a re-read that observes zero
  // messages will assign next[key] = 0 and the subsequent state merge
  // (`{ ...state.counts, ...next }`) overwrites the live-bumped count back
  // down to 0. The existing race tests only exercise re-reads that observe
  // MORE messages than the initial scan, so the zero-arm of the guard was
  // untested. Scenario here: the initial scan sees N > 0 messages and fires
  // a live increment mid-scan, but by re-read time the persisted history is
  // empty (e.g. concurrent thread clear) — the live-bumped count must
  // survive.

  it('a re-read that observes zero persisted messages must not overwrite the live-bumped count with 0', async () => {
    const unread = await import('@/src/lib/unreadStore');
    const idb = await import('idb-keyval');
    const getMock = idb.get as unknown as ReturnType<typeof vi.fn>;
    const prev = getMock.getMockImplementation();

    let reads = 0;
    getMock.mockImplementation(async (key: string) => {
      if (key === 'few:messages:reread-zero') {
        reads += 1;
        if (reads === 1) {
          // Initial scan: sees 2 persisted, and mid-scan a live message arrives.
          unread.incrementUnread('reread-zero');
          return [
            { id: 'a', createdAt: 10, senderPubkey: 'peer' },
            { id: 'b', createdAt: 20, senderPubkey: 'peer' },
          ];
        }
        // Re-read: thread was cleared between scan and re-read — 0 messages.
        return [];
      }
      return undefined;
    });

    await unread.initUnreadCounts(['reread-zero'], 'own');
    // Original: the else-branch `delete next[key]` prevents `next` from
    // carrying a 0 into the state merge, so the live-bumped count survives.
    // Mutants 41/43 assign next[key] = 0, and the merge overwrites the live
    // count to 0.
    expect(unread.useUnreadCounts().counts['reread-zero']).toBeGreaterThan(0);

    getMock.mockImplementation(prev ?? (async () => undefined));
  });
});

describe('unreadStore mutation-gate: reconcileConfirmedContactDirectMessageCount preserves pre-reconcile live count', () => {
  // Mutation-gate finding (Stryker id 192, line 467): `reconcileFloor[key] =
  // state.directMessages[key] ?? 0` is required — replacing `??` with `&&`
  // seeds the floor with 0 instead of the pre-reconcile live count. The
  // existing race test (line 429) happens to still pass under that mutant
  // because the mid-reconcile injected increment re-raises the floor via
  // Math.max. The gap: when a pre-existing live count is already on the
  // store (peer had DMs bumped by directMessageNotifications.ts before
  // confirm) AND the recompute yields a LOWER count (persisted history is
  // sparser than the live bell — the exact case the floor exists to guard
  // against), the mutant fails to floor the final value at the pre-reconcile
  // live count.

  it('when the recompute yields a lower count than the pre-reconcile live state, the floor preserves the live count', async () => {
    const { directConversationId } = await import('@/src/lib/directMessages');
    const { appendMessage } = await import('@/src/lib/marmot/chatPersistence');
    const {
      reconcileConfirmedContactDirectMessageCount,
      useUnreadCounts,
      clearDirectMessageContact,
      incrementDirectMessage,
    } = await import('@/src/lib/unreadStore');

    const OWN = '77'.repeat(32);
    const PEER = '88'.repeat(32);
    clearDirectMessageContact(PEER);

    const threadId = directConversationId(PEER);
    // Only 2 messages ever made it to persisted history…
    await appendMessage(threadId, { id: 'a', content: 'hi', senderPubkey: PEER, groupId: threadId, createdAt: 1000 });
    await appendMessage(threadId, { id: 'b', content: 'hi2', senderPubkey: PEER, groupId: threadId, createdAt: 2000 });
    // …but the bell was live-bumped 4 times (a real-world case: DMs kept
    // arriving after the last time ContactChat mounted, so history persistence
    // never caught up).
    incrementDirectMessage(PEER);
    incrementDirectMessage(PEER);
    incrementDirectMessage(PEER);
    incrementDirectMessage(PEER);
    expect(useUnreadCounts().directMessages[PEER]).toBe(4);

    await reconcileConfirmedContactDirectMessageCount(PEER, OWN);

    // The recompute (2 persisted) alone would lower the count to 2; the floor
    // must preserve the pre-reconcile live value (4). Mutant 192 seeds the
    // floor with 0, so the reconcile silently drops the count to 2.
    expect(useUnreadCounts().directMessages[PEER]).toBeGreaterThanOrEqual(4);
  });
});
