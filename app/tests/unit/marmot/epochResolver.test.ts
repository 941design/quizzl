import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitIsLower, EpochResolver } from '@/src/lib/marmot/epochResolver';
import type { NostrEvent, MlsGroupLike, EpochResolverCallbacks } from '@/src/lib/marmot/epochResolver';

// ---------------------------------------------------------------------------
// Mocks for marmot-ts
// ---------------------------------------------------------------------------

vi.mock('@internet-privacy/marmot-ts', () => ({
  serializeClientState: vi.fn((state: { _epoch: number }) => {
    // Encode epoch into bytes so deserialization can restore it
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, state._epoch ?? 0);
    return bytes;
  }),
  deserializeClientState: vi.fn((bytes: Uint8Array) => {
    const epoch = new DataView(bytes.buffer).getUint32(0);
    return { groupContext: { epoch: BigInt(epoch) }, _epoch: epoch };
  }),
  getEpoch: vi.fn((state: { _epoch?: number; groupContext?: { epoch: bigint } }) => {
    if (state._epoch !== undefined) return state._epoch;
    if (state.groupContext?.epoch !== undefined) return Number(state.groupContext.epoch);
    return 0;
  }),
  defaultMarmotClientConfig: { keyRetentionConfig: {} },
  getGroupMembers: vi.fn(() => ['member-a', 'member-b']),
  deserializeApplicationData: vi.fn((msg: Uint8Array) => {
    // Decode mock message bytes back to rumor object
    const text = new TextDecoder().decode(msg);
    try { return JSON.parse(text); } catch { return { id: '', kind: 0, pubkey: '', created_at: 0, content: text, tags: [] }; }
  }),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: overrides.id ?? 'evt-1',
    pubkey: overrides.pubkey ?? 'pk-1',
    created_at: overrides.created_at ?? 1000,
    kind: overrides.kind ?? 445,
    tags: overrides.tags ?? [],
    content: overrides.content ?? '',
    sig: overrides.sig ?? 'sig',
  };
}

function makeRumor(id: string) {
  return { id, kind: 9, pubkey: 'pk-1', created_at: 1000, content: `msg-${id}`, tags: [] };
}

function encodeRumor(rumor: ReturnType<typeof makeRumor>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(rumor));
}

/**
 * Build a mock MlsGroupLike whose `ingest` yields results according to a plan.
 * `ingestPlan` is a list of result arrays — one per `ingest()` call in order.
 */
function makeMlsGroup(opts: {
  initialEpoch?: number;
  ingestPlan?: Array<Array<{
    kind: string;
    result?: { kind: string; message?: Uint8Array };
    event?: NostrEvent;
    errors?: unknown[];
    reason?: string;
  }>>;
} = {}): MlsGroupLike & {
  _state: { _epoch: number; clientConfig: { keyRetentionConfig: Record<string, never> }; groupContext: { epoch: bigint } };
  save: ReturnType<typeof vi.fn>;
  _ingestCallIndex: number;
} {
  const epoch = opts.initialEpoch ?? 1;
  const state = {
    _epoch: epoch,
    clientConfig: { keyRetentionConfig: {} },
    groupContext: { epoch: BigInt(epoch) },
  };

  const plan = opts.ingestPlan ?? [];
  let callIndex = 0;

  const group = {
    _state: state,
    _ingestCallIndex: 0,
    get state() { return this._state as never; },
    set state(newState: never) { this._state = newState; },
    save: vi.fn().mockResolvedValue(undefined),
    ingest: vi.fn(function* (_events: NostrEvent[]) {
      const results = plan[callIndex] ?? [];
      callIndex++;
      group._ingestCallIndex = callIndex;
      for (const r of results) {
        yield r;
      }
    }) as never,
  };
  return group as never;
}

