import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — hoisted by vitest, applied before the imports below run.
// ---------------------------------------------------------------------------

// pendingInvitations: allows asserting enqueue/no-enqueue without touching
// localStorage (mirrors welcomeSubscription.test.ts's convention).
const mockEnqueuePendingInvitation = vi.fn();
const mockCountPendingInvitations = vi.fn().mockReturnValue(1);
const mockRemovePendingInvitation = vi.fn();
const mockListPendingInvitations = vi.fn().mockReturnValue([]);

vi.mock('@/src/lib/pendingInvitations', () => ({
  enqueuePendingInvitation: (...args: unknown[]) => mockEnqueuePendingInvitation(...args),
  countPendingInvitations: () => mockCountPendingInvitations(),
  removePendingInvitation: (...args: unknown[]) => mockRemovePendingInvitation(...args),
  listPendingInvitations: () => mockListPendingInvitations(),
}));

// @internet-privacy/marmot-ts: full stub (matches this repo's convention —
// see cancelInvitationImpl.test.ts / chatHandler.test.ts / epochResolver.test.ts
// — rather than a partial importOriginal mock). getGroupMembers backs the
// shared join core's Group.memberPubkeys; the other three back S4's
// AC-AUTO-4a pre-join group-name disambiguation and are per-test controllable.
const {
  mockGetGroupMembers,
  mockGetWelcome,
  mockGetWelcomeKeyPackageRefs,
  mockReadWelcomeMarmotGroupData,
} = vi.hoisted(() => ({
  mockGetGroupMembers: vi.fn(() => [] as string[]),
  mockGetWelcome: vi.fn((rumor: unknown) => rumor),
  mockGetWelcomeKeyPackageRefs: vi.fn(() => [] as Uint8Array[]),
  mockReadWelcomeMarmotGroupData: vi.fn(async (): Promise<{ name: string } | null> => null),
}));

vi.mock('@internet-privacy/marmot-ts', () => ({
  getGroupMembers: (...args: unknown[]) => mockGetGroupMembers(...args),
  getWelcome: (...args: unknown[]) => mockGetWelcome(...args),
  getWelcomeKeyPackageRefs: (...args: unknown[]) => mockGetWelcomeKeyPackageRefs(...args),
  readWelcomeMarmotGroupData: (...args: unknown[]) => mockReadWelcomeMarmotGroupData(...args),
}));

// ---------------------------------------------------------------------------

import { subscribeToWelcomes } from '@/src/lib/marmot/welcomeSubscription';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { createRumor, createSeal, createWrap } from 'nostr-tools/nip59';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import {
  saveOutboundJoinRequest,
  clearAllOutboundJoinRequests,
  loadUnexpiredOutboundJoinRequestsForAdmin,
  OUTBOUND_JOIN_REQUEST_TTL_MS,
} from '@/src/lib/marmot/outboundJoinRequests';

// ---------------------------------------------------------------------------
// Crypto fixture helpers (mirrors welcomeSubscription.test.ts's local helpers)
// ---------------------------------------------------------------------------

function makeKeypair() {
  const priv = generateSecretKey();
  const privHex = bytesToHex(priv);
  const pubHex = getPublicKey(priv);
  return { priv, privHex, pubHex };
}

/** A genuine, correctly-signed two-layer NIP-59 gift wrap. */
function buildGenuineWrap(params: {
  sender: { priv: Uint8Array; pubHex: string };
  recipientPubHex: string;
  kind: number;
  content: string;
  tags?: string[][];
}) {
  const rumor = createRumor(
    { kind: params.kind, content: params.content, tags: params.tags ?? [] },
    params.sender.priv,
  );
  const seal = createSeal(rumor, params.sender.priv, params.recipientPubHex);
  const wrap = createWrap(seal, params.recipientPubHex);
  return { wrap, seal, rumor };
}

/**
 * A gift wrap whose seal is genuinely signed by `sender`, but the signature
 * is then tampered so it no longer verifies — the seal's `pubkey` field
 * (and therefore `unwrapResult.pubkey`) is UNCHANGED. This is the AC-AUTO-4
 * negative-test shape: the raw sender identity matches a stored outbound
 * record's adminPubkeyHex, but `authenticated` is false. A naive
 * correlation keyed on the raw pubkey alone would wrongly match this; the
 * fail-closed gate (`if (!unwrapResult.authenticated) return null`) must not.
 */
function buildInvalidSealSignatureWrap(params: {
  sender: { priv: Uint8Array; pubHex: string };
  recipientPubHex: string;
  kind: number;
  content: string;
  tags?: string[][];
}) {
  const rumor = createRumor(
    { kind: params.kind, content: params.content, tags: params.tags ?? [] },
    params.sender.priv,
  );
  const seal = createSeal(rumor, params.sender.priv, params.recipientPubHex);
  const tamperedSeal = { ...seal, sig: '0'.repeat(128) };
  const wrap = createWrap(tamperedSeal, params.recipientPubHex);
  return { wrap, seal: tamperedSeal, rumor };
}

