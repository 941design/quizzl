import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { EventSigner } from 'applesauce-core';
import type { MemberProfile } from '@/src/types';
import ChatBox from '@/src/components/chat/ChatBox';
import { appendMessage, loadMessages, type ChatMessage } from '@/src/lib/marmot/chatPersistence';
import { connectNdk, fetchEventsWithTimeout } from '@/src/lib/ndkClient';
import {
  decryptDirectMedia,
  decryptDirectPayload,
  directConversationId,
  DIRECT_MESSAGE_KIND,
  publishDirectMessage,
  sendDirectImageMessage,
} from '@/src/lib/directMessages';
import type { ChatMediaAttachment } from '@/src/lib/media/imageMessage';

type ContactChatProps = {
  peerPubkeyHex: string;
  pubkeyHex: string;
  privateKeyHex: string;
  signer: EventSigner;
  profileMap: Record<string, MemberProfile>;
};

function toMessage(
  threadId: string,
  event: { id: string; pubkey: string; created_at?: number | null; createdAt?: number | null; content: string; attachments?: ChatMessage['attachments'] },
): ChatMessage {
  const createdAtSeconds = event.created_at ?? event.createdAt ?? Math.floor(Date.now() / 1000);
  return {
    id: event.id,
    content: event.content,
    senderPubkey: event.pubkey,
    groupId: threadId,
    createdAt: createdAtSeconds * 1000,
    ...(event.attachments ? { attachments: event.attachments } : {}),
  };
}

export default function ContactChat({
  peerPubkeyHex,
  pubkeyHex,
  privateKeyHex,
  signer,
  profileMap,
}: ContactChatProps) {
  const threadId = useMemo(() => directConversationId(peerPubkeyHex), [peerPubkeyHex]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const upsertMessages = useCallback((next: ChatMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((msg) => [msg.id, msg] as const));
      for (const msg of next) byId.set(msg.id, msg);
      return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
    });
  }, []);

  const ingestEvent = useCallback(async (
    event: { id: string; pubkey: string; content: string; created_at?: number },
  ): Promise<ChatMessage | null> => {
    const peerForDecrypt = event.pubkey.toLowerCase() === pubkeyHex.toLowerCase()
      ? peerPubkeyHex
      : event.pubkey;
    const decrypted = await decryptDirectPayload(event.content, privateKeyHex, peerForDecrypt);
    if (!decrypted) return null;
    const msg = toMessage(threadId, {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      content: decrypted.content,
      attachments: decrypted.attachments,
    });
    await appendMessage(threadId, msg);
    return msg;
  }, [peerPubkeyHex, privateKeyHex, pubkeyHex, threadId]);

  useEffect(() => {
    let cancelled = false;
    let incomingSub: any = null;
    let outgoingSub: any = null;

    async function init() {
      setLoading(true);
      try {
        const stored = await loadMessages(threadId);
        if (!cancelled) {
          setMessages(stored);
        }

        const ndk = await connectNdk(privateKeyHex);
        const [incoming, outgoing] = await Promise.all([
          fetchEventsWithTimeout(ndk, { kinds: [DIRECT_MESSAGE_KIND], '#p': [pubkeyHex], authors: [peerPubkeyHex], limit: 200 }),
          fetchEventsWithTimeout(ndk, { kinds: [DIRECT_MESSAGE_KIND], '#p': [peerPubkeyHex], authors: [pubkeyHex], limit: 200 }),
        ]);

        const remoteMessages = (
          await Promise.all(
            [...incoming.events, ...outgoing.events].map((evt) => ingestEvent({
              id: evt.id,
              pubkey: evt.pubkey,
              content: evt.content,
              created_at: evt.created_at,
            }).catch(() => null)),
          )
        ).filter((msg): msg is ChatMessage => !!msg);

        if (!cancelled) upsertMessages(remoteMessages);

        incomingSub = ndk.subscribe({ kinds: [DIRECT_MESSAGE_KIND], '#p': [pubkeyHex], authors: [peerPubkeyHex] });
        outgoingSub = ndk.subscribe({ kinds: [DIRECT_MESSAGE_KIND], '#p': [peerPubkeyHex], authors: [pubkeyHex] });

        const handleEvent = (evt: { id: string; pubkey: string; content: string; created_at?: number }) => {
          void ingestEvent(evt).then((msg) => {
            if (!msg || cancelled) return;
            upsertMessages([msg]);
          }).catch(() => {});
        };

        if (incomingSub) incomingSub.on?.('event', handleEvent);
        if (outgoingSub) outgoingSub.on?.('event', handleEvent);
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
      incomingSub?.stop?.();
      outgoingSub?.stop?.();
    };
  }, [ingestEvent, peerPubkeyHex, privateKeyHex, pubkeyHex, threadId, upsertMessages]);

  const sendMessage = useCallback(async (content: string) => {
    const now = Math.floor(Date.now() / 1000);
    const tempId = crypto.randomUUID();
    const optimistic = toMessage(threadId, {
      id: tempId,
      pubkey: pubkeyHex,
      created_at: now,
      content,
    });
    upsertMessages([optimistic]);

    try {
      const ndk = await connectNdk(privateKeyHex);
      const eventId = await publishDirectMessage({
        ndk,
        privateKeyHex,
        peerPubkeyHex,
        content,
      });
      const finalMsg = { ...optimistic, id: eventId };
      setMessages((prev) => prev.map((msg) => (msg.id === tempId ? finalMsg : msg)));
      await appendMessage(threadId, finalMsg);
    } catch (err) {
      setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
      throw err;
    }
  }, [peerPubkeyHex, privateKeyHex, pubkeyHex, threadId, upsertMessages]);

  const sendImageMessage = useCallback(async (file: File, caption: string) => {
    const now = Math.floor(Date.now() / 1000);
    const tempId = crypto.randomUUID();
    const optimistic = toMessage(threadId, {
      id: tempId,
      pubkey: pubkeyHex,
      created_at: now,
      content: JSON.stringify({ type: 'image', version: 1, caption }),
      attachments: { full: null, thumb: null },
    });
    upsertMessages([optimistic]);

    try {
      const ndk = await connectNdk(privateKeyHex);
      const result = await sendDirectImageMessage({
        ndk,
        privateKeyHex,
        peerPubkeyHex,
        signer,
        caption,
        file,
        onProgress: () => {},
      });
      const finalMsg = {
        ...optimistic,
        id: result.eventId,
        attachments: result.attachments,
      };
      setMessages((prev) => prev.map((msg) => (msg.id === tempId ? finalMsg : msg)));
      await appendMessage(threadId, finalMsg);
    } catch (err) {
      setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
      throw err;
    }
  }, [peerPubkeyHex, privateKeyHex, pubkeyHex, signer, threadId, upsertMessages]);

  const decryptMedia = useCallback((attachment: ChatMediaAttachment) => {
    return decryptDirectMedia(attachment as any, privateKeyHex, peerPubkeyHex);
  }, [peerPubkeyHex, privateKeyHex]);

  return (
    <ChatBox
      threadId={threadId}
      pubkey={pubkeyHex}
      profileMap={profileMap}
      messages={messages}
      loading={loading}
      sendMessage={sendMessage}
      sendImageMessage={sendImageMessage}
      decryptMedia={decryptMedia}
      allowPollMessages={false}
    />
  );
}