function makeCallbacks(): EpochResolverCallbacks & {
  onApplicationMessage: ReturnType<typeof vi.fn>;
  onMembersChanged: ReturnType<typeof vi.fn>;
} {
  return {
    onApplicationMessage: vi.fn(),
    onMembersChanged: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ----------- commitIsLower -----------

describe('commitIsLower', () => {
  it('returns true when a has lower created_at', () => {
    expect(commitIsLower({ created_at: 100, id: 'zzz' }, { created_at: 200, id: 'aaa' })).toBe(true);
  });

  it('returns false when a has higher created_at', () => {
    expect(commitIsLower({ created_at: 200, id: 'aaa' }, { created_at: 100, id: 'zzz' })).toBe(false);
  });

  it('tie-breaks by id (lexicographic) when created_at is equal', () => {
    expect(commitIsLower({ created_at: 100, id: 'aaa' }, { created_at: 100, id: 'bbb' })).toBe(true);
    expect(commitIsLower({ created_at: 100, id: 'bbb' }, { created_at: 100, id: 'aaa' })).toBe(false);
  });

  it('returns false when both are identical', () => {
    expect(commitIsLower({ created_at: 100, id: 'aaa' }, { created_at: 100, id: 'aaa' })).toBe(false);
  });
});

// ----------- Application message dispatch -----------

describe('EpochResolver — application message', () => {
  it('dispatches application message immediately via callback', async () => {
    const rumor = makeRumor('r1');
    const group = makeMlsGroup({
      initialEpoch: 1,
      ingestPlan: [
        [{ kind: 'processed', result: { kind: 'applicationMessage', message: encodeRumor(rumor) }, event: makeEvent() }],
      ],
    });
    const cb = makeCallbacks();
    const resolver = new EpochResolver(group as never, cb);

    await resolver.ingestEvent(makeEvent());

    expect(cb.onApplicationMessage).toHaveBeenCalledTimes(1);
    expect(cb.onApplicationMessage).toHaveBeenCalledWith(rumor);
  });
});

// ----------- Single commit processing -----------

describe('EpochResolver — single commit', () => {
  it('processes a single commit normally — snapshot taken, grace timer started', async () => {
    vi.useFakeTimers();
    try {
      const group = makeMlsGroup({
        initialEpoch: 1,
        ingestPlan: [
          [{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent({ id: 'commit-1' }) }],
        ],
      });
      const cb = makeCallbacks();
      const resolver = new EpochResolver(group as never, cb, { graceWindowMs: 3000 });

      await resolver.ingestEvent(makeEvent({ id: 'commit-1' }));

      // Members changed should have been called
      expect(cb.onMembersChanged).toHaveBeenCalledTimes(1);

      // Grace timer: save should NOT have been called yet
      expect(group.save).not.toHaveBeenCalled();

      // Advance past grace window
      vi.advanceTimersByTime(3001);

      // Now save should have been called (grace window expired)
      expect(group.save).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ----------- Competing commits: lower wins via rollback -----------

describe('EpochResolver — competing commits', () => {
  it('lower event ID wins via rollback when competing commit arrives', async () => {
    // First ingest: commit-bbb (higher ID) processes normally
    // Second ingest: commit-aaa (lower ID) is skipped as past-epoch by marmot-ts
    //   but our resolver detects it is lower → triggers rollback
    const group = makeMlsGroup({
      initialEpoch: 1,
      ingestPlan: [
        // Call 1: first commit processes, advances epoch
        [{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent({ id: 'commit-bbb', created_at: 1000 }) }],
        // (flushFutureBuffer short-circuits when buffer is empty — no ingest call)
        // Call 2: second (lower) commit skipped as past-epoch by marmot-ts
        [{ kind: 'skipped', event: makeEvent({ id: 'commit-aaa', created_at: 1000 }), reason: 'past-epoch' }],
        // Call 3: rollback replay ingest
        [{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent({ id: 'commit-aaa', created_at: 1000 }) }],
      ],
    });

    const cb = makeCallbacks();
    const resolver = new EpochResolver(group as never, cb, { graceWindowMs: 30000 });

    // First event: commit-bbb arrives and is processed
    await resolver.ingestEvent(makeEvent({ id: 'commit-bbb', created_at: 1000 }));
    expect(group.save).not.toHaveBeenCalled();

    // Second event: commit-aaa (lower) arrives — skipped by marmot-ts, but resolver detects rollback
    await resolver.ingestEvent(makeEvent({ id: 'commit-aaa', created_at: 1000 }));

    // rollbackAndReplay calls save
    expect(group.save).toHaveBeenCalled();

    resolver.dispose();
  });

  it('higher event ID is discarded when existing commit is lower', async () => {
    vi.useFakeTimers();
    try {
      // First ingest: commit-aaa (lower) processes normally
      // Second ingest: commit-bbb (higher) skipped as past-epoch — no rollback
      const group = makeMlsGroup({
        initialEpoch: 1,
        ingestPlan: [
          // Call 1: lower commit processed first
          [{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent({ id: 'commit-aaa', created_at: 1000 }) }],
          // (flushFutureBuffer short-circuits when buffer is empty)
          // Call 2: higher commit skipped as past-epoch by marmot-ts
          [{ kind: 'skipped', event: makeEvent({ id: 'commit-bbb', created_at: 1000 }), reason: 'past-epoch' }],
        ],
      });

      const cb = makeCallbacks();
      const resolver = new EpochResolver(group as never, cb, { graceWindowMs: 3000 });

      await resolver.ingestEvent(makeEvent({ id: 'commit-aaa', created_at: 1000 }));

      // Save should not have been called yet (only grace timer or rollback calls save)
      expect(group.save).not.toHaveBeenCalled();

      await resolver.ingestEvent(makeEvent({ id: 'commit-bbb', created_at: 1000 }));

      // No rollback triggered — save should still not have been called
      expect(group.save).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ----------- Unreadable event buffered and retried -----------

describe('EpochResolver — future buffer', () => {
  it('buffers unreadable events and retries after commit', async () => {
    vi.useFakeTimers();
    try {
      const rumor = makeRumor('buffered-msg');
      const group = makeMlsGroup({
        initialEpoch: 1,
        ingestPlan: [
          // Call 1: unreadable event
          [{ kind: 'unreadable', event: makeEvent({ id: 'future-evt' }), errors: ['future epoch'] }],
          // Call 2: commit arrives
          [{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent({ id: 'commit-1' }) }],
          // Call 3: flush future buffer — now the event is readable
          [{ kind: 'processed', result: { kind: 'applicationMessage', message: encodeRumor(rumor) }, event: makeEvent({ id: 'future-evt' }) }],
        ],
      });

      const cb = makeCallbacks();
      const resolver = new EpochResolver(group as never, cb, { graceWindowMs: 3000 });

      // Ingest unreadable event → goes to buffer
      await resolver.ingestEvent(makeEvent({ id: 'future-evt' }));
      expect(cb.onApplicationMessage).not.toHaveBeenCalled();

      // Ingest commit → triggers flush, buffered event now readable
      await resolver.ingestEvent(makeEvent({ id: 'commit-1' }));
      expect(cb.onApplicationMessage).toHaveBeenCalledTimes(1);
      expect(cb.onApplicationMessage).toHaveBeenCalledWith(rumor);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps buffer at maxBufferSize, evicting oldest by created_at', async () => {
    const plan: Array<Array<{ kind: string; event: NostrEvent; errors?: unknown[] }>> = [];
    // Generate 5 unreadable events
    for (let i = 0; i < 5; i++) {
      plan.push([{ kind: 'unreadable', event: makeEvent({ id: `evt-${i}`, created_at: 100 + i }), errors: [] }]);
    }

    const group = makeMlsGroup({ initialEpoch: 1, ingestPlan: plan as never });
    const cb = makeCallbacks();
    const resolver = new EpochResolver(group as never, cb, { maxBufferSize: 3 });

    for (let i = 0; i < 5; i++) {
      await resolver.ingestEvent(makeEvent({ id: `evt-${i}`, created_at: 100 + i }));
    }

    // Access the private futureBuffer via any cast for testing
    const buffer = (resolver as unknown as { futureBuffer: NostrEvent[] }).futureBuffer;
    expect(buffer.length).toBe(3);
    // Should keep the 3 newest (highest created_at)
    expect(buffer.map((e) => e.id)).toEqual(['evt-2', 'evt-3', 'evt-4']);
  });
});

// ----------- Grace window expiry -----------

describe('EpochResolver — grace window', () => {
  it('calls mlsGroup.save() when grace window expires', async () => {
    vi.useFakeTimers();
    try {
      const group = makeMlsGroup({
        initialEpoch: 1,
        ingestPlan: [
          [{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent({ id: 'commit-1' }) }],
        ],
      });
      const cb = makeCallbacks();
      const resolver = new EpochResolver(group as never, cb, { graceWindowMs: 2000 });

      await resolver.ingestEvent(makeEvent({ id: 'commit-1' }));
      expect(group.save).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2001);
      expect(group.save).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ----------- Processing lock serialises concurrent calls -----------

describe('EpochResolver — processing lock', () => {
  it('serialises concurrent ingestEvent calls', async () => {
    const callOrder: string[] = [];

    // Build a group whose ingest is async and records call order
    const group = makeMlsGroup({ initialEpoch: 1, ingestPlan: [] });

    // Override ingest to be async and track ordering
    let resolveFirst!: () => void;
    const firstBlocks = new Promise<void>((r) => { resolveFirst = r; });
    let ingestCallCount = 0;

    group.ingest = vi.fn(async function* (_events: NostrEvent[]) {
      ingestCallCount++;
      const myCall = ingestCallCount;
      callOrder.push(`start-${myCall}`);
      if (myCall === 1) {
        await firstBlocks;
      }
      callOrder.push(`end-${myCall}`);
    }) as never;

    const cb = makeCallbacks();
    const resolver = new EpochResolver(group as never, cb);

    // Fire two ingests concurrently
    const p1 = resolver.ingestEvent(makeEvent({ id: 'a' }));
    const p2 = resolver.ingestEvent(makeEvent({ id: 'b' }));

    // First call is blocking; second should not have started
    // Give microtasks time to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(callOrder).toEqual(['start-1']);

    // Release first
    resolveFirst();
    await p1;
    await p2;

    // Second call should start only after first ends
    expect(callOrder).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });
});

// ----------- onMembersChanged -----------

describe('EpochResolver — onMembersChanged', () => {
  it('calls onMembersChanged after each ingest cycle', async () => {
    const group = makeMlsGroup({
      initialEpoch: 1,
      ingestPlan: [
        [{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent() }],
      ],
    });
    const cb = makeCallbacks();
    const resolver = new EpochResolver(group as never, cb);

    await resolver.ingestEvent(makeEvent());

    expect(cb.onMembersChanged).toHaveBeenCalledTimes(1);
    expect(cb.onMembersChanged).toHaveBeenCalledWith(['member-a', 'member-b']);
  });
});

// ----------- dispose -----------

describe('EpochResolver — dispose', () => {
  it('clears timers and prevents further callbacks', async () => {
    vi.useFakeTimers();
    try {
      const group = makeMlsGroup({
        initialEpoch: 1,
        ingestPlan: [
          [{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent() }],
        ],
      });
      const cb = makeCallbacks();
      const resolver = new EpochResolver(group as never, cb, { graceWindowMs: 3000 });

      await resolver.ingestEvent(makeEvent());

      resolver.dispose();

      // Grace timer should have been cleared — save should never fire
      vi.advanceTimersByTime(5000);
      expect(group.save).not.toHaveBeenCalled();

      // Further ingestEvent should be no-op
      const group2 = makeMlsGroup({
        initialEpoch: 1,
        ingestPlan: [[{ kind: 'processed', result: { kind: 'newState' }, event: makeEvent() }]],
      });
      // After dispose, callbacks should not fire on new events
      cb.onMembersChanged.mockClear();
      await resolver.ingestEvent(makeEvent({ id: 'post-dispose' }));
      expect(cb.onMembersChanged).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
