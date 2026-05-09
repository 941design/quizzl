import NDK, { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip04, nip44 } from 'nostr-tools';
import { wrapEvent, createRumor } from 'nostr-tools/nip59';
import { getPublicKey, verifyEvent, getEventHash } from 'nostr-tools/pure';
import { createLogger } from '@/src/lib/logger';
import { put, get as blossomGet } from '@/src/lib/media/blossomClient';
import { MAX_OUTPUT_BYTES } from '@/src/config/blossom';
import { buildImageMessageContent, DIRECT_MEDIA_VERSION, type DirectMediaAttachment, type RoledAttachments } from '@/src/lib/media/imageMessage';

const logger = createLogger('dm');

/** Legacy kind-4 NIP-04 constant — kept for inbound subscription filter only (D9a). */
export const DIRECT_MESSAGE_KIND = 4;

/** NIP-17 / NIP-59 gift-wrap kind. */
export const GIFT_WRAP_KIND = 1059;

/** Inner NIP-17 chat message kind (rumor). */
export const CHAT_MESSAGE_KIND = 14;

/**
 * Unsigned rumor shape — matches nostr-tools nip59 Rumor (UnsignedEvent + id, no sig).
 * Seam S5 public type used by story-07-dm-reactions and beyond.
 */
export type UnsignedRumor = {
  kind: number;
  content: string;
  tags: string[][];
  pubkey: string;
  created_at: number;
  id: string;
};

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
  if (raw === '') return null;
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
    // D1 decision: unknown JSON shape — treat the raw JSON string as text.
    logger.info('dm:parse-lenient-fallback', { raw: raw.slice(0, 200) });
    return { content: raw };
  } catch {
    // Non-JSON plaintext — treat the raw string as plaintext.
    logger.info('dm:parse-lenient-fallback', { raw: raw.slice(0, 200) });
    return { content: raw };
  }
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
  let decrypted: string;
  try {
    decrypted = nip04.decrypt(privateKeyHex, peerPubkeyHex, encrypted);
  } catch {
    logger.info('dm:decrypt-empty', { reason: 'nip04-failed' });
    return null;
  }
  if (decrypted === '') {
    logger.info('dm:decrypt-empty', { reason: 'decrypted-empty' });
    return null;
  }
  return parseDirectPayload(decrypted);
}

/**
 * Seal a rumor in a kind-13 seal and wrap it in a NIP-59 gift wrap (kind 1059).
 * Uses nostr-tools/nip59 wrapEvent which:
 *   - computes the rumor id via getEventHash
 *   - encrypts the rumor into a kind-13 seal (sender priv → recipient pub, nip44)
 *   - encrypts the seal into a kind-1059 wrap with a fresh ephemeral key per wrap
 *   - randomises the outer created_at within [now-2days, now] per NIP-59
 *   - places ["p", recipientPublicKey] on the outer wrap
 *
 * The returned event is fully signed and ready for relay publish.
 */
export async function sealAndWrap(
  rumor: UnsignedRumor,
  recipientPubkey: string,
  selfPrivKeyHex: string,
): Promise<import('nostr-tools').NostrEvent> {
  const privKeyBytes = hexToBytes(selfPrivKeyHex);
  // wrapEvent accepts a Partial<UnsignedEvent>; it overwrites pubkey from privKeyBytes
  // and recomputes id. We pass the full rumor so content/kind/tags/created_at are preserved.
  const wrap = wrapEvent(
    {
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags,
      created_at: rumor.created_at,
    },
    privKeyBytes,
    recipientPubkey,
  );
  return wrap as import('nostr-tools').NostrEvent;
}

/**
 * Thread-isolation guard for the gift-wrap inbound path.
 *
 * NIP-59 mandates an ephemeral outer key per gift wrap, so the kind-1059
 * subscription cannot filter by authors. Any kind-1059 event addressed to
 * selfPubkey is delivered. Post-unwrap validation of the inner rumor's pubkey
 * is therefore the only thread-isolation barrier.
 *
 * Returns true when the rumor belongs to the current conversation thread and
 * should be ingested. Returns false when it arrived from a different sender
 * (must be silently dropped).
 */
export function shouldIngestRumor(rumor: UnsignedRumor, peerPubkeyHex: string): boolean {
  if (rumor.pubkey === peerPubkeyHex) return true;
  logger.info('dm:rumor-rejected', { rumorId: rumor.id, expectedPubkey: peerPubkeyHex, actualPubkey: rumor.pubkey });
  return false;
}

