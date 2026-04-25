import { describe, it, expect, vi, beforeAll } from 'vitest';
import { MAX_EDGE, THUMB_MAX_EDGE, MAX_INPUT_BYTES } from '@/src/config/blossom';

// Polyfill Web Crypto for Node
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

// ---- Canvas / OffscreenCanvas stubs ----

function makeImageData(w: number, h: number): { data: Uint8ClampedArray } {
  return { data: new Uint8ClampedArray(w * h * 4).fill(128) };
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(_: string) {
    const self = this;
    return {
      drawImage() {},
      getImageData(x: number, y: number, w: number, h: number) {
        return makeImageData(w, h);
      },
    };
  }
  async convertToBlob({ type }: { type: string; quality?: number }): Promise<Blob> {
    // Return a minimal WebP-like blob (no EXIF FF E1 marker)
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    return new Blob([bytes], { type });
  }
}

vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

// createImageBitmap stub — returns an object with width/height and close()
vi.stubGlobal('createImageBitmap', async (_blob: Blob) => ({
  width: 800,
  height: 600,
  close() {},
}));

// Import AFTER stubs
const { processImage, ImageTooLargeError } = await import(
  '@/src/lib/media/imageProcessing'
);

// ---- Tests ----

function makeBlob(sizeBytes: number, type = 'image/jpeg'): Blob {
  return new Blob([new Uint8Array(sizeBytes).fill(1)], { type });
}

describe('processImage', () => {
  it('throws ImageTooLargeError when input exceeds MAX_INPUT_BYTES', async () => {
    const oversized = makeBlob(MAX_INPUT_BYTES + 1);
    await expect(processImage(oversized)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it('accepts input exactly at MAX_INPUT_BYTES limit', async () => {
    const atLimit = makeBlob(MAX_INPUT_BYTES);
    const result = await processImage(atLimit);
    expect(result).toBeDefined();
  });

  it('returns full blob with OUTPUT_MIME type', async () => {
    const blob = makeBlob(1024);
    const result = await processImage(blob);
    expect(result.full.blob.type).toBe('image/webp');
  });

  it('returns thumb blob with OUTPUT_MIME type', async () => {
    const blob = makeBlob(1024);
    const result = await processImage(blob);
    expect(result.thumb.blob.type).toBe('image/webp');
  });

  it('full dimensions are within MAX_EDGE', async () => {
    const blob = makeBlob(1024);
    const result = await processImage(blob);
    const [w, h] = result.full.dimensions.split('x').map(Number);
    expect(w).toBeLessThanOrEqual(MAX_EDGE);
    expect(h).toBeLessThanOrEqual(MAX_EDGE);
  });

  it('thumb dimensions are within THUMB_MAX_EDGE', async () => {
    const blob = makeBlob(1024);
    const result = await processImage(blob);
    const [w, h] = result.thumb.dimensions.split('x').map(Number);
    expect(w).toBeLessThanOrEqual(THUMB_MAX_EDGE);
    expect(h).toBeLessThanOrEqual(THUMB_MAX_EDGE);
  });

  it('sha256 fields are 64-char lowercase hex', async () => {
    const blob = makeBlob(1024);
    const result = await processImage(blob);
    expect(result.full.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.thumb.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sha256 matches actual digest of full blob bytes', async () => {
    const blob = makeBlob(1024);
    const result = await processImage(blob);
    const bytes = await result.full.blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(result.full.sha256).toBe(hex);
  });

  it('blurhash is a non-empty string of expected length (6-50 chars)', async () => {
    const blob = makeBlob(1024);
    const result = await processImage(blob);
    expect(result.blurhash.length).toBeGreaterThanOrEqual(6);
    expect(result.blurhash.length).toBeLessThanOrEqual(50);
  });

  it('WebP blob does not contain EXIF APP1 marker (FF E1) at offset 12', async () => {
    const blob = makeBlob(1024, 'image/jpeg');
    const result = await processImage(blob);
    const bytes = new Uint8Array(await result.full.blob.arrayBuffer());
    // FF E1 at offset 12 would indicate EXIF APP1
    if (bytes.length >= 14) {
      const hasExif = bytes[12] === 0xff && bytes[13] === 0xe1;
      expect(hasExif).toBe(false);
    }
  });

  it('dimensions string format is WIDTHxHEIGHT', async () => {
    const blob = makeBlob(1024);
    const result = await processImage(blob);
    expect(result.full.dimensions).toMatch(/^\d+x\d+$/);
    expect(result.thumb.dimensions).toMatch(/^\d+x\d+$/);
  });
});

describe('fallback path when OffscreenCanvas is unavailable', () => {
  it('uses document.createElement canvas for both encoding and blurhash sampling', async () => {
    // Remove OffscreenCanvas to force fallback
    vi.stubGlobal('OffscreenCanvas', undefined);

    // Stub minimal document with createElement returning a canvas-like object
    const fakeCtx = {
      drawImage() {},
      getImageData(_x: number, _y: number, w: number, h: number) {
        return makeImageData(w, h);
      },
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: (_: string) => fakeCtx,
      toBlob(cb: (b: Blob) => void, type: string) {
        const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
        cb(new Blob([bytes], { type }));
      },
    };
    vi.stubGlobal('document', {
      createElement: (_tag: string) => fakeCanvas,
    });

    const blob = makeBlob(1024);
    const result = await processImage(blob);

    expect(result.full.blob.type).toBe('image/webp');
    expect(result.thumb.blob.type).toBe('image/webp');
    expect(result.blurhash.length).toBeGreaterThanOrEqual(6);

    // Restore
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.unstubAllGlobals();
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('createImageBitmap', async (_b: Blob) => ({
      width: 800,
      height: 600,
      close() {},
    }));
  });
});

describe('scaleDimensions (via processImage with large bitmap)', () => {
  it('scales down a 4096x2048 image to fit within MAX_EDGE', async () => {
    vi.stubGlobal('createImageBitmap', async (_blob: Blob) => ({
      width: 4096,
      height: 2048,
      close() {},
    }));

    const blob = makeBlob(1024);
    const result = await processImage(blob);
    const [w, h] = result.full.dimensions.split('x').map(Number);
    expect(w).toBeLessThanOrEqual(MAX_EDGE);
    expect(h).toBeLessThanOrEqual(MAX_EDGE);

    // Restore default stub
    vi.stubGlobal('createImageBitmap', async (_blob: Blob) => ({
      width: 800,
      height: 600,
      close() {},
    }));
  });
});
