import { encode as encodeBlurhash } from 'blurhash';
import {
  MAX_EDGE,
  THUMB_MAX_EDGE,
  MAX_INPUT_BYTES,
  OUTPUT_MIME,
  FULL_QUALITY,
  THUMB_QUALITY,
  BLURHASH_COMPONENTS,
} from '@/src/config/blossom';

export class ImageTooLargeError extends Error {
  constructor() {
    super('Image exceeds maximum allowed input size');
    this.name = 'ImageTooLargeError';
  }
}

export type ProcessedImage = {
  full: { blob: Blob; dimensions: string; sha256: string };
  thumb: { blob: Blob; dimensions: string; sha256: string };
  blurhash: string;
};

function yield_(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function scaleDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (width <= maxEdge && height <= maxEdge) return { width, height };
  const ratio = Math.min(maxEdge / width, maxEdge / height);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

async function encodeToBlob(
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  quality: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  return canvas.convertToBlob({ type: OUTPUT_MIME, quality });
}

async function fallbackEncodeToBlob(
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      OUTPUT_MIME,
      quality,
    );
  });
}

async function renderToBlob(
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    return encodeToBlob(bitmap, targetWidth, targetHeight, quality);
  }
  return fallbackEncodeToBlob(bitmap, targetWidth, targetHeight, quality);
}

function getPixelDataOffscreen(
  bitmap: ImageBitmap,
  sampleWidth: number,
  sampleHeight: number,
): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(sampleWidth, sampleHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
  return ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
}

function fallbackGetPixelData(
  bitmap: ImageBitmap,
  sampleWidth: number,
  sampleHeight: number,
): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
  return ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
}

function getPixelData(
  bitmap: ImageBitmap,
  sampleWidth: number,
  sampleHeight: number,
): Uint8ClampedArray {
  if (typeof OffscreenCanvas !== 'undefined') {
    return getPixelDataOffscreen(bitmap, sampleWidth, sampleHeight);
  }
  return fallbackGetPixelData(bitmap, sampleWidth, sampleHeight);
}

export async function processImage(input: Blob): Promise<ProcessedImage> {
  if (input.size > MAX_INPUT_BYTES) {
    throw new ImageTooLargeError();
  }

  await yield_();

  const bitmap = await createImageBitmap(input);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;

  await yield_();

  // Full resolution
  const fullDims = scaleDimensions(originalWidth, originalHeight, MAX_EDGE);
  const fullBlob = await renderToBlob(bitmap, fullDims.width, fullDims.height, FULL_QUALITY);

  await yield_();

  // Thumbnail
  const thumbDims = scaleDimensions(originalWidth, originalHeight, THUMB_MAX_EDGE);
  const thumbBlob = await renderToBlob(bitmap, thumbDims.width, thumbDims.height, THUMB_QUALITY);

  await yield_();

  // Blurhash from a small 32x32 sample
  const sampleW = Math.min(32, originalWidth);
  const sampleH = Math.min(32, originalHeight);
  const pixels = getPixelData(bitmap, sampleW, sampleH);
  const bh = encodeBlurhash(pixels, sampleW, sampleH, BLURHASH_COMPONENTS[0], BLURHASH_COMPONENTS[1]);

  bitmap.close();

  await yield_();

  // SHA-256 of plaintext blobs
  const [fullBytes, thumbBytes] = await Promise.all([
    fullBlob.arrayBuffer(),
    thumbBlob.arrayBuffer(),
  ]);
  const [fullSha, thumbSha] = await Promise.all([sha256Hex(fullBytes), sha256Hex(thumbBytes)]);

  return {
    full: {
      blob: fullBlob,
      dimensions: `${fullDims.width}x${fullDims.height}`,
      sha256: fullSha,
    },
    thumb: {
      blob: thumbBlob,
      dimensions: `${thumbDims.width}x${thumbDims.height}`,
      sha256: thumbSha,
    },
    blurhash: bh,
  };
}
