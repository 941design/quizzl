import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/src/lib/marmot/mediaPersistence', () => ({
  getBlob: vi.fn(),
  setBlob: vi.fn(),
  attachmentFingerprint: (a: { sha256: string; nonce: string; version: string }) =>
    `${a.sha256}:${a.nonce}:${a.version}`,
}));

vi.mock('@/src/lib/media/blossomClient', () => ({
  get: vi.fn(),
  BlossomNotFoundError: class BlossomNotFoundError extends Error {
    constructor(sha: string) { super(sha); this.name = 'BlossomNotFoundError'; }
  },
}));

vi.mock('@/src/context/MarmotContext', () => ({
  useMarmot: vi.fn(() => ({
    getGroup: vi.fn(),
  })),
}));

// Polyfill URL.createObjectURL / revokeObjectURL for Node
if (typeof URL.createObjectURL === 'undefined') {
  let counter = 0;
  (URL as any).createObjectURL = vi.fn(() => `blob:mock-url-${++counter}`);
  (URL as any).revokeObjectURL = vi.fn();
}

const { getBlob, setBlob } = await import('@/src/lib/marmot/mediaPersistence');
const { get: blossomGet, BlossomNotFoundError } = await import('@/src/lib/media/blossomClient');
const {
  fetchDecryptedMedia,
  __resetInFlightForTests,
  ObjectUrlSlot,
} = await import('@/src/hooks/useDecryptedImage');

import type { MediaAttachment } from '@internet-privacy/marmot-ts';

function makeAttachment(sha256 = 'a'.repeat(64)): MediaAttachment {
  return {
    url: `https://blossom.band/${sha256}`,
    sha256,
    type: 'image/webp',
    filename: 'photo.webp',
    nonce: 'b'.repeat(24),
    version: 'mip04-v2',
  };
}

function makeStoredMedia(bytes = new Uint8Array([1, 2, 3])) {
  return { bytes, type: 'image/webp' };
}

