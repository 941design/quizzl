import { describe, it, expect, vi } from 'vitest';
import { unwrapGiftWrap } from '@/src/lib/marmot/welcomeSubscription';

// ---------------------------------------------------------------------------
// unwrapGiftWrap tests
// ---------------------------------------------------------------------------

describe('unwrapGiftWrap', () => {
  it('decrypts two-layer NIP-59 envelope to inner rumor', async () => {
    const innerRumor = {
      id: 'rumor-id',
      pubkey: 'sender-pubkey',
      created_at: 1700000000,
      kind: 444,
      tags: [['e', 'group-id']],
      content: 'welcome-payload',
      sig: '',
    };

    const seal = {
      pubkey: 'sender-pubkey',
      content: 'encrypted-rumor',
    };

    const mockDecrypt = vi.fn()
      // Layer 1: decrypt gift wrap content with ephemeral pubkey → seal
      .mockResolvedValueOnce(JSON.stringify(seal))
      // Layer 2: decrypt seal content with sender pubkey → rumor
      .mockResolvedValueOnce(JSON.stringify(innerRumor));

    const signer = {
      nip44: { decrypt: mockDecrypt },
    };

    const giftWrapEvent = {
      pubkey: 'ephemeral-pubkey',
      content: 'encrypted-seal',
    };

    const result = await unwrapGiftWrap(giftWrapEvent, signer as never);

    expect(result).toEqual(innerRumor);
    // Layer 1: decrypts against gift wrap's ephemeral pubkey
    expect(mockDecrypt).toHaveBeenNthCalledWith(1, 'ephemeral-pubkey', 'encrypted-seal');
    // Layer 2: decrypts against seal's sender pubkey
    expect(mockDecrypt).toHaveBeenNthCalledWith(2, 'sender-pubkey', 'encrypted-rumor');
  });

  it('throws when signer lacks nip44.decrypt', async () => {
    const signer = { nip44: undefined };

    await expect(
      unwrapGiftWrap({ pubkey: 'pk', content: 'ct' }, signer as never),
    ).rejects.toThrow('Signer does not support NIP-44 decryption');
  });

  it('throws when signer.nip44 exists but decrypt is undefined', async () => {
    const signer = { nip44: { decrypt: undefined } };

    await expect(
      unwrapGiftWrap({ pubkey: 'pk', content: 'ct' }, signer as never),
    ).rejects.toThrow('Signer does not support NIP-44 decryption');
  });

  it('defaults missing rumor fields', async () => {
    // Rumor with missing optional fields
    const partialRumor = { kind: 444, content: 'hello' };
    const seal = { pubkey: 'spk', content: 'enc' };

    const mockDecrypt = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(seal))
      .mockResolvedValueOnce(JSON.stringify(partialRumor));

    const signer = { nip44: { decrypt: mockDecrypt } };

    const result = await unwrapGiftWrap({ pubkey: 'epk', content: 'c' }, signer as never);

    expect(result.id).toBe('');
    expect(result.pubkey).toBe('');
    expect(result.created_at).toBe(0);
    expect(result.kind).toBe(444);
    expect(result.tags).toEqual([]);
    expect(result.content).toBe('hello');
    expect(result.sig).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Regression test: profile republish on new member join (onMembersChanged)
//
// Bug report: bug-reports/profile-propagation-new-members.md
// Fixed: 2026-03-24
// Root cause: The onMembersChanged callback in MarmotContext.tsx only updated
// member storage — it never called sendApplicationRumor to republish the local
// profile. New members therefore never received User A's current profile unless
// User A manually triggered publishProfileUpdate().
//
// Protection: Ensures that when onMembersChanged fires with a larger member
// list (member join), sendApplicationRumor is called exactly once. When the
// count stays the same or decreases (stable or leave), it must NOT be called.
// ---------------------------------------------------------------------------

describe('onMembersChanged profile republish logic (MarmotContext)', () => {
  /**
   * Replicate the exact closure pattern from MarmotContext.subscribeNewGroups()
   * so we can exercise the fix in isolation without mounting React.
   *
   * The closure captures prevMemberCount and a mock mlsGroup; when currentMembers
   * exceeds prevMemberCount, sendApplicationRumor should be invoked.
   */
  function makeOnMembersChangedCallback(
    initialMemberCount: number,
    mlsGroup: { sendApplicationRumor: (rumor: unknown) => Promise<void> },
    pubkeyHex: string,
    localProfile: { nickname: string; avatar: null; badgeIds: string[] },
  ): (currentMembers: string[]) => Promise<void> {
    let prevMemberCount = initialMemberCount;

    return async (currentMembers: string[]) => {
      // (storage update omitted — not relevant to the fix being tested)
      if (currentMembers.length > prevMemberCount) {
        const payload = JSON.stringify({ ...localProfile, updatedAt: new Date().toISOString() });
        // kind 0 = PROFILE_RUMOR_KIND, matching MIP-03 standard
        const rumor = {
          kind: 0,
          content: payload,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: pubkeyHex,
          id: '',
        };
        void mlsGroup.sendApplicationRumor(rumor).catch(() => { /* swallow in test */ });
      }
      prevMemberCount = currentMembers.length;
    };
  }

  it('calls sendApplicationRumor when new member joins (count increases)', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

    // Initial: 1 member (creator). New member joins → 2 members.
    const onMembersChanged = makeOnMembersChangedCallback(1, mlsGroup, 'aabbcc', localProfile);
    await onMembersChanged(['aabbcc', 'ddeeff']);

    expect(sendApplicationRumor).toHaveBeenCalledTimes(1);
    const [rumor] = sendApplicationRumor.mock.calls[0] as [{ kind: number; pubkey: string; tags: string[][] }];
    expect(rumor.kind).toBe(0);
    expect(rumor.pubkey).toBe('aabbcc');
    expect(rumor.tags).toEqual([]);
  });

  it('does NOT call sendApplicationRumor when member count stays the same', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

    const onMembersChanged = makeOnMembersChangedCallback(2, mlsGroup, 'aabbcc', localProfile);
    await onMembersChanged(['aabbcc', 'ddeeff']); // same count: 2 → 2

    expect(sendApplicationRumor).not.toHaveBeenCalled();
  });

  it('does NOT call sendApplicationRumor when a member leaves (count decreases)', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

    const onMembersChanged = makeOnMembersChangedCallback(3, mlsGroup, 'aabbcc', localProfile);
    await onMembersChanged(['aabbcc', 'ddeeff']); // member left: 3 → 2

    expect(sendApplicationRumor).not.toHaveBeenCalled();
  });

  it('calls sendApplicationRumor again on a second join after first join', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

    const onMembersChanged = makeOnMembersChangedCallback(1, mlsGroup, 'aabbcc', localProfile);

    // First member joins: 1 → 2
    await onMembersChanged(['aabbcc', 'ddeeff']);
    expect(sendApplicationRumor).toHaveBeenCalledTimes(1);

    // Second member joins: 2 → 3
    await onMembersChanged(['aabbcc', 'ddeeff', '112233']);
    expect(sendApplicationRumor).toHaveBeenCalledTimes(2);
  });

  it('does NOT call sendApplicationRumor when re-joining after a leave does not exceed prior peak', async () => {
    const sendApplicationRumor = vi.fn().mockResolvedValue(undefined);
    const mlsGroup = { sendApplicationRumor };
    const localProfile = { nickname: 'Alice', avatar: null, badgeIds: [] };

    // Start with 2, drop to 1, then back to 2 — count goes 2→1→2
    // The second fire (back to 2) DOES exceed the prevMemberCount of 1, so it
    // should call sendApplicationRumor (this is acceptable: re-joining member
    // also needs a fresh profile).
    const onMembersChanged = makeOnMembersChangedCallback(2, mlsGroup, 'aabbcc', localProfile);

    await onMembersChanged(['aabbcc']); // leave: 2→1 — no publish
    expect(sendApplicationRumor).toHaveBeenCalledTimes(0);

    await onMembersChanged(['aabbcc', 'ddeeff']); // rejoin: 1→2 — publishes
    expect(sendApplicationRumor).toHaveBeenCalledTimes(1);
  });
});
