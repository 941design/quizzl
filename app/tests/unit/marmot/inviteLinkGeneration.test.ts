import { describe, it, expect, vi } from 'vitest';

// Mock crypto.getRandomValues for deterministic tests
const mockRandomValues = vi.fn((arr: Uint8Array) => {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = (i * 17 + 42) & 0xff;
  }
  return arr;
});

Object.defineProperty(globalThis, 'crypto', {
  value: { getRandomValues: mockRandomValues },
  writable: true,
});

const { generateNonce, buildInviteUrl } = await import(
  '@/src/lib/marmot/inviteLinkGeneration'
);

describe('inviteLinkGeneration', () => {
  describe('generateNonce', () => {
    it('returns a 32-character hex string (16 bytes)', () => {
      const nonce = generateNonce();
      expect(nonce).toHaveLength(32);
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('uses crypto.getRandomValues with a 16-byte buffer', () => {
      mockRandomValues.mockClear();
      generateNonce();
      expect(mockRandomValues).toHaveBeenCalledTimes(1);
      const arg = mockRandomValues.mock.calls[0][0];
      expect(arg).toBeInstanceOf(Uint8Array);
      expect(arg.length).toBe(16);
    });
  });

  describe('buildInviteUrl', () => {
    it('builds the correct URL with all parameters', () => {
      const url = buildInviteUrl({
        nonce: 'aabbccdd11223344aabbccdd11223344',
        adminNpub: 'npub1test123',
        groupName: 'Biology Study Group',
      });

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://quizzl.941design.de/groups');
      expect(parsed.searchParams.get('join')).toBe('aabbccdd11223344aabbccdd11223344');
      expect(parsed.searchParams.get('admin')).toBe('npub1test123');
      expect(parsed.searchParams.get('name')).toBe('Biology Study Group');
    });

    it('URL-encodes the group name', () => {
      const url = buildInviteUrl({
        nonce: 'aabbccdd11223344aabbccdd11223344',
        adminNpub: 'npub1abc',
        groupName: 'Mathe & Physik',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('name')).toBe('Mathe & Physik');
      // The raw URL should not contain bare & in the name value
      expect(url).not.toContain('name=Mathe & Physik');
    });

    it('handles special characters in group name', () => {
      const url = buildInviteUrl({
        nonce: 'aabbccdd11223344aabbccdd11223344',
        adminNpub: 'npub1abc',
        groupName: 'Lerngruppe #1 (Deutsch)',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('name')).toBe('Lerngruppe #1 (Deutsch)');
    });

    it('preserves nonce and admin npub exactly', () => {
      const nonce = 'ff00ff00ff00ff00ff00ff00ff00ff00';
      const adminNpub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqspmhp7';
      const url = buildInviteUrl({ nonce, adminNpub, groupName: 'Test' });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('join')).toBe(nonce);
      expect(parsed.searchParams.get('admin')).toBe(adminNpub);
    });

    it('uses the correct base URL', () => {
      const url = buildInviteUrl({
        nonce: '00000000000000000000000000000000',
        adminNpub: 'npub1x',
        groupName: 'X',
      });
      expect(url.startsWith('https://quizzl.941design.de/groups?')).toBe(true);
    });
  });
});