/** NIP-59 seal kind — authenticated inner envelope. */
const SEAL_KIND = 13;

/**
 * Unwrap a NIP-59 kind-1059 gift wrap and return the inner unsigned rumor.
 *
 * Unlike the nostr-tools unwrapEvent helper, this implementation performs the
 * missing authentication steps that the library omits:
 *   1. Decrypts the outer gift wrap using the ephemeral wrap pubkey as ECDH counterparty.
 *   2. Verifies the seal's schnorr signature via verifyEvent before trusting its pubkey.
 *   3. Decrypts the seal using the authenticated seal.pubkey as ECDH counterparty.
 *   4. Asserts rumor.pubkey === seal.pubkey — binding the rumor's claimed sender to the
 *      authenticated seal sender (closes the Mallory forgery vector).
 *
 * Without step 4, an attacker could wrap a rumor with pubkey:alice using their own key
 * and the shouldIngestRumor guard would incorrectly accept it as an Alice message.
 *
 * Throws on mismatched recipient key, invalid seal signature, or sender mismatch.
 * Never leaks decrypted content in error messages.
 */
export async function unwrapAndOpen(
  giftWrap: import('nostr-tools').NostrEvent,
  selfPrivKeyHex: string,
): Promise<UnsignedRumor> {
  const privKeyBytes = hexToBytes(selfPrivKeyHex);
  try {
    if (giftWrap.kind !== GIFT_WRAP_KIND) {
      throw new Error('not a gift wrap');
    }
    // Step 1: Decrypt outer wrap. The wrap was encrypted with an ephemeral key;
    // giftWrap.pubkey is that ephemeral key — use it as the ECDH counterparty.
    const sealJson = nip44.v2.decrypt(
      giftWrap.content,
      nip44.v2.utils.getConversationKey(privKeyBytes, giftWrap.pubkey),
    );
    const seal = JSON.parse(sealJson) as import('nostr-tools').NostrEvent;
    // Step 2: Authenticate the seal — verify kind and schnorr signature.
    if (seal.kind !== SEAL_KIND) {
      throw new Error('not a seal');
    }
    if (!verifyEvent(seal)) {
      throw new Error('seal signature invalid');
    }
    // Step 3: Decrypt the seal. Use the authenticated seal.pubkey as ECDH counterparty.
    const rumorJson = nip44.v2.decrypt(
      seal.content,
      nip44.v2.utils.getConversationKey(privKeyBytes, seal.pubkey),
    );
    const rumor = JSON.parse(rumorJson) as UnsignedRumor;
    // Step 4: Bind — the rumor's claimed sender must match the authenticated seal sender.
    // This closes the forgery vector: Mallory cannot claim to be Alice by putting
    // Alice's pubkey in the rumor, because the seal is signed with Mallory's key.
    if (rumor.pubkey !== seal.pubkey) {
      throw new Error('rumor sender mismatch');
    }
    // Step 5: Validate the rumor id against the canonical NIP-01 hash.
    // rumor.id must be the canonical hash of (pubkey, created_at, kind, tags, content).
    // Without this, a peer could embed an arbitrary id and confuse the
    // id-keyed dedup in chatPersistence.appendMessage. Practical impact is
    // limited (the round-2 sender binding already restricts the attacker to
    // the actual peer), but defense-in-depth.
    const canonicalId = getEventHash(rumor);
    if (rumor.id !== canonicalId) {
      throw new Error('rumor id invalid');
    }
    return rumor;
  } catch {
    // Re-throw a generic error to avoid leaking plaintext fragments, seal pubkeys,
    // or mismatch details that could assist an attacker.
    logger.info('dm:unwrap-failed', { wrapId: giftWrap.id ?? 'unknown' });
    throw new Error('gift wrap decryption failed');
  }
}

/**
 * Build a kind-14 (NIP-17 chat message) rumor without a sig.
 * The returned rumor has a valid id computed via NIP-01 hash.
 * Used by callers who need the rumor id before publishing (optimistic UI).
 */
export function buildChatRumor(params: {
  privateKeyHex: string;
  peerPubkeyHex: string;
  content: string;
  attachments?: RoledAttachments;
}): UnsignedRumor {
  const privKeyBytes = hexToBytes(params.privateKeyHex);
  const senderPubkey = getPublicKey(privKeyBytes);
  const payload = buildPayload(params.content, params.attachments);
  const rumor = createRumor(
    {
      kind: CHAT_MESSAGE_KIND,
      content: JSON.stringify(payload),
      tags: [['p', params.peerPubkeyHex]],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: senderPubkey,
    },
    privKeyBytes,
  );
  return rumor as UnsignedRumor;
}

