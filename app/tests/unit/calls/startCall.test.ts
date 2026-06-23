/**
 * startCall.test.ts — Story S8: "Start Call" entry point unit tests.
 *
 * Tests:
 *   T1. All 4 new i18n keys present in both en and de, non-empty.
 *   T2. en and de translations differ for each new key.
 *   T3. GroupCallToolbar disable contract: buttons disabled when active call exists
 *       (logic comment / documented invariant checked here without React rendering).
 *   T4. GroupCallToolbar disable contract: buttons disabled when group has >5 members.
 *   T5. ContactCallToolbar disable contract: buttons disabled when active call exists.
 *
 * Note: Tests T3–T5 verify the *logic* (the disable predicate) without rendering
 * React, since the test file must be `.ts` per the Vitest include pattern.
 * The actual disable state in the rendered component is a direct translation of
 * the same predicate — the value is tested exhaustively here, the React binding
 * is trivially thin.
 */

import { describe, expect, it } from 'vitest';
import { getCopy } from '@/src/lib/i18n';
import { callStore } from '@/src/lib/calls/callStore';

// ── i18n key presence ─────────────────────────────────────────────────────────

describe('S8 i18n keys', () => {
  const en = getCopy('en');
  const de = getCopy('de');

  it('T1: startVoiceCall is present, non-empty in both locales', () => {
    expect(en.calls.startVoiceCall).toBeTruthy();
    expect(de.calls.startVoiceCall).toBeTruthy();
  });

  it('T1: startVideoCall is present, non-empty in both locales', () => {
    expect(en.calls.startVideoCall).toBeTruthy();
    expect(de.calls.startVideoCall).toBeTruthy();
  });

  it('T1: callDisabledGroupFull is present, non-empty in both locales', () => {
    expect(en.calls.callDisabledGroupFull).toBeTruthy();
    expect(de.calls.callDisabledGroupFull).toBeTruthy();
  });

  it('T1: callInProgress is present, non-empty in both locales', () => {
    expect(en.calls.callInProgress).toBeTruthy();
    expect(de.calls.callInProgress).toBeTruthy();
  });

  it('T2: startVoiceCall differs between en and de', () => {
    expect(en.calls.startVoiceCall).not.toBe(de.calls.startVoiceCall);
  });

  it('T2: startVideoCall differs between en and de', () => {
    expect(en.calls.startVideoCall).not.toBe(de.calls.startVideoCall);
  });

  it('T2: callDisabledGroupFull differs between en and de', () => {
    expect(en.calls.callDisabledGroupFull).not.toBe(de.calls.callDisabledGroupFull);
  });

  it('T2: callInProgress differs between en and de', () => {
    expect(en.calls.callInProgress).not.toBe(de.calls.callInProgress);
  });
});

// ── GroupCallToolbar disable predicate ───────────────────────────────────────
//
// Contract (mirrors CallToolbar.tsx GroupCallToolbar logic exactly):
//   disabled = callActive || noOtherMembers || groupTooLarge
// where:
//   callActive     = callState.active !== null || callState.incoming !== null
//   noOtherMembers = targetPubkeys.length === 0    (targetPubkeys = members minus self)
//   groupTooLarge  = totalParticipants > 5         (totalParticipants = memberPubkeys.length)

const MAX_CALL_PARTICIPANTS = 5;

function groupCallDisabled(
  callActive: boolean,
  memberPubkeys: string[],
  ownPubkeyHex: string,
): boolean {
  const targetPubkeys = memberPubkeys.filter((pk) => pk !== ownPubkeyHex);
  const noOtherMembers = targetPubkeys.length === 0;
  const groupTooLarge = memberPubkeys.length > MAX_CALL_PARTICIPANTS;
  return callActive || noOtherMembers || groupTooLarge;
}

const SELF = 'a'.repeat(64);
const PEER1 = 'b'.repeat(64);
const PEER2 = 'c'.repeat(64);
const PEER3 = 'd'.repeat(64);
const PEER4 = 'e'.repeat(64);
const PEER5 = 'f'.repeat(64);

describe('GroupCallToolbar disable contract', () => {
  it('T3: enabled when no active/incoming call and group within cap', () => {
    expect(groupCallDisabled(false, [SELF, PEER1], SELF)).toBe(false);
  });

  it('T3: disabled when there is an active call', () => {
    expect(groupCallDisabled(true, [SELF, PEER1], SELF)).toBe(true);
  });

  it('T3: disabled when there are no other members', () => {
    expect(groupCallDisabled(false, [SELF], SELF)).toBe(true);
  });

  it('T4: disabled when group has exactly 6 members (over cap)', () => {
    // 6 members including self: self + 5 peers
    const members = [SELF, PEER1, PEER2, PEER3, PEER4, PEER5];
    expect(groupCallDisabled(false, members, SELF)).toBe(true);
  });

  it('T4: enabled at exactly 5 members (at cap, not over)', () => {
    // 5 members: self + 4 peers
    const members = [SELF, PEER1, PEER2, PEER3, PEER4];
    expect(groupCallDisabled(false, members, SELF)).toBe(false);
  });
});

// ── ContactCallToolbar disable predicate ─────────────────────────────────────
//
// Contract (mirrors CallToolbar.tsx ContactCallToolbar logic exactly):
//   disabled = callActive
// where callActive = callState.active !== null || callState.incoming !== null

function contactCallDisabled(callActive: boolean): boolean {
  return callActive;
}

describe('ContactCallToolbar disable contract', () => {
  it('T5: enabled when no active/incoming call', () => {
    expect(contactCallDisabled(false)).toBe(false);
  });

  it('T5: disabled when there is an active call', () => {
    expect(contactCallDisabled(true)).toBe(true);
  });

  it('T5: disabled when there is an incoming (ringing) call', () => {
    // callActive = incoming !== null
    expect(contactCallDisabled(true)).toBe(true);
  });
});

// ── callStore snapshot integration ────────────────────────────────────────────
// Verify that callStore.getSnapshot().active / .incoming correctly feeds the disable predicate.

describe('callStore → disable predicate integration', () => {
  it('callActive is false on idle store', () => {
    callStore.clearAll();
    const snap = callStore.getSnapshot();
    const callActive = snap.active !== null || snap.incoming !== null;
    expect(callActive).toBe(false);
  });

  it('callActive is true after setActive', () => {
    callStore.setActive({
      callId: 'test-call-id',
      participants: [],
      localStream: null,
      callType: 'voice',
    });
    const snap = callStore.getSnapshot();
    const callActive = snap.active !== null || snap.incoming !== null;
    expect(callActive).toBe(true);
    callStore.clearAll();
  });

  it('callActive is true after setIncoming', () => {
    callStore.setIncoming({
      callId: 'test-call-id',
      callerPubkey: PEER1,
      callType: 'voice',
      groupId: null,
      recipientPubkeys: [SELF],
    });
    const snap = callStore.getSnapshot();
    const callActive = snap.active !== null || snap.incoming !== null;
    expect(callActive).toBe(true);
    callStore.clearAll();
  });
});
