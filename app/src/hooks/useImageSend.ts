import type { MediaAttachment } from '@internet-privacy/marmot-ts';
import { MAX_OUTPUT_BYTES } from '@/src/config/blossom';
import { CHAT_MESSAGE_KIND } from '@/src/lib/marmot/chatPersistence';
import { buildImetaTag } from '@/src/lib/media/imetaTag';
import { buildImageMessageContent } from '@/src/lib/media/imageMessage';

export type SendProgress =
  | 'processing'
  | { status: 'uploading'; pct: number }
  | 'sent'
  | 'failed';

type MarmotGroupLike = {
  encryptMedia(blob: Blob, metadata: {
    filename: string;
    type?: string;
    dimensions?: string;
    blurhash?: string;
    size?: number;
  }): Promise<{ encrypted: Uint8Array; attachment: MediaAttachment }>;
  sendApplicationRumor(rumor: Record<string, unknown>): Promise<unknown>;
};

export type ImageSendDeps = {
  groupId: string;
  group: MarmotGroupLike;
  pubkey: string;
  signer: import('applesauce-core').EventSigner;
  onProgress: (p: SendProgress) => void;
};

async function buildHashedRumor(
  kind: number,
  content: string,
  pubkey: string,
  tags: string[][],
): Promise<Record<string, unknown>> {
  const { getEventHash } = await import('applesauce-core/helpers/event');
  const rumor = {
    id: '',
    kind,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags,
  };
  rumor.id = getEventHash(rumor);
  return rumor;
}

export async function sendImageMessage(
  file: File,
  caption: string,
  deps: ImageSendDeps,
): Promise<{ fullAttachment: MediaAttachment; thumbAttachment: MediaAttachment }> {
  const { groupId, group, pubkey, signer, onProgress } = deps;

  onProgress('processing');

  const { processImage, ImageTooLargeError } = await import('@/src/lib/media/imageProcessing');

  let processed;
  try {
    processed = await processImage(file);
  } catch (err) {
    if (err instanceof ImageTooLargeError) throw err;
    onProgress('failed');
    throw err;
  }

  if (processed.full.blob.size > MAX_OUTPUT_BYTES) {
    onProgress('failed');
    const { ImageTooLargeError: TLE } = await import('@/src/lib/media/imageProcessing');
    throw new TLE();
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
  const fullFilename = `${baseName}.webp`;
  const thumbFilename = `${baseName}.thumb.webp`;

  // Encrypt both blobs
  const [fullEnc, thumbEnc] = await Promise.all([
    group.encryptMedia(processed.full.blob, {
      filename: fullFilename,
      type: 'image/webp',
      dimensions: processed.full.dimensions,
      blurhash: processed.blurhash,
      size: processed.full.blob.size,
    }),
    group.encryptMedia(processed.thumb.blob, {
      filename: thumbFilename,
      type: 'image/webp',
      dimensions: processed.thumb.dimensions,
      size: processed.thumb.blob.size,
    }),
  ]);

  // Upload both ciphertexts to Blossom
  const { put } = await import('@/src/lib/media/blossomClient');

  let uploadedCount = 0;
  const handleProgress = (pct: number) => {
    const overall = Math.round((uploadedCount * 100 + pct) / 2);
    onProgress({ status: 'uploading', pct: overall });
  };

  onProgress({ status: 'uploading', pct: 0 });

  let fullUrl: string;
  let thumbUrl: string;
  try {
    fullUrl = await put(fullEnc.encrypted, signer, (pct) => handleProgress(pct));
    uploadedCount = 1;
    thumbUrl = await put(thumbEnc.encrypted, signer, (pct) => handleProgress(pct));
  } catch (err) {
    onProgress('failed');
    throw err;
  }

  const fullAttachment: MediaAttachment = { ...fullEnc.attachment, url: fullUrl };
  const thumbAttachment: MediaAttachment = { ...thumbEnc.attachment, url: thumbUrl };

  // Build and send rumor first. Persisting plaintext blobs/refs before
  // publishing risks orphaning entries in IndexedDB if the publish fails:
  // the optimistic UI clears, but the cached blobs and message refs (keyed
  // by a tempId that will never become a real message) stay forever.
  const content = buildImageMessageContent(caption);
  const tags = [buildImetaTag(fullAttachment, 'full'), buildImetaTag(thumbAttachment, 'thumb')];
  const rumor = await buildHashedRumor(CHAT_MESSAGE_KIND, content, pubkey, tags);

  try {
    await group.sendApplicationRumor(rumor);
  } catch (err) {
    onProgress('failed');
    throw err;
  }

  // Publish succeeded — the message has shipped to the group, so the send
  // is a success regardless of what happens next. Local persistence is a
  // sender-side cache for offline reload; failures here must NOT surface
  // as send failures, because retrying would publish a duplicate message.
  try {
    const { setBlob, addMessageRef, attachmentFingerprint } = await import(
      '@/src/lib/marmot/mediaPersistence'
    );
    const fullBytes = new Uint8Array(await processed.full.blob.arrayBuffer());
    const thumbBytes = new Uint8Array(await processed.thumb.blob.arrayBuffer());

    // Use the same attachment-fingerprint key the receiver uses, so the
    // sender's optimistic cache and the post-fetch receiver cache share
    // entries instead of double-storing the same plaintext.
    const fullKey = attachmentFingerprint(fullAttachment);
    const thumbKey = attachmentFingerprint(thumbAttachment);

    const tempId = crypto.randomUUID();
    await Promise.all([
      setBlob(groupId, fullKey, { bytes: fullBytes, type: 'image/webp' }),
      setBlob(groupId, thumbKey, { bytes: thumbBytes, type: 'image/webp' }),
      addMessageRef(groupId, fullKey, tempId),
      addMessageRef(groupId, thumbKey, tempId),
    ]);
  } catch (err) {
    console.warn('[useImageSend] post-publish persistence failed; image will be re-fetched from Blossom on reload', err);
  }

  onProgress('sent');
  return { fullAttachment, thumbAttachment };
}
