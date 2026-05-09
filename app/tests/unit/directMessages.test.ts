import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { DIRECT_MEDIA_VERSION } from '@/src/lib/media/imageMessage';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

vi.mock('@/src/lib/media/blossomClient', () => ({
  put: vi.fn(),
  get: vi.fn(),
}));

const { get: blossomGet } = await import('@/src/lib/media/blossomClient');
const { getPublicKey } = await import('nostr-tools/pure');
const {
  directConversationId,
  encryptDirectPayload,
  decryptDirectPayload,
  encryptDirectMedia,
  decryptDirectMedia,
  parseDirectPayload,
} = await import('@/src/lib/directMessages');

describe('directMessages', () => {
  const alicePriv = 'bceef655b5a034911f1c3718ce056531b45ef03b4c7b1f15629e867294011a7d';
  const bobPriv = 'cbecda1c7d37d4c0aa5466243bb4a0018c31bf06d74fa7338290dd3068db4fed';
  const bobPub = getPublicKey(new Uint8Array(Buffer.from(bobPriv, 'hex')));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a stable conversation id per peer', () => {
    expect(directConversationId('ABCDEF')).toBe('dm:abcdef');
  });

  it('round-trips encrypted text payloads', async () => {
    const encrypted = await encryptDirectPayload(
      { type: 'text', text: 'hello bob' },
      alicePriv,
      bobPub,
    );

    const decrypted = await decryptDirectPayload(encrypted, alicePriv, bobPub);
    expect(decrypted).toEqual({ content: 'hello bob' });
  });

  it('round-trips encrypted image payloads with attachments', async () => {
    const encrypted = await encryptDirectPayload(
      {
        type: 'image',
        version: 1,
        caption: 'photo',
        attachments: {
          full: {
            url: 'https://example.test/full',
            sha256: 'a'.repeat(64),
            type: 'image/webp',
            filename: 'full.webp',
            nonce: 'b'.repeat(24),
            version: DIRECT_MEDIA_VERSION,
          },
          thumb: null,
        },
      },
      alicePriv,
      bobPub,
    );

    const decrypted = await decryptDirectPayload(encrypted, alicePriv, bobPub);
    expect(decrypted?.content).toContain('"type":"image"');
    expect(decrypted?.attachments?.full?.filename).toBe('full.webp');
  });

  it('encrypts and decrypts direct media blobs with integrity verification', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });
    const { encrypted, attachment } = await encryptDirectMedia(
      blob,
      {
        filename: 'photo.webp',
        type: 'image/webp',
      },
      alicePriv,
      bobPub,
    );

    vi.mocked(blossomGet).mockResolvedValue(encrypted as any);

    const decrypted = await decryptDirectMedia(
      { ...attachment, url: 'https://example.test/blob' },
      alicePriv,
      bobPub,
    );

    expect(Array.from(decrypted.bytes)).toEqual([1, 2, 3, 4]);
    expect(decrypted.type).toBe('image/webp');
  });
});

describe('parseDirectPayload — lenient parser (story-01, AC-01–AC-04)', () => {
  // Spies on console.warn and console.error for AC-31 logging assertion.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // AC-01: bare plaintext (non-JSON) → { content: raw }
  it('AC-01: parseDirectPayload("hello") returns { content: "hello" }', () => {
    expect(parseDirectPayload('hello')).toEqual({ content: 'hello' });
  });

  // AC-02: JSON text envelope → { content: decoded }
  it('AC-02: parseDirectPayload({"type":"text","text":"hi"}) returns { content: "hi" }', () => {
    expect(parseDirectPayload('{"type":"text","text":"hi"}')).toEqual({ content: 'hi' });
  });

  // AC-03: JSON unknown shape → { content: raw JSON string } (D1 decision)
  it('AC-03: parseDirectPayload({"unknown":"shape"}) returns { content: \'{"unknown":"shape"}\' }', () => {
    expect(parseDirectPayload('{"unknown":"shape"}')).toEqual({ content: '{"unknown":"shape"}' });
  });

  // AC-04: empty string → null (empty-after-decrypt guard)
  it('AC-04: parseDirectPayload("") returns null', () => {
    expect(parseDirectPayload('')).toBeNull();
  });

  // AC-31: no console.warn or console.error in any new path
  it('AC-31: no console.warn or console.error in new parseDirectPayload paths', () => {
    parseDirectPayload('hello');
    parseDirectPayload('{"unknown":"shape"}');
    parseDirectPayload('{"type":"text","text":"hi"}');
    parseDirectPayload('');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Image envelope — verify no regression on the happy path (AC-05)
  it('AC-05: parseDirectPayload image envelope returns content and attachments', () => {
    const raw = JSON.stringify({
      type: 'image',
      version: 1,
      caption: 'photo caption',
      attachments: {
        full: { url: 'https://example.test/full', sha256: 'a'.repeat(64), type: 'image/webp', filename: 'full.webp', nonce: 'b'.repeat(24), version: DIRECT_MEDIA_VERSION },
        thumb: null,
      },
    });
    const result = parseDirectPayload(raw);
    expect(result?.content).toContain('photo caption');
    expect(result?.attachments?.full?.filename).toBe('full.webp');
  });
});