describe('fetchDecryptedMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightForTests();
  });

  it('returns cached bytes from mediaPersistence without calling blossomGet', async () => {
    const cached = makeStoredMedia(new Uint8Array([7, 7, 7]));
    vi.mocked(getBlob).mockResolvedValueOnce(cached);

    const result = await fetchDecryptedMedia('g1', makeAttachment(), vi.fn());

    expect(result).toEqual({ bytes: cached.bytes, type: cached.type });
    expect(vi.mocked(blossomGet)).not.toHaveBeenCalled();
  });

  it('on cache miss: downloads, decrypts, caches, and returns bytes (not a URL)', async () => {
    vi.mocked(getBlob).mockResolvedValueOnce(null);
    const encryptedBytes = new Uint8Array([9, 8, 7]);
    vi.mocked(blossomGet).mockResolvedValueOnce(encryptedBytes);
    vi.mocked(setBlob).mockResolvedValue(undefined as any);

    const decryptedBytes = new Uint8Array([4, 5, 6]);
    const decryptMedia = vi.fn().mockResolvedValue({ data: decryptedBytes });
    const getGroup = vi.fn().mockResolvedValue({ decryptMedia });

    const attachment = makeAttachment();
    const result = await fetchDecryptedMedia('g1', attachment, getGroup);

    expect(vi.mocked(blossomGet)).toHaveBeenCalledWith(attachment.url);
    expect(decryptMedia).toHaveBeenCalledWith(encryptedBytes, attachment);
    // Cache key includes nonce + version so a forged record with the same
    // sha256 but different metadata cannot replay the cached plaintext.
    const expectedKey = `${attachment.sha256}:${attachment.nonce}:${attachment.version}`;
    expect(vi.mocked(setBlob)).toHaveBeenCalledWith('g1', expectedKey, {
      bytes: decryptedBytes,
      type: 'image/webp',
    });

    // Critical: the dedup cache returns bytes, NOT object URLs. Each consumer
    // must create and own its own URL so cleanup is per-consumer, not shared.
    expect(result.bytes).toBe(decryptedBytes);
    expect(result.type).toBe('image/webp');
    expect(typeof result).toBe('object');
    expect((result as any).startsWith).toBeUndefined();
  });

  it('cache lookup uses fingerprint (sha256:nonce:version), not bare sha256', async () => {
    // Spoofing defense: a sender who knows a previously cached plaintext
    // sha256 must not be able to publish a new attachment record with a
    // different nonce and have the receiver render the old cached blob.
    // Prove this by checking that the cache lookup is keyed by the full
    // fingerprint, not by sha256 alone.
    vi.mocked(getBlob).mockResolvedValueOnce(null);
    vi.mocked(blossomGet).mockResolvedValueOnce(new Uint8Array([1]));
    vi.mocked(setBlob).mockResolvedValue(undefined as any);
    const decryptMedia = vi.fn().mockResolvedValue({ data: new Uint8Array([9]) });
    const getGroup = vi.fn().mockResolvedValue({ decryptMedia });

    const attachment = makeAttachment();
    await fetchDecryptedMedia('g1', attachment, getGroup);

    const expectedKey = `${attachment.sha256}:${attachment.nonce}:${attachment.version}`;
    expect(vi.mocked(getBlob)).toHaveBeenCalledWith('g1', expectedKey);
  });

  it('forged attachment with same sha256 but different nonce does NOT replay cached plaintext', async () => {
    // Concrete spoofing scenario: the cache holds bytes for the trusted
    // attachment. A forged attachment record reuses the same sha256 but
    // changes the nonce. The receiver must miss the cache and fall through
    // to fetch+decrypt rather than displaying the old plaintext.
    const sha = 'a'.repeat(64);
    const trustedNonce = 'b'.repeat(24);
    const forgedNonce = 'c'.repeat(24);
    const trustedBytes = new Uint8Array([7, 7, 7]);
    const decryptedForgedBytes = new Uint8Array([9, 9, 9]);

    vi.mocked(getBlob).mockImplementation(async (_g, key) => {
      if (typeof key === 'string' && key.includes(trustedNonce)) {
        return { bytes: trustedBytes, type: 'image/webp' };
      }
      return null;
    });
    vi.mocked(blossomGet).mockResolvedValueOnce(new Uint8Array([1]));
    vi.mocked(setBlob).mockResolvedValue(undefined as any);
    const decryptMedia = vi.fn().mockResolvedValue({ data: decryptedForgedBytes });
    const getGroup = vi.fn().mockResolvedValue({ decryptMedia });

    const trusted = { ...makeAttachment(sha), nonce: trustedNonce };
    const forged = { ...makeAttachment(sha), nonce: forgedNonce };

    const trustedResult = await fetchDecryptedMedia('g1', trusted, getGroup);
    expect(Array.from(trustedResult.bytes)).toEqual([7, 7, 7]);
    expect(vi.mocked(blossomGet)).not.toHaveBeenCalled();

    const forgedResult = await fetchDecryptedMedia('g1', forged, getGroup);
    expect(vi.mocked(blossomGet)).toHaveBeenCalledTimes(1);
    expect(decryptMedia).toHaveBeenCalledTimes(1);
    expect(Array.from(forgedResult.bytes)).toEqual([9, 9, 9]);
  });

  it('dedupes concurrent fetches for the same key into a single download', async () => {
    vi.mocked(getBlob).mockResolvedValue(null);
    let downloadCount = 0;
    vi.mocked(blossomGet).mockImplementation(async () => {
      downloadCount += 1;
      return new Uint8Array([1, 2, 3]);
    });
    vi.mocked(setBlob).mockResolvedValue(undefined as any);
    const decryptMedia = vi.fn().mockResolvedValue({ data: new Uint8Array([9]) });
    const getGroup = vi.fn().mockResolvedValue({ decryptMedia });

    const attachment = makeAttachment();
    const [a, b, c] = await Promise.all([
      fetchDecryptedMedia('g1', attachment, getGroup),
      fetchDecryptedMedia('g1', attachment, getGroup),
      fetchDecryptedMedia('g1', attachment, getGroup),
    ]);

    expect(downloadCount).toBe(1);
    expect(decryptMedia).toHaveBeenCalledTimes(1);
    expect(a.bytes).toBe(b.bytes);
    expect(b.bytes).toBe(c.bytes);
  });

  it('propagates BlossomNotFoundError so caller can map to not-found state', async () => {
    vi.mocked(getBlob).mockResolvedValueOnce(null);
    vi.mocked(blossomGet).mockRejectedValueOnce(new BlossomNotFoundError('sha'));
    const getGroup = vi.fn().mockResolvedValue({ decryptMedia: vi.fn() });

    await expect(
      fetchDecryptedMedia('g1', makeAttachment(), getGroup),
    ).rejects.toBeInstanceOf(BlossomNotFoundError);
  });

  it('propagates decrypt errors so caller can map to decrypt-failed state', async () => {
    vi.mocked(getBlob).mockResolvedValueOnce(null);
    vi.mocked(blossomGet).mockResolvedValueOnce(new Uint8Array([1]));
    const decryptMedia = vi.fn().mockRejectedValue(new Error('decrypt failed'));
    const getGroup = vi.fn().mockResolvedValue({ decryptMedia });

    await expect(
      fetchDecryptedMedia('g1', makeAttachment(), getGroup),
    ).rejects.toThrow('decrypt failed');
  });

  it('throws when group is not found', async () => {
    vi.mocked(getBlob).mockResolvedValueOnce(null);
    vi.mocked(blossomGet).mockResolvedValueOnce(new Uint8Array([1]));
    const getGroup = vi.fn().mockResolvedValue(null);

    await expect(
      fetchDecryptedMedia('g1', makeAttachment(), getGroup),
    ).rejects.toThrow();
  });
});

describe('ObjectUrlSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if ((URL as any).createObjectURL?.mockClear) (URL as any).createObjectURL.mockClear();
    if ((URL as any).revokeObjectURL?.mockClear) (URL as any).revokeObjectURL.mockClear();
  });

  it('set() creates an object URL from the given blob and stores it', () => {
    const slot = new ObjectUrlSlot();
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'image/webp' });
    const url = slot.set(blob);
    expect(url).toMatch(/^blob:/);
    expect(slot.current).toBe(url);
  });

  it('set() revokes the previous URL before creating a new one', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const slot = new ObjectUrlSlot();
    const first = slot.set(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
    const second = slot.set(new Blob([new Uint8Array([2])], { type: 'image/webp' }));

    expect(revokeSpy).toHaveBeenCalledWith(first);
    expect(slot.current).toBe(second);
    revokeSpy.mockRestore();
  });

  it('revoke() releases the current URL and clears the slot', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const slot = new ObjectUrlSlot();
    const url = slot.set(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
    slot.revoke();

    expect(revokeSpy).toHaveBeenCalledWith(url);
    expect(slot.current).toBeNull();
    revokeSpy.mockRestore();
  });

  it('revoke() is safe to call when slot is empty', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const slot = new ObjectUrlSlot();
    expect(() => slot.revoke()).not.toThrow();
    expect(revokeSpy).not.toHaveBeenCalled();
    revokeSpy.mockRestore();
  });

  it('revoke() is idempotent', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const slot = new ObjectUrlSlot();
    slot.set(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
    slot.revoke();
    slot.revoke();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    revokeSpy.mockRestore();
  });
});
