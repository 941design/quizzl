import { useState, useEffect, useRef } from 'react';
import type { MediaAttachment } from '@internet-privacy/marmot-ts';
import { useMarmot } from '@/src/context/MarmotContext';
import { getBlob, setBlob, attachmentFingerprint } from '@/src/lib/marmot/mediaPersistence';
import { get as blossomGet, BlossomNotFoundError } from '@/src/lib/media/blossomClient';

type State =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'decrypt-failed' }
  | { status: 'not-found' };

type DecryptedMedia = { bytes: Uint8Array; type: string };

type GroupLike = { decryptMedia: (encrypted: Uint8Array, attachment: MediaAttachment) => Promise<{ data: Uint8Array }> };
type GetGroupFn = (groupId: string) => Promise<GroupLike | null | undefined>;

// Dedup the fetch+decrypt+cache work — NOT the resulting object URL.
// Sharing object URLs across consumers makes per-consumer revoke() unsafe;
// each hook instance must own its own URL.
const inFlightDecrypts = new Map<string, Promise<DecryptedMedia>>();

export function __resetInFlightForTests(): void {
  inFlightDecrypts.clear();
}

export async function fetchDecryptedMedia(
  groupId: string,
  attachment: MediaAttachment,
  getGroup: GetGroupFn,
): Promise<DecryptedMedia> {
  const fingerprint = attachmentFingerprint(attachment);
  const cached = await getBlob(groupId, fingerprint);
  if (cached) {
    return { bytes: cached.bytes, type: cached.type };
  }

  const key = `${groupId}:${fingerprint}`;
  if (!inFlightDecrypts.has(key)) {
    const promise = (async () => {
      const group = await getGroup(groupId);
      if (!group) throw new Error('group not found');

      const encrypted = await blossomGet(attachment.url!);
      const stored = await group.decryptMedia(encrypted, attachment);
      const mimeType = attachment.type ?? 'image/webp';

      await setBlob(groupId, fingerprint, { bytes: stored.data, type: mimeType });
      return { bytes: stored.data, type: mimeType };
    })();

    inFlightDecrypts.set(key, promise);
    // .finally() returns a new promise that re-rejects on the original
    // rejection — swallow it here so a failed fetch with no consumer attached
    // (e.g. cancelled callers) does not surface as an unhandled rejection.
    promise.finally(() => inFlightDecrypts.delete(key)).catch(() => {});
  }

  return inFlightDecrypts.get(key)!;
}

export class ObjectUrlSlot {
  private url: string | null = null;

  set(blob: Blob): string {
    this.revoke();
    this.url = URL.createObjectURL(blob);
    return this.url;
  }

  revoke(): void {
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }

  get current(): string | null {
    return this.url;
  }
}

export function useDecryptedImage(
  groupId: string,
  attachment: MediaAttachment | null | undefined,
): State {
  const [state, setState] = useState<State>({ status: 'loading' });
  const { getGroup } = useMarmot();
  const slotRef = useRef<ObjectUrlSlot | null>(null);
  if (slotRef.current === null) slotRef.current = new ObjectUrlSlot();

  useEffect(() => {
    const slot = slotRef.current!;
    let cancelled = false;

    if (!attachment) {
      slot.revoke();
      return;
    }

    setState({ status: 'loading' });

    fetchDecryptedMedia(groupId, attachment, getGroup as GetGroupFn)
      .then(({ bytes, type }) => {
        if (cancelled) return;
        const url = slot.set(new Blob([bytes as unknown as BlobPart], { type }));
        setState({ status: 'ready', url });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof BlossomNotFoundError) {
          setState({ status: 'not-found' });
        } else {
          setState({ status: 'decrypt-failed' });
        }
      });

    return () => {
      cancelled = true;
      slot.revoke();
    };
    // Re-run on every field that participates in the cache fingerprint so
    // a swap to an attachment with the same sha256 but a different nonce
    // (e.g. a forged record) does not silently keep showing the prior blob.
  }, [groupId, attachment?.sha256, attachment?.nonce, attachment?.version, getGroup]);

  return state;
}
