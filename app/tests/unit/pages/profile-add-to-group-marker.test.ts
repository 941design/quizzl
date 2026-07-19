/**
 * profile-add-to-group-marker.test.ts — unit tests for
 * `addToGroupWithMarker`, exported from `app/pages/profile.tsx` (epic:
 * invite-rescind-and-member-removal, story S8).
 *
 * This is the profile.tsx mirror of InviteMemberModal.tsx's
 * `submitInviteWithMarker` (S7) — see
 * tests/unit/cards/inviteByCard.test.ts's "submitInviteWithMarker" describe
 * block for the landed sibling coverage this file mirrors. `markPendingDirectInvite`
 * and `clearPendingDirectInvite` are injected as markerDeps — vi.fn() spies, NOT
 * the real pendingDirectInviteStorage.ts store — so this test needs no real IDB.
 *
 * `profile.tsx` is a page component (Chakra/Next imports) — this repo has no
 * jsdom/@testing-library/renderHook precedent, so only the exported
 * pure/async function is exercised here (mirrors
 * profile-announce-fanout.test.ts's import style — `@/pages/profile` module
 * imports cleanly without mounting React or touching the DOM).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addToGroupWithMarker } from '@/pages/profile';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';

const GROUP_ID = 'group-under-test';
// A 64-char hex fixture, styled like inviteByCard.test.ts's generated pubkeys.
const PUBKEY_HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('addToGroupWithMarker — pending-direct-invite marker bookkeeping around inviteByNpub', () => {
  it('AC-MARKER-1: awaits markPendingDirectInvite(groupId, pubkeyHex) to completion before inviteByNpub runs, calling inviteByNpub with (groupId, pubkeyToNpub(pubkeyHex))', async () => {
    const expectedNpub = pubkeyToNpub(PUBKEY_HEX);
    const callOrder: string[] = [];

    const markPendingDirectInvite = vi.fn(async (groupId: string, pubkey: string) => {
      expect(groupId).toBe(GROUP_ID);
      expect(pubkey).toBe(PUBKEY_HEX);
      callOrder.push('mark');
    });
    const clearPendingDirectInvite = vi.fn(async () => {
      callOrder.push('clear');
    });

    const inviteByNpub = vi.fn(async (groupId: string, npub: string) => {
      // Assert the marker write already settled before inviteByNpub runs —
      // call ORDER, not just "both got called".
      expect(callOrder).toEqual(['mark']);
      expect(groupId).toBe(GROUP_ID);
      expect(npub).toBe(expectedNpub);
      callOrder.push('invite');
      return { ok: true };
    });

    const result = await addToGroupWithMarker(PUBKEY_HEX, GROUP_ID, inviteByNpub, {
      markPendingDirectInvite,
      clearPendingDirectInvite,
    });

    expect(result).toEqual({ ok: true });
    expect(markPendingDirectInvite).toHaveBeenCalledTimes(1);
    expect(markPendingDirectInvite).toHaveBeenCalledWith(GROUP_ID, PUBKEY_HEX);
    expect(inviteByNpub).toHaveBeenCalledTimes(1);
    expect(inviteByNpub).toHaveBeenCalledWith(GROUP_ID, expectedNpub);
    expect(callOrder).toEqual(['mark', 'invite']);
    expect(clearPendingDirectInvite).not.toHaveBeenCalled();
  });

  it('AC-MARKER-2: a throwing markPendingDirectInvite is caught, logged via console.warn, and does not block inviteByNpub', async () => {
    const expectedNpub = pubkeyToNpub(PUBKEY_HEX);
    const markerError = new Error('idb quota exceeded');

    const markPendingDirectInvite = vi.fn(async () => {
      throw markerError;
    });
    const clearPendingDirectInvite = vi.fn(async () => {});
    const inviteByNpub = vi.fn(async () => ({ ok: true }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await addToGroupWithMarker(PUBKEY_HEX, GROUP_ID, inviteByNpub, {
      markPendingDirectInvite,
      clearPendingDirectInvite,
    });

    expect(inviteByNpub).toHaveBeenCalledTimes(1);
    expect(inviteByNpub).toHaveBeenCalledWith(GROUP_ID, expectedNpub);
    expect(result).toEqual({ ok: true });
    expect(warnSpy).toHaveBeenCalled();
    const loggedWithContext = warnSpy.mock.calls.some(
      (call) => String(call[0]).includes('ProfilePage') && call.includes(markerError),
    );
    expect(loggedWithContext).toBe(true);
  });

  it('AC-MARKER-3: clears the marker (same groupId/pubkeyHex as the write) exactly once, on an inviteByNpub {ok:false} failure', async () => {
    const callOrder: string[] = [];

    const markPendingDirectInvite = vi.fn(async () => {
      callOrder.push('mark');
    });
    const clearPendingDirectInvite = vi.fn(async (groupId: string, pubkey: string) => {
      expect(groupId).toBe(GROUP_ID);
      expect(pubkey).toBe(PUBKEY_HEX);
      // Resolve after a microtask so a caller that didn't truly await this
      // promise would observe the wrong order.
      await Promise.resolve();
      callOrder.push('clear');
    });
    const inviteByNpub = vi.fn(async () => {
      callOrder.push('invite');
      return { ok: false, error: 'timeout' };
    });

    const result = await addToGroupWithMarker(PUBKEY_HEX, GROUP_ID, inviteByNpub, {
      markPendingDirectInvite,
      clearPendingDirectInvite,
    });

    expect(clearPendingDirectInvite).toHaveBeenCalledTimes(1);
    expect(clearPendingDirectInvite).toHaveBeenCalledWith(GROUP_ID, PUBKEY_HEX);
    expect(callOrder).toEqual(['mark', 'invite', 'clear']);
    expect(result).toEqual({ ok: false, error: 'timeout' });
  });

  it('regression guard: a successful inviteByNpub result never triggers a marker clear', async () => {
    const markPendingDirectInvite = vi.fn(async () => {});
    const clearPendingDirectInvite = vi.fn(async () => {});
    const inviteByNpub = vi.fn(async () => ({ ok: true }));

    const result = await addToGroupWithMarker(PUBKEY_HEX, GROUP_ID, inviteByNpub, {
      markPendingDirectInvite,
      clearPendingDirectInvite,
    });

    expect(result).toEqual({ ok: true });
    expect(clearPendingDirectInvite).not.toHaveBeenCalled();
  });

  it('a throwing clearPendingDirectInvite in the {ok:false} path is caught/logged (best-effort) and the function still returns the original failure result', async () => {
    const clearError = new Error('idb unavailable');

    const markPendingDirectInvite = vi.fn(async () => {});
    const clearPendingDirectInvite = vi.fn(async () => {
      throw clearError;
    });
    const inviteByNpub = vi.fn(async () => ({ ok: false, error: 'no_key_package' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await addToGroupWithMarker(PUBKEY_HEX, GROUP_ID, inviteByNpub, {
      markPendingDirectInvite,
      clearPendingDirectInvite,
    });

    expect(result).toEqual({ ok: false, error: 'no_key_package' });
    expect(warnSpy).toHaveBeenCalled();
    const loggedWithContext = warnSpy.mock.calls.some(
      (call) => String(call[0]).includes('ProfilePage') && call.includes(clearError),
    );
    expect(loggedWithContext).toBe(true);
  });
});