function makeMockMarmotClient(joinResult: {
  idStr: string;
  groupData?: { name?: string };
  relays?: string[];
  state?: unknown;
}) {
  return {
    joinGroupFromWelcome: vi.fn().mockResolvedValue({ group: joinResult }),
    keyPackages: { get: vi.fn() },
    cryptoProvider: { getCiphersuiteImpl: vi.fn() },
  };
}

function makeNdkWithEventCapture() {
  let capturedHandler: ((event: unknown) => Promise<void>) | null = null;
  const mockSubInstance = {
    on: vi.fn((eventName: string, handler: (event: unknown) => Promise<void>) => {
      if (eventName === 'event') capturedHandler = handler;
    }),
    stop: vi.fn(),
  };
  const mockNdk = { subscribe: vi.fn(() => mockSubInstance) };
  const fireEvent = async (ndkEvent: unknown) => {
    if (!capturedHandler) throw new Error('Event handler not yet installed');
    await capturedHandler(ndkEvent);
  };
  return { mockNdk, fireEvent };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('subscribeToWelcomes — auto-accept correlation (S4)', () => {
  let localStorageStore: Record<string, string> = {};

  beforeEach(async () => {
    localStorageStore = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localStorageStore[key] ?? null,
      setItem: (key: string, value: string) => { localStorageStore[key] = value; },
      removeItem: (key: string) => { delete localStorageStore[key]; },
    });
    mockEnqueuePendingInvitation.mockReset();
    mockCountPendingInvitations.mockReset().mockReturnValue(1);
    mockGetGroupMembers.mockReset().mockReturnValue([]);
    mockGetWelcome.mockReset().mockImplementation((rumor: unknown) => rumor);
    mockGetWelcomeKeyPackageRefs.mockReset().mockReturnValue([]);
    mockReadWelcomeMarmotGroupData.mockReset().mockResolvedValue(null);
    await clearAllOutboundJoinRequests();
  });

  // ── AC-AUTO-2/4: correlated Welcome (authenticated + single admin match) ──

  it('AC-AUTO-2/4: a correlated Welcome (authenticated sender, single matching record) is auto-accepted — never enqueued, joins via the shared join core, and consumes the record', async () => {
    const admin = makeKeypair();
    const invitee = makeKeypair();

    await saveOutboundJoinRequest({
      nonce: 'nonce-correlated-1',
      adminPubkeyHex: admin.pubHex,
      groupName: 'Group One',
      sentAt: Date.now(),
    });

    const { wrap } = buildGenuineWrap({
      sender: admin,
      recipientPubHex: invitee.pubHex,
      kind: 444,
      content: 'welcome-payload',
    });

    const mockMarmotClient = makeMockMarmotClient({
      idStr: 'joined-group-1',
      groupData: { name: 'Group One' },
      relays: ['wss://relay.example.com'],
      state: {},
    });
    const onGroupJoined = vi.fn();
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const unsub = await subscribeToWelcomes(
      invitee.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      createPrivateKeySigner(invitee.privHex),
      onGroupJoined,
    );

    await fireEvent({ id: 'giftwrap-correlated-1', pubkey: wrap.pubkey, content: wrap.content });

    // Never enqueued — the invitee must not see a pending card at all.
    expect(mockEnqueuePendingInvitation).not.toHaveBeenCalled();
    // Joined via the shared join core.
    expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
    expect(onGroupJoined).toHaveBeenCalledTimes(1);
    const [joinedGroup] = onGroupJoined.mock.calls[0] as [{ id: string; name: string }];
    expect(joinedGroup.id).toBe('joined-group-1');
    expect(joinedGroup.name).toBe('Group One');

    // AC-AUTO-5: the record is consumed.
    const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
    expect(remaining).toEqual([]);

    unsub();
  });

  // ── AC-AUTO-5 (replay): a second delivery after consumption is uncorrelated ─

  it('AC-AUTO-5: after a correlated auto-accept consumes the record, a second delivery from the same admin (replay) is treated as uncorrelated and enqueued', async () => {
    const admin = makeKeypair();
    const invitee = makeKeypair();

    await saveOutboundJoinRequest({
      nonce: 'nonce-replay-1',
      adminPubkeyHex: admin.pubHex,
      groupName: 'Group Replay',
      sentAt: Date.now(),
    });

    const mockMarmotClient = makeMockMarmotClient({
      idStr: 'joined-group-replay',
      groupData: { name: 'Group Replay' },
      relays: ['wss://relay.example.com'],
      state: {},
    });
    const onGroupJoined = vi.fn();
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const unsub = await subscribeToWelcomes(
      invitee.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      createPrivateKeySigner(invitee.privHex),
      onGroupJoined,
    );

    // First delivery: auto-accepts and consumes the record.
    const first = buildGenuineWrap({ sender: admin, recipientPubHex: invitee.pubHex, kind: 444, content: 'welcome-1' });
    await fireEvent({ id: 'giftwrap-replay-first', pubkey: first.wrap.pubkey, content: first.wrap.content });
    expect(mockEnqueuePendingInvitation).not.toHaveBeenCalled();
    expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);

    // Second delivery — a DIFFERENT gift-wrap event (distinct id, so the
    // pre-existing processedGiftWraps dedup guard does not itself explain
    // the outcome) from the same admin. Since the record was already
    // consumed, this must now take the uncorrelated/pending path.
    const second = buildGenuineWrap({ sender: admin, recipientPubHex: invitee.pubHex, kind: 444, content: 'welcome-2' });
    await fireEvent({ id: 'giftwrap-replay-second', pubkey: second.wrap.pubkey, content: second.wrap.content });

    expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);
    const [enqueued] = mockEnqueuePendingInvitation.mock.calls[0] as [{ inviterPubkeyHex: string }];
    expect(enqueued.inviterPubkeyHex).toBe(admin.pubHex);
    // Still only ONE join — the replay did not auto-accept a second time.
    expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);

    unsub();
  });

  // ── AC-AUTO-5 (combined, examiner sev-5 + Amendment 1 fix verification):
  //    consume-then-replay AND sibling survival in ONE flow — two unexpired
  //    records for the SAME admin but DIFFERENT groups; the correlated
  //    Welcome for group A must consume ONLY record A, record B (the
  //    sibling) must survive that, AND — this is what Amendment 1 fixes — a
  //    FURTHER Welcome from the same admin, for a group that does not match
  //    the sole remaining sibling, must NOT auto-accept either. ───────────
  //
  // HISTORY (2026-07-16 gate remediation, superseded by Amendment 1 same
  // day): a prior version of this test/comment recorded that a further
  // same-admin Welcome WOULD wrongly auto-accept and consume the sibling
  // once it became the sole remaining candidate — because
  // `resolveAutoAcceptRecord` short-circuited on `candidates.length === 1`
  // and skipped the group-name check entirely for a lone candidate. That
  // shortcut has now been REMOVED: the group check always runs when the
  // Welcome's pre-join group name is readable, regardless of how many
  // candidates remain. The assertions below therefore now verify the
  // CORRECT, fixed outcome — the sibling survives BOTH the first accept
  // AND the mismatched second Welcome — rather than stopping short of it.
  it('AC-AUTO-5 (combined): a correlated Welcome for group A, with a sibling record for group B outstanding, consumes ONLY record A — and a further same-admin Welcome for a non-matching group leaves the sibling untouched', async () => {
    const admin = makeKeypair();
    const invitee = makeKeypair();

    // Two unexpired records for the SAME admin, DIFFERENT groups.
    await saveOutboundJoinRequest({
      nonce: 'nonce-combined-a',
      adminPubkeyHex: admin.pubHex,
      groupName: 'Group Combined A',
      sentAt: Date.now(),
    });
    await saveOutboundJoinRequest({
      nonce: 'nonce-combined-b',
      adminPubkeyHex: admin.pubHex,
      groupName: 'Group Combined B',
      sentAt: Date.now(),
    });

    // Disambiguation plumbing: the Welcome's pre-join group name resolves to
    // "Group Combined A" — record A is the single name match.
    mockGetWelcomeKeyPackageRefs.mockReturnValue([new Uint8Array([1, 2, 3])]);
    mockReadWelcomeMarmotGroupData.mockResolvedValue({ name: 'Group Combined A' });

    const mockMarmotClient = makeMockMarmotClient({
      idStr: 'joined-group-combined-a',
      groupData: { name: 'Group Combined A' },
      relays: ['wss://relay.example.com'],
      state: {},
    });
    (mockMarmotClient.keyPackages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      publicPackage: { cipherSuite: 1 },
      privatePackage: {},
    });
    (mockMarmotClient.cryptoProvider.getCiphersuiteImpl as ReturnType<typeof vi.fn>).mockResolvedValue('ciphersuite-impl-stub');

    const onGroupJoined = vi.fn();
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const unsub = await subscribeToWelcomes(
      invitee.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      createPrivateKeySigner(invitee.privHex),
      onGroupJoined,
    );

    // A genuine Welcome from `admin` for group A. Correlation disambiguates
    // via the mocked group-name match (2 candidates -> AC-AUTO-4a path) and
    // consumes ONLY record A.
    const first = buildGenuineWrap({
      sender: admin,
      recipientPubHex: invitee.pubHex,
      kind: 444,
      content: 'welcome-combined-first',
    });
    await fireEvent({ id: 'giftwrap-combined-first', pubkey: first.wrap.pubkey, content: first.wrap.content });

    expect(mockEnqueuePendingInvitation).not.toHaveBeenCalled();
    expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
    expect(onGroupJoined).toHaveBeenCalledTimes(1);

    // The sibling record (group B) survives, untouched, right after the
    // accept — record A (and ONLY record A) is gone.
    const afterFirst = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].nonce).toBe('nonce-combined-b');
    expect(afterFirst[0].groupName).toBe('Group Combined B');

    // A FURTHER Welcome from the same admin, whose real pre-join group is
    // STILL "Group Combined A" (mismatching the sole remaining candidate,
    // record B's "Group Combined B"). Pre-Amendment-1, the single-candidate
    // shortcut would have skipped the group check and wrongly auto-accepted
    // this too. Now the group check always runs, finds zero matches against
    // the lone remaining candidate, and falls through to pending.
    const second = buildGenuineWrap({
      sender: admin,
      recipientPubHex: invitee.pubHex,
      kind: 444,
      content: 'welcome-combined-second',
    });
    await fireEvent({ id: 'giftwrap-combined-second', pubkey: second.wrap.pubkey, content: second.wrap.content });

    // No second join — the mismatched Welcome did not auto-accept.
    expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
    expect(onGroupJoined).toHaveBeenCalledTimes(1);
    expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);
    const [enqueued] = mockEnqueuePendingInvitation.mock.calls[0] as [{ inviterPubkeyHex: string }];
    expect(enqueued.inviterPubkeyHex).toBe(admin.pubHex);

    // Record B survives the mismatched second Welcome untouched.
    const afterSecond = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].nonce).toBe('nonce-combined-b');
    expect(afterSecond[0].groupName).toBe('Group Combined B');

    unsub();
  });

  // ── VQ-S4-017: correlation matched, but the MLS join itself fails ─────────

  it('when correlation matches but the MLS join throws, the record is NOT consumed and the Welcome falls through to the pending path (never silently dropped)', async () => {
    const admin = makeKeypair();
    const invitee = makeKeypair();

    await saveOutboundJoinRequest({
      nonce: 'nonce-join-failure-1',
      adminPubkeyHex: admin.pubHex,
      groupName: 'Group Join Failure',
      sentAt: Date.now(),
    });

    const { wrap } = buildGenuineWrap({
      sender: admin,
      recipientPubHex: invitee.pubHex,
      kind: 444,
      content: 'welcome-payload',
    });

    const mockMarmotClient = {
      joinGroupFromWelcome: vi.fn().mockRejectedValue(new Error('MLS join failed: stale epoch')),
      keyPackages: { get: vi.fn() },
      cryptoProvider: { getCiphersuiteImpl: vi.fn() },
    };
    const onGroupJoined = vi.fn();
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const unsub = await subscribeToWelcomes(
      invitee.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      createPrivateKeySigner(invitee.privHex),
      onGroupJoined,
    );

    await fireEvent({ id: 'giftwrap-join-failure-1', pubkey: wrap.pubkey, content: wrap.content });

    // The join was attempted (correlation DID match) but failed.
    expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
    expect(onGroupJoined).not.toHaveBeenCalled();

    // Falls through to the existing pending path rather than being dropped.
    expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);
    const [enqueued] = mockEnqueuePendingInvitation.mock.calls[0] as [{ inviterPubkeyHex: string }];
    expect(enqueued.inviterPubkeyHex).toBe(admin.pubHex);

    // The record is NOT consumed — the join never actually succeeded, so the
    // user must still get a future chance (manual accept, or a later retry).
    const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].nonce).toBe('nonce-join-failure-1');

    unsub();
  });

  // ── AC-AUTO-4 (ADR-002 guarantee): spoofed sender never auto-accepts ──────

  it('AC-AUTO-4: a Welcome whose raw sender matches a stored record but whose seal fails authentication is NOT auto-accepted — it is enqueued as uncorrelated', async () => {
    const admin = makeKeypair();
    const invitee = makeKeypair();

    await saveOutboundJoinRequest({
      nonce: 'nonce-spoofed-1',
      adminPubkeyHex: admin.pubHex,
      groupName: 'Group Spoofed',
      sentAt: Date.now(),
    });

    // Genuinely signed by `admin`, then the signature is tampered — seal.pubkey
    // (and therefore unwrapResult.pubkey) is STILL admin.pubHex, but
    // unwrapResult.authenticated is false.
    const { wrap } = buildInvalidSealSignatureWrap({
      sender: admin,
      recipientPubHex: invitee.pubHex,
      kind: 444,
      content: 'welcome-payload',
    });

    const mockMarmotClient = makeMockMarmotClient({ idStr: 'should-not-join', state: {} });
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const unsub = await subscribeToWelcomes(
      invitee.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      createPrivateKeySigner(invitee.privHex),
      vi.fn(),
    );

    await fireEvent({ id: 'giftwrap-spoofed-1', pubkey: wrap.pubkey, content: wrap.content });

    expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();
    expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);
    const [enqueued] = mockEnqueuePendingInvitation.mock.calls[0] as [{ inviterPubkeyHex: string }];
    expect(enqueued.inviterPubkeyHex).toBe(admin.pubHex);

    // The record must survive — this Welcome was never actually correlated.
    const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].nonce).toBe('nonce-spoofed-1');

    unsub();
  });

  // ── AC-AUTO-3: no record at all → uncorrelated, unchanged ─────────────────

  it('AC-AUTO-3: an authenticated Welcome with NO matching outbound record is enqueued exactly as today', async () => {
    const admin = makeKeypair();
    const invitee = makeKeypair();
    // Deliberately no saveOutboundJoinRequest call for this admin.

    const { wrap } = buildGenuineWrap({
      sender: admin,
      recipientPubHex: invitee.pubHex,
      kind: 444,
      content: 'welcome-payload',
    });

    const mockMarmotClient = makeMockMarmotClient({ idStr: 'should-not-join', state: {} });
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const unsub = await subscribeToWelcomes(
      invitee.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      createPrivateKeySigner(invitee.privHex),
      vi.fn(),
    );

    await fireEvent({ id: 'giftwrap-uncorrelated-1', pubkey: wrap.pubkey, content: wrap.content });

    expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();
    expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);

    unsub();
  });

  // ── AC-AUTO-6: expired record does not correlate ──────────────────────────

  it('AC-AUTO-6: an expired outbound record does not correlate — the Welcome is enqueued as uncorrelated', async () => {
    const admin = makeKeypair();
    const invitee = makeKeypair();

    await saveOutboundJoinRequest({
      nonce: 'nonce-expired-1',
      adminPubkeyHex: admin.pubHex,
      groupName: 'Group Expired',
      sentAt: Date.now() - OUTBOUND_JOIN_REQUEST_TTL_MS - 1000,
    });

    const { wrap } = buildGenuineWrap({
      sender: admin,
      recipientPubHex: invitee.pubHex,
      kind: 444,
      content: 'welcome-payload',
    });

    const mockMarmotClient = makeMockMarmotClient({ idStr: 'should-not-join', state: {} });
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const unsub = await subscribeToWelcomes(
      invitee.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      createPrivateKeySigner(invitee.privHex),
      vi.fn(),
    );

    await fireEvent({ id: 'giftwrap-expired-1', pubkey: wrap.pubkey, content: wrap.content });

    expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();
    expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);

    unsub();
  });

  // ── AC-AUTO-4a: two records, same admin, different groups ─────────────────

  describe('AC-AUTO-4a: disambiguation when >1 unexpired record shares the admin', () => {
    async function seedTwoRecordsForAdmin(adminPubHex: string) {
      await saveOutboundJoinRequest({
        nonce: 'nonce-alpha',
        adminPubkeyHex: adminPubHex,
        groupName: 'Group Alpha',
        sentAt: Date.now(),
      });
      await saveOutboundJoinRequest({
        nonce: 'nonce-beta',
        adminPubkeyHex: adminPubHex,
        groupName: 'Group Beta',
        sentAt: Date.now(),
      });
    }

    it('selects and consumes ONLY the record whose groupName matches the Welcome pre-join group data — the sibling survives', async () => {
      const admin = makeKeypair();
      const invitee = makeKeypair();
      await seedTwoRecordsForAdmin(admin.pubHex);

      // Disambiguation plumbing: one candidate key package ref resolves to a
      // local key package, whose ciphersuite feeds readWelcomeMarmotGroupData,
      // which resolves the Welcome's real pre-join group name: "Group Beta".
      mockGetWelcomeKeyPackageRefs.mockReturnValue([new Uint8Array([1, 2, 3])]);
      mockReadWelcomeMarmotGroupData.mockResolvedValue({ name: 'Group Beta' });

      const { wrap } = buildGenuineWrap({
        sender: admin,
        recipientPubHex: invitee.pubHex,
        kind: 444,
        content: 'welcome-payload',
      });

      const mockMarmotClient = makeMockMarmotClient({
        idStr: 'joined-group-beta',
        groupData: { name: 'Group Beta' },
        state: {},
      });
      // A local key package matching the candidate ref.
      (mockMarmotClient.keyPackages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        publicPackage: { cipherSuite: 1 },
        privatePackage: {},
      });
      (mockMarmotClient.cryptoProvider.getCiphersuiteImpl as ReturnType<typeof vi.fn>).mockResolvedValue('ciphersuite-impl-stub');

      const onGroupJoined = vi.fn();
      const { mockNdk, fireEvent } = makeNdkWithEventCapture();

      const unsub = await subscribeToWelcomes(
        invitee.pubHex,
        mockMarmotClient as never,
        mockNdk as never,
        createPrivateKeySigner(invitee.privHex),
        onGroupJoined,
      );

      await fireEvent({ id: 'giftwrap-4a-match', pubkey: wrap.pubkey, content: wrap.content });

      expect(mockEnqueuePendingInvitation).not.toHaveBeenCalled();
      expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
      expect(onGroupJoined).toHaveBeenCalledTimes(1);

      const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
      expect(remaining).toHaveLength(1);
      // The WRONG record (Group Alpha) survives; the matched one (Group Beta) is gone.
      expect(remaining[0].nonce).toBe('nonce-alpha');
      expect(remaining[0].groupName).toBe('Group Alpha');
    });

    it('treats ZERO group-name matches as uncorrelated — neither sibling record is consumed', async () => {
      const admin = makeKeypair();
      const invitee = makeKeypair();
      await seedTwoRecordsForAdmin(admin.pubHex);

      mockGetWelcomeKeyPackageRefs.mockReturnValue([new Uint8Array([1])]);
      mockReadWelcomeMarmotGroupData.mockResolvedValue({ name: 'Some Unrelated Group' });

      const { wrap } = buildGenuineWrap({
        sender: admin,
        recipientPubHex: invitee.pubHex,
        kind: 444,
        content: 'welcome-payload',
      });

      const mockMarmotClient = makeMockMarmotClient({ idStr: 'should-not-join', state: {} });
      (mockMarmotClient.keyPackages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        publicPackage: { cipherSuite: 1 },
        privatePackage: {},
      });
      (mockMarmotClient.cryptoProvider.getCiphersuiteImpl as ReturnType<typeof vi.fn>).mockResolvedValue('ciphersuite-impl-stub');

      const { mockNdk, fireEvent } = makeNdkWithEventCapture();
      const unsub = await subscribeToWelcomes(
        invitee.pubHex,
        mockMarmotClient as never,
        mockNdk as never,
        createPrivateKeySigner(invitee.privHex),
        vi.fn(),
      );

      await fireEvent({ id: 'giftwrap-4a-zero-match', pubkey: wrap.pubkey, content: wrap.content });

      expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();
      expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);

      const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
      expect(remaining).toHaveLength(2);

      unsub();
    });

    it('treats MULTIPLE group-name matches (ambiguous) as uncorrelated — never arbitrarily consumes the first record', async () => {
      const admin = makeKeypair();
      const invitee = makeKeypair();
      // Two records that (unusually) share the SAME group name under one admin.
      await saveOutboundJoinRequest({
        nonce: 'nonce-dup-1',
        adminPubkeyHex: admin.pubHex,
        groupName: 'Shared Name',
        sentAt: Date.now(),
      });
      await saveOutboundJoinRequest({
        nonce: 'nonce-dup-2',
        adminPubkeyHex: admin.pubHex,
        groupName: 'Shared Name',
        sentAt: Date.now(),
      });

      mockGetWelcomeKeyPackageRefs.mockReturnValue([new Uint8Array([1])]);
      mockReadWelcomeMarmotGroupData.mockResolvedValue({ name: 'Shared Name' });

      const { wrap } = buildGenuineWrap({
        sender: admin,
        recipientPubHex: invitee.pubHex,
        kind: 444,
        content: 'welcome-payload',
      });

      const mockMarmotClient = makeMockMarmotClient({ idStr: 'should-not-join', state: {} });
      (mockMarmotClient.keyPackages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        publicPackage: { cipherSuite: 1 },
        privatePackage: {},
      });
      (mockMarmotClient.cryptoProvider.getCiphersuiteImpl as ReturnType<typeof vi.fn>).mockResolvedValue('ciphersuite-impl-stub');

      const { mockNdk, fireEvent } = makeNdkWithEventCapture();
      const unsub = await subscribeToWelcomes(
        invitee.pubHex,
        mockMarmotClient as never,
        mockNdk as never,
        createPrivateKeySigner(invitee.privHex),
        vi.fn(),
      );

      await fireEvent({ id: 'giftwrap-4a-ambiguous', pubkey: wrap.pubkey, content: wrap.content });

      expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();
      expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);

      const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
      expect(remaining).toHaveLength(2);

      unsub();
    });
  });

  // ── AC-AUTO-4a Amendment 1: the group check runs even for a SINGLE
  //    candidate — no single-candidate shortcut ─────────────────────────
  describe('AC-AUTO-4a Amendment 1: group check applies even when exactly one candidate exists', () => {
    it('a single unexpired record whose groupName does NOT match the Welcome\'s readable group is NOT auto-accepted — pending, and the record survives (regression test for the fixed bug)', async () => {
      const admin = makeKeypair();
      const invitee = makeKeypair();

      await saveOutboundJoinRequest({
        nonce: 'nonce-single-mismatch-1',
        adminPubkeyHex: admin.pubHex,
        groupName: 'Group Requested',
        sentAt: Date.now(),
      });

      // The Welcome's real pre-join group name IS readable and does NOT
      // match the sole candidate's stored groupName. Before Amendment 1,
      // `resolveAutoAcceptRecord`'s `if (candidates.length === 1) return
      // candidates[0];` shortcut skipped this check entirely and would
      // have auto-accepted anyway — that is the bug this test guards.
      mockGetWelcomeKeyPackageRefs.mockReturnValue([new Uint8Array([9, 9, 9])]);
      mockReadWelcomeMarmotGroupData.mockResolvedValue({ name: 'Different Group Entirely' });

      const { wrap } = buildGenuineWrap({
        sender: admin,
        recipientPubHex: invitee.pubHex,
        kind: 444,
        content: 'welcome-payload',
      });

      const mockMarmotClient = makeMockMarmotClient({ idStr: 'should-not-join', state: {} });
      (mockMarmotClient.keyPackages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        publicPackage: { cipherSuite: 1 },
        privatePackage: {},
      });
      (mockMarmotClient.cryptoProvider.getCiphersuiteImpl as ReturnType<typeof vi.fn>).mockResolvedValue('ciphersuite-impl-stub');

      const { mockNdk, fireEvent } = makeNdkWithEventCapture();
      const unsub = await subscribeToWelcomes(
        invitee.pubHex,
        mockMarmotClient as never,
        mockNdk as never,
        createPrivateKeySigner(invitee.privHex),
        vi.fn(),
      );

      await fireEvent({ id: 'giftwrap-single-mismatch-1', pubkey: wrap.pubkey, content: wrap.content });

      expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();
      expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);

      const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].nonce).toBe('nonce-single-mismatch-1');

      unsub();
    });

    it('a single unexpired record whose groupName DOES match the Welcome\'s readable group is auto-accepted and consumed (happy path still works with the group check)', async () => {
      const admin = makeKeypair();
      const invitee = makeKeypair();

      await saveOutboundJoinRequest({
        nonce: 'nonce-single-match-1',
        adminPubkeyHex: admin.pubHex,
        groupName: 'Group Requested',
        sentAt: Date.now(),
      });

      mockGetWelcomeKeyPackageRefs.mockReturnValue([new Uint8Array([9, 9, 9])]);
      mockReadWelcomeMarmotGroupData.mockResolvedValue({ name: 'Group Requested' });

      const { wrap } = buildGenuineWrap({
        sender: admin,
        recipientPubHex: invitee.pubHex,
        kind: 444,
        content: 'welcome-payload',
      });

      const mockMarmotClient = makeMockMarmotClient({
        idStr: 'joined-single-match',
        groupData: { name: 'Group Requested' },
        state: {},
      });
      (mockMarmotClient.keyPackages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        publicPackage: { cipherSuite: 1 },
        privatePackage: {},
      });
      (mockMarmotClient.cryptoProvider.getCiphersuiteImpl as ReturnType<typeof vi.fn>).mockResolvedValue('ciphersuite-impl-stub');

      const onGroupJoined = vi.fn();
      const { mockNdk, fireEvent } = makeNdkWithEventCapture();
      const unsub = await subscribeToWelcomes(
        invitee.pubHex,
        mockMarmotClient as never,
        mockNdk as never,
        createPrivateKeySigner(invitee.privHex),
        onGroupJoined,
      );

      await fireEvent({ id: 'giftwrap-single-match-1', pubkey: wrap.pubkey, content: wrap.content });

      expect(mockEnqueuePendingInvitation).not.toHaveBeenCalled();
      expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
      expect(onGroupJoined).toHaveBeenCalledTimes(1);

      const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
      expect(remaining).toEqual([]);

      unsub();
    });

    it('group name unreadable (no local key package matches) + exactly one candidate → admin-match fallback auto-accepts', async () => {
      const admin = makeKeypair();
      const invitee = makeKeypair();

      await saveOutboundJoinRequest({
        nonce: 'nonce-fallback-single-1',
        adminPubkeyHex: admin.pubHex,
        groupName: 'Group Fallback',
        sentAt: Date.now(),
      });

      // A key package ref exists, but no local key package matches it, so
      // readPreJoinGroupName's loop exhausts without a match and returns
      // null — the group name is NOT readable, so correlation falls back
      // to the admin-only match.
      mockGetWelcomeKeyPackageRefs.mockReturnValue([new Uint8Array([7, 7, 7])]);
      mockReadWelcomeMarmotGroupData.mockResolvedValue(null);

      const { wrap } = buildGenuineWrap({
        sender: admin,
        recipientPubHex: invitee.pubHex,
        kind: 444,
        content: 'welcome-payload',
      });

      const mockMarmotClient = makeMockMarmotClient({
        idStr: 'joined-fallback-single',
        groupData: { name: 'Group Fallback' },
        state: {},
      });
      // No local key package for this ref — readPreJoinGroupName's
      // `if (!stored?.privatePackage) continue;` guard skips it.
      (mockMarmotClient.keyPackages.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const onGroupJoined = vi.fn();
      const { mockNdk, fireEvent } = makeNdkWithEventCapture();
      const unsub = await subscribeToWelcomes(
        invitee.pubHex,
        mockMarmotClient as never,
        mockNdk as never,
        createPrivateKeySigner(invitee.privHex),
        onGroupJoined,
      );

      await fireEvent({ id: 'giftwrap-fallback-single-1', pubkey: wrap.pubkey, content: wrap.content });

      expect(mockEnqueuePendingInvitation).not.toHaveBeenCalled();
      expect(mockMarmotClient.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
      expect(onGroupJoined).toHaveBeenCalledTimes(1);

      const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
      expect(remaining).toEqual([]);

      unsub();
    });

    it('group name unreadable + two candidates for the same admin → uncorrelated (pending), both records survive', async () => {
      const admin = makeKeypair();
      const invitee = makeKeypair();

      await saveOutboundJoinRequest({
        nonce: 'nonce-fallback-multi-a',
        adminPubkeyHex: admin.pubHex,
        groupName: 'Group Fallback A',
        sentAt: Date.now(),
      });
      await saveOutboundJoinRequest({
        nonce: 'nonce-fallback-multi-b',
        adminPubkeyHex: admin.pubHex,
        groupName: 'Group Fallback B',
        sentAt: Date.now(),
      });

      // No key package refs at all — the group name is unreadable.
      mockGetWelcomeKeyPackageRefs.mockReturnValue([]);

      const { wrap } = buildGenuineWrap({
        sender: admin,
        recipientPubHex: invitee.pubHex,
        kind: 444,
        content: 'welcome-payload',
      });

      const mockMarmotClient = makeMockMarmotClient({ idStr: 'should-not-join', state: {} });
      const { mockNdk, fireEvent } = makeNdkWithEventCapture();
      const unsub = await subscribeToWelcomes(
        invitee.pubHex,
        mockMarmotClient as never,
        mockNdk as never,
        createPrivateKeySigner(invitee.privHex),
        vi.fn(),
      );

      await fireEvent({ id: 'giftwrap-fallback-multi-1', pubkey: wrap.pubkey, content: wrap.content });

      expect(mockMarmotClient.joinGroupFromWelcome).not.toHaveBeenCalled();
      expect(mockEnqueuePendingInvitation).toHaveBeenCalledTimes(1);

      const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin(admin.pubHex);
      expect(remaining).toHaveLength(2);

      unsub();
    });
  });

  // ── AC-AUTO-2 (join core parity): the shared core produces the same
  //    Group shape auto-accept and manual accept both rely on ─────────────

  it('AC-AUTO-2: joinGroupFromWelcome is invoked with the decrypted rumor payload the shared join core uses to build the overlay Group (matches manual accept field-for-field)', async () => {
    const admin = makeKeypair();
    const invitee = makeKeypair();

    await saveOutboundJoinRequest({
      nonce: 'nonce-parity-1',
      adminPubkeyHex: admin.pubHex,
      groupName: 'Group Parity',
      sentAt: Date.now(),
    });

    mockGetGroupMembers.mockReturnValue(['member-a', 'member-b']);

    const { wrap } = buildGenuineWrap({
      sender: admin,
      recipientPubHex: invitee.pubHex,
      kind: 444,
      content: 'welcome-payload',
    });

    const mockMarmotClient = makeMockMarmotClient({
      idStr: 'joined-group-parity',
      groupData: { name: 'Group Parity' },
      relays: ['wss://relay.parity.example'],
      state: { fake: 'state' },
    });
    const onGroupJoined = vi.fn();
    const { mockNdk, fireEvent } = makeNdkWithEventCapture();

    const unsub = await subscribeToWelcomes(
      invitee.pubHex,
      mockMarmotClient as never,
      mockNdk as never,
      createPrivateKeySigner(invitee.privHex),
      onGroupJoined,
    );

    await fireEvent({ id: 'giftwrap-parity-1', pubkey: wrap.pubkey, content: wrap.content });

    expect(onGroupJoined).toHaveBeenCalledTimes(1);
    const [joinedGroup] = onGroupJoined.mock.calls[0] as [{
      id: string; name: string; memberPubkeys: string[]; relays: string[]; createdAt: number;
    }];
    expect(joinedGroup.id).toBe('joined-group-parity');
    expect(joinedGroup.name).toBe('Group Parity');
    expect(joinedGroup.memberPubkeys).toEqual(['member-a', 'member-b']);
    expect(joinedGroup.relays).toEqual(['wss://relay.parity.example']);
    expect(typeof joinedGroup.createdAt).toBe('number');

    unsub();
  });
});
