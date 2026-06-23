/**
 * Unit tests for callStore.ts — Story S2.
 *
 * Tests:
 *   T1. Initial state is { incoming: null, active: null }.
 *   T2. setIncoming(call) sets incoming; active remains null.
 *   T3. setActive(call) sets active; incoming becomes null (invariant).
 *   T4. setIncoming(null) clears incoming.
 *   T5. clearAll() resets both to null.
 *   T6. subscribe() listener fires on each mutation.
 *   T7. subscribe() returns a working unsubscribe function (listener not called after).
 *   T8. Invariant: setIncoming while active is set clears active.
 *   T9. Invariant: setActive while incoming is set clears incoming.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callStore } from '@/src/lib/calls/callStore';
import type { IncomingCall, ActiveCall } from '@/src/lib/calls/callStore';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CALLER_PUB = 'aaaa'.repeat(16);
const CALLEE_PUB = 'bbbb'.repeat(16);
const CALL_ID = '11111111-aaaa-bbbb-cccc-dddddddddddd';

function makeIncoming(overrides: Partial<IncomingCall> = {}): IncomingCall {
  return {
    callId: CALL_ID,
    callerPubkey: CALLER_PUB,
    callType: 'voice',
    groupId: null,
    recipientPubkeys: [CALLEE_PUB],
    ...overrides,
  };
}

function makeActive(overrides: Partial<ActiveCall> = {}): ActiveCall {
  return {
    callId: CALL_ID,
    participants: [],
    localStream: null,
    callType: 'voice',
    ...overrides,
  };
}

// ── Reset store state between tests ──────────────────────────────────────────

beforeEach(() => {
  callStore.clearAll();
});

afterEach(() => {
  callStore.clearAll();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('callStore', () => {
  it('T1: initial state is { incoming: null, active: null }', () => {
    const state = callStore.getSnapshot();
    expect(state).toEqual({ incoming: null, active: null });
  });

  it('T2: setIncoming(call) sets incoming; active remains null', () => {
    const call = makeIncoming();
    callStore.setIncoming(call);
    const state = callStore.getSnapshot();
    expect(state.incoming).toEqual(call);
    expect(state.active).toBeNull();
  });

  it('T3: setActive(call) sets active; incoming becomes null (invariant)', () => {
    // First set incoming, then set active — incoming must be cleared.
    callStore.setIncoming(makeIncoming());
    expect(callStore.getSnapshot().incoming).not.toBeNull();

    const active = makeActive();
    callStore.setActive(active);
    const state = callStore.getSnapshot();
    expect(state.active).toEqual(active);
    expect(state.incoming).toBeNull();
  });

  it('T4: setIncoming(null) clears incoming', () => {
    callStore.setIncoming(makeIncoming());
    callStore.setIncoming(null);
    expect(callStore.getSnapshot().incoming).toBeNull();
  });

  it('T5: clearAll() resets both to null', () => {
    callStore.setIncoming(makeIncoming());
    // Active is already null at this point (setIncoming clears it).
    // Set active directly to test clearAll resets it too.
    callStore.setActive(makeActive());
    callStore.clearAll();
    expect(callStore.getSnapshot()).toEqual({ incoming: null, active: null });
  });

  it('T6: subscribe() listener fires on each mutation', () => {
    const listener = vi.fn();
    const unsub = callStore.subscribe(listener);

    callStore.setIncoming(makeIncoming());
    callStore.setActive(makeActive());
    callStore.clearAll();

    expect(listener).toHaveBeenCalledTimes(3);
    unsub();
  });

  it('T7: subscribe() returns a working unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = callStore.subscribe(listener);

    callStore.setIncoming(makeIncoming());
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    callStore.setIncoming(null);
    // After unsubscribe, listener must NOT be called again.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('T8: setIncoming while active is set clears active (invariant)', () => {
    callStore.setActive(makeActive());
    expect(callStore.getSnapshot().active).not.toBeNull();

    callStore.setIncoming(makeIncoming({ callType: 'video' }));
    const state = callStore.getSnapshot();
    expect(state.incoming?.callType).toBe('video');
    expect(state.active).toBeNull();
  });

  it('T9: setActive while incoming is set clears incoming (invariant)', () => {
    callStore.setIncoming(makeIncoming());
    expect(callStore.getSnapshot().incoming).not.toBeNull();

    callStore.setActive(makeActive({ callType: 'video' }));
    const state = callStore.getSnapshot();
    expect(state.active?.callType).toBe('video');
    expect(state.incoming).toBeNull();
  });
});
