import { describe, it, expect, vi } from 'vitest';

const { buildJoinRequestRumor, JOIN_REQUEST_RUMOR_KIND } = await import(
  '@/src/lib/marmot/joinRequestSender'
);

describe('joinRequestSender', () => {
  describe('buildJoinRequestRumor', () => {
    it('creates a kind 21059 rumor', () => {
      const rumor = buildJoinRequestRumor({
        requesterPubkeyHex: 'aabb',
        adminPubkeyHex: 'ccdd',
        nonce: 'nonce123',
        groupName: 'Test Group',
      });

      expect(rumor.kind).toBe(21059);
      expect(rumor.kind).toBe(JOIN_REQUEST_RUMOR_KIND);
    });

    it('sets the requester pubkey as the event pubkey', () => {
      const rumor = buildJoinRequestRumor({
        requesterPubkeyHex: 'requester-pk',
        adminPubkeyHex: 'admin-pk',
        nonce: 'n1',
        groupName: 'G',
      });

      expect(rumor.pubkey).toBe('requester-pk');
    });

    it('includes a p-tag targeting the admin pubkey', () => {
      const rumor = buildJoinRequestRumor({
        requesterPubkeyHex: 'req',
        adminPubkeyHex: 'admin-hex',
        nonce: 'n1',
        groupName: 'G',
      });

      expect(rumor.tags).toEqual([['p', 'admin-hex']]);
    });

    it('encodes nonce and name in JSON content', () => {
      const rumor = buildJoinRequestRumor({
        requesterPubkeyHex: 'req',
        adminPubkeyHex: 'admin',
        nonce: 'my-nonce-value',
        groupName: 'Biology Study Group',
      });

      const parsed = JSON.parse(rumor.content);
      expect(parsed).toEqual({
        type: 'join_request',
        nonce: 'my-nonce-value',
        name: 'Biology Study Group',
      });
    });

    it('sets created_at to a recent unix timestamp', () => {
      const before = Math.floor(Date.now() / 1000) - 1;
      const rumor = buildJoinRequestRumor({
        requesterPubkeyHex: 'req',
        adminPubkeyHex: 'admin',
        nonce: 'n',
        groupName: 'G',
      });
      const after = Math.floor(Date.now() / 1000) + 1;

      expect(rumor.created_at).toBeGreaterThanOrEqual(before);
      expect(rumor.created_at).toBeLessThanOrEqual(after);
    });

    it('always sets type to "join_request" in content', () => {
      const rumor = buildJoinRequestRumor({
        requesterPubkeyHex: 'req',
        adminPubkeyHex: 'admin',
        nonce: 'n',
        groupName: 'G',
      });

      const parsed = JSON.parse(rumor.content);
      expect(parsed.type).toBe('join_request');
    });
  });

  describe('query param detection', () => {
    it('detects join request params from URL query', () => {
      const query = { join: 'nonce123', admin: 'npub1abc', name: 'Test Group' };

      expect(query.join).toBeDefined();
      expect(query.admin).toBeDefined();
      expect(query.name).toBeDefined();
    });

    it('returns undefined for missing params', () => {
      const query = { id: 'some-group' } as Record<string, string | undefined>;

      expect(query.join).toBeUndefined();
      expect(query.admin).toBeUndefined();
      expect(query.name).toBeUndefined();
    });
  });
});
