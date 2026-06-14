import { describe, it, expect, vi, afterEach } from 'vitest';

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

// Helper to set/clear window.location.origin for origin-derivation tests.
function setOrigin(origin: string | undefined): void {
  if (origin === undefined) {
    // Remove window entirely to exercise the non-browser fallback path.
    vi.stubGlobal('window', undefined);
    return;
  }
  vi.stubGlobal('window', { location: { origin } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      setOrigin('https://nostling.941design.de');
      const url = buildInviteUrl({
        nonce: 'aabbccdd11223344aabbccdd11223344',
        adminNpub: 'npub1test123',
        groupName: 'Biology Study Group',
      });

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://nostling.941design.de/groups/');
      expect(parsed.searchParams.get('join')).toBe('aabbccdd11223344aabbccdd11223344');
      expect(parsed.searchParams.get('admin')).toBe('npub1test123');
      expect(parsed.searchParams.get('name')).toBe('Biology Study Group');
    });

    it('derives the base URL from the current document origin', () => {
      setOrigin('https://staging.example.test');
      const url = buildInviteUrl({
        nonce: 'aabbccdd11223344aabbccdd11223344',
        adminNpub: 'npub1abc',
        groupName: 'X',
      });
      expect(url.startsWith('https://staging.example.test/groups/?')).toBe(true);
    });

    it('works for a localhost origin (with port)', () => {
      setOrigin('http://localhost:3000');
      const url = buildInviteUrl({
        nonce: 'aabbccdd11223344aabbccdd11223344',
        adminNpub: 'npub1abc',
        groupName: 'X',
      });
      expect(url.startsWith('http://localhost:3000/groups/?')).toBe(true);
    });

    it('falls back to the production origin when no browser window exists', () => {
      setOrigin(undefined);
      const url = buildInviteUrl({
        nonce: 'aabbccdd11223344aabbccdd11223344',
        adminNpub: 'npub1abc',
        groupName: 'X',
      });
      expect(url.startsWith('https://nostling.941design.de/groups/?')).toBe(true);
    });

    it('uses a trailing slash on the /groups/ path (matches trailingSlash config)', () => {
      setOrigin('https://nostling.941design.de');
      const url = buildInviteUrl({
        nonce: '00000000000000000000000000000000',
        adminNpub: 'npub1x',
        groupName: 'X',
      });
      expect(new URL(url).pathname).toBe('/groups/');
    });

    it('URL-encodes the group name', () => {
      setOrigin('https://nostling.941design.de');
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
      setOrigin('https://nostling.941design.de');
      const url = buildInviteUrl({
        nonce: 'aabbccdd11223344aabbccdd11223344',
        adminNpub: 'npub1abc',
        groupName: 'Lerngruppe #1 (Deutsch)',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('name')).toBe('Lerngruppe #1 (Deutsch)');
    });

    it('preserves nonce and admin npub exactly', () => {
      setOrigin('https://nostling.941design.de');
      const nonce = 'ff00ff00ff00ff00ff00ff00ff00ff00';
      const adminNpub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqspmhp7';
      const url = buildInviteUrl({ nonce, adminNpub, groupName: 'Test' });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('join')).toBe(nonce);
      expect(parsed.searchParams.get('admin')).toBe(adminNpub);
    });
  });
});
