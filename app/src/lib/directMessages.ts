import NDK, { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip04, nip44 } from 'nostr-tools';
import { put, get as blossomGet } from '@/src/lib/media/blossomClient';
import { MAX_OUTPUT_BYTES } from '@/src/config/blossom';
import { buildImageMessageContent, DIRECT_MEDIA_VERSION, type DirectMediaAttachment, type RoledAttachments } from '@/src/lib/media/imageMessage';

export const DIRECT_MESSAGE_KIND = 4;

type TextPayload = {
  type: 'text';
  text: string;
};

type ImagePayload = {
  type: 'image';
  version: 1;
  caption: string;
  attachments: RoledAttachments;
};

export type DirectMessagePayload = TextPayload | ImagePayload;

export function directConversationId(peerPubkeyHex: string): string {
  return `dm:${peerPubkeyHex.toLowerCase()}`;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

function buildPayload(content: string, attachments?: RoledAttachments): DirectMessagePayload {
  if (attachments && (attachments.full || attachments.thumb)) {
    return {
      type: 'image',
      version: 1,
      caption: content,
      attachments,
    };
  }
  return {
    type: 'text',
    text: content,
  };
}

export function normalizeDirectPayload(payload: DirectMessagePayload): {
  content: string;
  attachments?: RoledAttachments;
} {
  if (payload.type === 'image') {
    return {
      content: buildImageMessageContent(payload.caption),
      attachments: payload.attachments,
    };
  }
  return { content: payload.text };
}

export function parseDirectPayload(raw: string): {
  content: string;
  attachments?: RoledAttachments;
} | null {
  try {
    const parsed = JSON.parse(raw) as DirectMessagePayload;
    if (parsed.type === 'text' && typeof parsed.text === 'string') {
      return { content: parsed.text };
    }
    if (
      parsed.type === 'image' &&
      parsed.version === 1 &&
      typeof parsed.caption === 'string' &&
      parsed.attachments &&
      typeof parsed.attachments === 'object'
    ) {
      return {
        content: buildImageMessageContent(parsed.caption),
        attachments: parsed.attachments,
      };
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

export async function encryptDirectPayload(
  payload: DirectMessagePayload,
  privateKeyHex: string,
  peerPubkeyHex: string,
): Promise<string> {
  return nip04.encrypt(privateKeyHex, peerPubkeyHex, JSON.stringify(payload));
}

export async function decryptDirectPayload(
  encrypted: string,
  privateKeyHex: string,
  peerPubkeyHex: string,
): Promise<{ content: string; attachments?: RoledAttachments } | null> {
  const decrypted = nip04.decrypt(privateKeyHex, peerPubkeyHex, encrypted);
  return parseDirectPayload(decrypted);
}

/**
 * Build & sign a kind-4 DM event without publishing. Returns the signed event
 * so the caller can read the final event id (and `created_at`) before the
 * relay round-trip — the caller can then add an optimistic UI entry under the
 * real id and avoid races with NDK's local echo dispatch (see ContactChat).
 */
export async function signDirectMessage(params: {
  ndk: NDK;
  privateKeyHex: string;
  peerPubkeyHex: string;
  content: string;
  attachments?: RoledAttachments;
}): Promise<NDKEvent> {
  const encrypted = await encryptDirectPayload(
    buildPayload(params.content, params.attachments),
    params.privateKeyHex,
    params.peerPubkeyHex,
  );

  const event = new NDKEvent(params.ndk, {
    kind: DIRECT_MESSAGE_KIND,
    content: encrypted,
    tags: [['p', params.peerPubkeyHex]],
    created_at: Math.floor(Date.now() / 1000),
  });
  await event.sign();
  return event;
}

export async function publishDirectMessage(params: {
  ndk: NDK;
  privateKeyHex: string;
  peerPubkeyHex: string;
  content: string;
  attachments?: RoledAttachments;
}): Promise<string> {
  const event = await signDirectMessage(params);
  await event.publish();
  return event.id;
}

function getDmConversationKey(privateKeyHex: string, peerPubkeyHex: string): Uint8Array {
  return nip44.v2.utils.getConversationKey(hexToBytes(privateKeyHex), peerPubkeyHex);
}

async function importAesKey(privateKeyHex: string, peerPubkeyHex: string): Promise<CryptoKey> {
  const keyBytes = getDmConversationKey(privateKeyHex, peerPubkeyHex);
  return crypto.subtle.importKey('raw', toArrayBuffer(new Uint8Array(keyBytes)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function randomNonceHex(): string {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  return bytesToHex(nonce);
}

export async function encryptDirectMedia(blob: Blob, metadata: {
  filename: string;
  type: string;
  size?: number;
  dimensions?: string;
  blurhash?: string;
}, privateKeyHex: string, peerPubkeyHex: string): Promise<{ encrypted: Uint8Array; attachment: DirectMediaAttachment }> {
  const key = await importAesKey(privateKeyHex, peerPubkeyHex);
  const nonce = randomNonceHex();
  const plaintext = new Uint8Array(await blob.arrayBuffer());
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(hexToBytes(nonce)) },
    key,
    toArrayBuffer(plaintext),
  );

  return {
    encrypted: new Uint8Array(ciphertext),
    attachment: {
      sha256: await sha256Hex(plaintext),
      type: metadata.type,
      filename: metadata.filename,
      nonce,
      version: DIRECT_MEDIA_VERSION,
      size: metadata.size,
      dimensions: metadata.dimensions,
      blurhash: metadata.blurhash,
    },
  };
}

export async function decryptDirectMedia(
  attachment: DirectMediaAttachment,
  privateKeyHex: string,
  peerPubkeyHex: string,
): Promise<{ bytes: Uint8Array; type: string }> {
  const key = await importAesKey(privateKeyHex, peerPubkeyHex);
  const encrypted = await blossomGet(attachment.url!);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(hexToBytes(attachment.nonce)) },
    key,
    toArrayBuffer(new Uint8Array(encrypted)),
  );
  const bytes = new Uint8Array(plaintext);
  const digest = await sha256Hex(bytes);
  if (digest !== attachment.sha256) {
    throw new Error('direct media integrity check failed');
  }
  return { bytes, type: attachment.type };
}

export async function sendDirectImageMessage(params: {
  ndk: NDK;
  privateKeyHex: string;
  peerPubkeyHex: string;
  signer: import('applesauce-core').EventSigner;
  caption: string;
  file: File;
  onProgress: (status: 'processing' | 'sent' | 'failed' | { status: 'uploading'; pct: number }) => void;
}): Promise<{ eventId: string; attachments: RoledAttachments }> {
  const { processImage, ImageTooLargeError } = await import('@/src/lib/media/imageProcessing');
  params.onProgress('processing');

  let processed;
  try {
    processed = await processImage(params.file);
  } catch (err) {
    if (err instanceof ImageTooLargeError) throw err;
    params.onProgress('failed');
    throw err;
  }

  if (processed.full.blob.size > MAX_OUTPUT_BYTES) {
    params.onProgress('failed');
    throw new ImageTooLargeError();
  }

  const baseName = params.file.name.replace(/\.[^.]+$/, '') || 'image';
  const fullFilename = `${baseName}.webp`;
  const thumbFilename = `${baseName}.thumb.webp`;

  const [fullEnc, thumbEnc] = await Promise.all([
    encryptDirectMedia(
      processed.full.blob,
      {
        filename: fullFilename,
        type: 'image/webp',
        dimensions: processed.full.dimensions,
        blurhash: processed.blurhash,
        size: processed.full.blob.size,
      },
      params.privateKeyHex,
      params.peerPubkeyHex,
    ),
    encryptDirectMedia(
      processed.thumb.blob,
      {
        filename: thumbFilename,
        type: 'image/webp',
        dimensions: processed.thumb.dimensions,
        size: processed.thumb.blob.size,
      },
      params.privateKeyHex,
      params.peerPubkeyHex,
    ),
  ]);

  let uploadedCount = 0;
  const handleProgress = (pct: number) => {
    params.onProgress({ status: 'uploading', pct: Math.round((uploadedCount * 100 + pct) / 2) });
  };

  params.onProgress({ status: 'uploading', pct: 0 });

  try {
    const fullUrl = await put(fullEnc.encrypted, params.signer, (pct) => handleProgress(pct));
    uploadedCount = 1;
    const thumbUrl = await put(thumbEnc.encrypted, params.signer, (pct) => handleProgress(pct));

    const attachments: RoledAttachments = {
      full: { ...fullEnc.attachment, url: fullUrl },
      thumb: { ...thumbEnc.attachment, url: thumbUrl },
    };

    const eventId = await publishDirectMessage({
      ndk: params.ndk,
      privateKeyHex: params.privateKeyHex,
      peerPubkeyHex: params.peerPubkeyHex,
      content: params.caption,
      attachments,
    });

    params.onProgress('sent');
    return { eventId, attachments };
  } catch (err) {
    params.onProgress('failed');
    throw err;
  }
}
