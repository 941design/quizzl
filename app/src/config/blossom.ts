export const BLOSSOM_BASE_URL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BLOSSOM_BASE_URL) ||
  'https://blossom.band';
export const MAX_EDGE = 2048;
export const THUMB_MAX_EDGE = 320;
export const MAX_INPUT_BYTES = 26214400; // 25 MB
export const MAX_OUTPUT_BYTES = 5242880; // 5 MB
export const OUTPUT_MIME = 'image/webp';
export const FULL_QUALITY = 0.85;
export const THUMB_QUALITY = 0.6;
export const BLURHASH_COMPONENTS: [number, number] = [4, 3];
