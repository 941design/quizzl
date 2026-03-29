import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InviteLink } from '@/src/lib/marmot/inviteLinkStorage';
import type { PendingJoinRequest } from '@/src/lib/marmot/joinRequestStorage';

// In-memory stores for mocking
const inviteLinkStore = new Map<string, InviteLink>();
const joinRequestStore = new Map<string, PendingJoinRequest>();

vi.mock('@/src/lib/marmot/inviteLinkStorage', () => ({
  getInviteLink: vi.fn(async (nonce: string) => inviteLinkStore.get(nonce) ?? undefined),
}));

vi.mock('@/src/lib/marmot/joinRequestStorage', () => ({
  savePendingJoinRequest: vi.fn(async (req: PendingJoinRequest) => {
    // Dedup check (same as real implementation)
    const all = [...joinRequestStore.values()];
    if (all.some((r) => r.pubkeyHex === req.pubkeyHex && r.groupId === req.groupId)) return;
    joinRequestStore.set(req.eventId, req);
  }),
  loadPendingJoinRequests: vi.fn(async (groupId: string) => {
    return [...joinRequestStore.values()].filter((r) => r.groupId === groupId);
  }),
}));

const { handleJoinRequest, parseJoinRequestContent, JOIN_REQUEST_KIND } = await import(
  '@/src/lib/marmot/joinRequestHandler'
);

function makeInviteLink(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    nonce: 'valid-nonce',
    groupId: 'group-1',
    createdAt: 1000,
    label: undefined,
    muted: false,
    ...overrides,
  };
}

function makeRumor(overrides: Partial<{ pubkey: string; content: string }> = {}) {
  return {
    pubkey: 'requester-pk',
    content: JSON.stringify({ type: 'join_request', nonce: 'valid-nonce', name: 'Test Group' }),
    ...overrides,
  };
}

describe('joinRequestHandler', () => {
  beforeEach(() => {
    inviteLinkStore.clear();
    joinRequestStore.clear();
  });

  describe('parseJoinRequestContent', () => {
    it('parses valid join request content', () => {
      const result = parseJoinRequestContent(
        JSON.stringify({ type: 'join_request', nonce: 'n1', name: 'Group A' })
      );
      expect(result).toEqual({ type: 'join_request', nonce: 'n1', name: 'Group A' });
    });

    it('returns null for invalid JSON', () => {
      expect(parseJoinRequestContent('not-json')).toBeNull();
    });

    it('returns null for missing type field', () => {
      expect(parseJoinRequestContent(JSON.stringify({ nonce: 'n', name: 'G' }))).toBeNull();
    });

    it('returns null for wrong type value', () => {
      expect(parseJoinRequestContent(JSON.stringify({ type: 'other', nonce: 'n', name: 'G' }))).toBeNull();
    });

    it('returns null for missing nonce', () => {
      expect(parseJoinRequestContent(JSON.stringify({ type: 'join_request', name: 'G' }))).toBeNull();
    });

    it('returns null for missing name', () => {
      expect(parseJoinRequestContent(JSON.stringify({ type: 'join_request', nonce: 'n' }))).toBeNull();
    });
  });

  describe('handleJoinRequest', () => {
    const noMembers = () => [] as string[];

    it('persists a valid join request and returns it', async () => {
      inviteLinkStore.set('valid-nonce', makeInviteLink());

      const result = await handleJoinRequest(makeRumor(), 'evt-1', noMembers);

      expect(result).not.toBeNull();
      expect(result!.pubkeyHex).toBe('requester-pk');
      expect(result!.groupId).toBe('group-1');
      expect(result!.nonce).toBe('valid-nonce');
      expect(result!.eventId).toBe('evt-1');
      expect(joinRequestStore.has('evt-1')).toBe(true);
    });

    it('discards when content is not a valid join request', async () => {
      const result = await handleJoinRequest(
        { pubkey: 'pk', content: 'not-json' },
        'evt-1',
        noMembers,
      );
      expect(result).toBeNull();
    });

    it('discards when nonce is not found in invite link storage', async () => {
      // Do not add nonce to store
      const result = await handleJoinRequest(makeRumor(), 'evt-1', noMembers);
      expect(result).toBeNull();
    });

    it('discards when invite link is muted', async () => {
      inviteLinkStore.set('valid-nonce', makeInviteLink({ muted: true }));

      const result = await handleJoinRequest(makeRumor(), 'evt-1', noMembers);
      expect(result).toBeNull();
    });

    it('discards when requester is already a group member', async () => {
      inviteLinkStore.set('valid-nonce', makeInviteLink());
      const memberCheck = (groupId: string) =>
        groupId === 'group-1' ? ['requester-pk', 'other-pk'] : [];

      const result = await handleJoinRequest(makeRumor(), 'evt-1', memberCheck);
      expect(result).toBeNull();
    });

    it('discards duplicate request (same pubkey + groupId already pending)', async () => {
      inviteLinkStore.set('valid-nonce', makeInviteLink());

      // First request succeeds
      const first = await handleJoinRequest(makeRumor(), 'evt-1', noMembers);
      expect(first).not.toBeNull();

      // Second request from same pubkey for same group is discarded
      const second = await handleJoinRequest(makeRumor(), 'evt-2', noMembers);
      expect(second).toBeNull();
    });

    it('allows same pubkey for different groups', async () => {
      inviteLinkStore.set('nonce-g1', makeInviteLink({ nonce: 'nonce-g1', groupId: 'group-1' }));
      inviteLinkStore.set('nonce-g2', makeInviteLink({ nonce: 'nonce-g2', groupId: 'group-2' }));

      const rumor1 = makeRumor({
        content: JSON.stringify({ type: 'join_request', nonce: 'nonce-g1', name: 'G1' }),
      });
      const rumor2 = makeRumor({
        content: JSON.stringify({ type: 'join_request', nonce: 'nonce-g2', name: 'G2' }),
      });

      const first = await handleJoinRequest(rumor1, 'evt-1', noMembers);
      const second = await handleJoinRequest(rumor2, 'evt-2', noMembers);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
    });

    it('resolves groupId from the invite link record, not from the rumor', async () => {
      inviteLinkStore.set('valid-nonce', makeInviteLink({ groupId: 'actual-group-id' }));

      const result = await handleJoinRequest(makeRumor(), 'evt-1', noMembers);
      expect(result!.groupId).toBe('actual-group-id');
    });
  });

  describe('JOIN_REQUEST_KIND constant', () => {
    it('is 21059', () => {
      expect(JOIN_REQUEST_KIND).toBe(21059);
    });
  });
});