/**
 * Publish a NIP-17 direct message as a kind-1059 NIP-59 gift wrap.
 *
 * Replaces the old NIP-04 kind-4 outbound path (D9b). Callers keep the same
 * function signature; only the wire format changes. Returns the inner rumor id
 * (the id that will appear in appendMessage / dedup), not the outer wrap id.
 *
 * The old signDirectMessage NIP-04 outbound function has been removed. The
 * NIP-04 inbound helpers (decryptDirectPayload, decryptDirectMedia) are kept
 * for the D9a legacy-inbound path.
 */
export async function publishDirectMessage(params: {
  ndk: NDK;
  privateKeyHex: string;
  peerPubkeyHex: string;
  content: string;
  attachments?: RoledAttachments;
}): Promise<string> {
  const rumor = buildChatRumor(params);
  const wrap = await sealAndWrap(rumor, params.peerPubkeyHex, params.privateKeyHex);
  const ndkEvent = new NDKEvent(params.ndk, wrap as any);
  await ndkEvent.publish();
  return rumor.id;
}

/**
 * Publish a kind-7 NIP-25 reaction rumor for a DM conversation via NIP-59 gift wrap.
 *
 * Seam S3 DM producer (story-07, AC-41).
 *
 * Builds a kind-7 rumor via buildReactionRumor (with ["p", peerPubkeyHex] per D10),
 * seals it with sealAndWrap (kind-1059, AC-60), and publishes via NDK.
 * Returns the inner rumor id — the id used by callers for optimistic row reconciliation
 * (no temp UUID needed for DMs because the rumor id is known pre-publish, AC-43).
 *
 * Does NOT call applyOptimistic — that is the caller's responsibility (ContactChat).
 */
export async function publishDirectReaction(params: {
  ndk: NDK;
  privateKeyHex: string;
  peerPubkeyHex: string;
  emoji: string;
  targetMessage: import('@/src/lib/marmot/chatPersistence').ChatMessage;
}): Promise<{ rumorId: string }> {
  const { buildReactionRumor } = await import('@/src/lib/reactions/rumor');
  const rumor = buildReactionRumor({
    emoji: params.emoji,
    targetMessageId: params.targetMessage.id,
    targetMessageKind: CHAT_MESSAGE_KIND, // kind-14 DM chat messages
    targetAuthorPubkey: params.peerPubkeyHex, // p tag required for DMs per D10
    selfPrivKeyHex: params.privateKeyHex,
  });
  const wrap = await sealAndWrap(rumor, params.peerPubkeyHex, params.privateKeyHex);
  const ndkEvent = new NDKEvent(params.ndk, wrap as any);
  await ndkEvent.publish();
  return { rumorId: rumor.id };
}

/**
 * Remove a kind-7 NIP-25 reaction via a removal rumor (content: "-") in a DM conversation.
 *
 * Seam S3 DM producer (story-07, AC-42).
 *
 * Identical to publishDirectReaction but calls buildReactionRumor with isRemoval: true.
 * The resulting rumor has content "-" and an ["emoji", glyph] tag for unambiguous
 * multi-emoji removal (D2). Wrapped in kind-1059 gift wrap (AC-60).
 */
export async function removeDirectReaction(params: {
  ndk: NDK;
  privateKeyHex: string;
  peerPubkeyHex: string;
  emoji: string;
  targetMessage: import('@/src/lib/marmot/chatPersistence').ChatMessage;
}): Promise<{ rumorId: string }> {
  const { buildReactionRumor } = await import('@/src/lib/reactions/rumor');
  const rumor = buildReactionRumor({
    emoji: params.emoji,
    targetMessageId: params.targetMessage.id,
    targetMessageKind: CHAT_MESSAGE_KIND,
    targetAuthorPubkey: params.peerPubkeyHex,
    selfPrivKeyHex: params.privateKeyHex,
    isRemoval: true,
  });
  const wrap = await sealAndWrap(rumor, params.peerPubkeyHex, params.privateKeyHex);
  const ndkEvent = new NDKEvent(params.ndk, wrap as any);
  await ndkEvent.publish();
  return { rumorId: rumor.id };
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
