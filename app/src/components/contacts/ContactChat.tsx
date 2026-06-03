import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type { EventSigner } from 'applesauce-core';
import type { MemberProfile } from '@/src/types';
import ChatBox from '@/src/components/chat/ChatBox';
import { useMarmot } from '@/src/context/MarmotContext';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import { createLogger } from '@/src/lib/logger';
import { appendMessage, loadMessages, removeMessages, type ChatMessage } from '@/src/lib/marmot/chatPersistence';
import { connectNdk, fetchEventsWithTimeout } from '@/src/lib/ndkClient';
import {
  buildChatRumor,
  decryptDirectMedia,
  decryptDirectPayload,
  directConversationId,
  DIRECT_MESSAGE_KIND,
  GIFT_WRAP_KIND,
  parseDirectPayload,
  publishDirectReaction,
  removeDirectReaction,
  sealAndWrap,
  sendDirectImageMessage,
  shouldIngestRumor,
  unwrapAndOpen,
  CHAT_MESSAGE_KIND,
} from '@/src/lib/directMessages';
import type { ChatMediaAttachment } from '@/src/lib/media/imageMessage';
import { markDirectMessagesRead } from '@/src/lib/unreadStore';
import { applyOptimistic, applyOptimisticRemoval, rollbackOptimistic, applyInboundRumor } from '@/src/lib/reactions/api';
import type { Reaction } from '@/src/lib/reactions/types';
import { useDirectReactions } from '@/src/hooks/useDirectReactions';
import { useCopy } from '@/src/context/LanguageContext';
import { useToast } from '@chakra-ui/react';

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

const dmLogger = createLogger('dm');

export default function ContactChat({
  peerPubkeyHex,
  pubkeyHex,
  privateKeyHex,
  signer,
  profileMap,
}: ContactChatProps) {
  const copy = useCopy();
  const toast = useToast();
  const { groups, ready: marmotReady } = useMarmot();
  // Ref for groups so subscription handlers always see the latest whitelist
  // without the effect needing to re-subscribe on every membership change.
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  // Track MarmotContext readiness so the historical fetch can wait for the
  // group whitelist to be fully loaded before running the walled-garden gate.
  // Without this, a fast relay (< 100 ms) resolves the historical fetch before
  // MarmotContext.init() calls setGroups(), causing groupsRef.current === [] and
  // dropping all historical events from allowed senders.
  const marmotReadyRef = useRef(marmotReady);
  useEffect(() => { marmotReadyRef.current = marmotReady; }, [marmotReady]);
  const threadId = useMemo(() => directConversationId(peerPubkeyHex), [peerPubkeyHex]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  // Story-07: DM reactions read side (S2). Map<messageId, ReactionAggregate[]>.
  const dmThread = useMemo(() => ({ kind: 'dm' as const, peerPubkeyHex }), [peerPubkeyHex]);
  const reactionsByMessageId = useDirectReactions(peerPubkeyHex, pubkeyHex, messages);
  // Ref to messages for use inside stable callbacks (avoids stale closure)
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Bug-fix (round-2, DM gate): synchronously-updated Set of known message ids.
  // messagesRef.current is synced via useEffect (after render), so there is a window
  // between setMessages and the next render where messagesRef.current is stale. A
  // kind-7 gift wrap arriving in that window would be silently discarded by a gate
  // reading messagesRef.current. knownMessageIdsRef is mutated in the same event-loop
  // tick as every message append, so it is always at least as fresh as React state.
  const knownMessageIdsRef = useRef<Set<string>>(new Set());

  const upsertMessages = useCallback((next: ChatMessage[]) => {
    for (const msg of next) knownMessageIdsRef.current.add(msg.id);
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
    // Legacy NIP-04 kind-4 subscriptions (inbound forever — D9a)
    let incomingSub: any = null;
    let outgoingSub: any = null;
    // NIP-17/59 kind-1059 gift-wrap subscription (new inbound path)
    let giftWrapSub: any = null;

    async function init() {
      setLoading(true);
      try {
        const { messages: stored, refetchIds } = await loadMessages(threadId);
        if (!cancelled) {
          for (const msg of stored) knownMessageIdsRef.current.add(msg.id);
          setMessages(stored);
        }

        // Story-04 (§3.4): coordinate refetch for non-canonical message ids.
        // loadMessages returns the malformed ids; we attempt a relay refetch
        // async so it does not block the first render. On success, the malformed
        // row is removed (state + IDB) and the canonical replacement is upserted.
        // Malformed ids whose refetch yields no replacement are left in place so
        // the message stays visible (per spec §3.4).
        if (refetchIds.length > 0) {
          // Log at info level per §3.6 — the message is still visible (left in
          // place) so this is not an error.
          console.info('[dm:self-heal] non-canonical ids enqueued for refetch:', refetchIds);
          void (async () => {
            try {
              const ndk = await connectNdk(privateKeyHex);
              const results = await fetchEventsWithTimeout(ndk, {
                kinds: [DIRECT_MESSAGE_KIND, GIFT_WRAP_KIND],
                ids: refetchIds,
              });
              // Track malformed-id → canonical-message pairs so we can drop the
              // malformed row when the canonical id differs (always true for
              // gift-wrap refetches: outer wrap id ≠ inner rumor id).
              const replacements: Array<{ malformedId: string; canonical: ChatMessage }> = [];
              for (const evt of results.events) {
                const rawEvt = {
                  kind: evt.kind ?? DIRECT_MESSAGE_KIND,
                  content: evt.content,
                  tags: evt.tags as string[][],
                  pubkey: evt.pubkey,
                  created_at: evt.created_at ?? Math.floor(Date.now() / 1000),
                  id: evt.id,
                  sig: (evt as any).sig ?? '',
                };
                if (evt.kind === GIFT_WRAP_KIND) {
                  try {
                    const rumor = await unwrapAndOpen(rawEvt as any, privateKeyHex);
                    if (!shouldIngestRumor(rumor, peerPubkeyHex)) continue;
                    if (rumor.kind !== CHAT_MESSAGE_KIND) continue;
                    const parsed = parseDirectPayload(rumor.content);
                    if (!parsed) continue;
                    const canonical = toMessage(threadId, {
                      id: rumor.id,
                      pubkey: rumor.pubkey,
                      created_at: rumor.created_at,
                      content: parsed.content,
                      attachments: parsed.attachments,
                    });
                    replacements.push({ malformedId: evt.id, canonical });
                  } catch {
                    // Refetch failed for this wrap — leave the malformed row in place.
                    continue;
                  }
                } else {
                  const canonical = await ingestEvent({
                    id: evt.id,
                    pubkey: evt.pubkey,
                    content: evt.content,
                    created_at: evt.created_at,
                  });
                  if (canonical) replacements.push({ malformedId: evt.id, canonical });
                }
              }
              if (replacements.length > 0 && !cancelled) {
                // For ids that genuinely changed (gift-wrap path), drop the
                // malformed row from IDB and React state before upserting the
                // canonical replacement. The kind-4 path keeps the same id so
                // there's nothing to drop — upsertMessages replaces in place.
                const malformedIdsToDrop = replacements
                  .filter((r) => r.malformedId !== r.canonical.id)
                  .map((r) => r.malformedId);
                if (malformedIdsToDrop.length > 0) {
                  await removeMessages(threadId, malformedIdsToDrop);
                  const dropSet = new Set(malformedIdsToDrop);
                  setMessages((prev) => prev.filter((m) => !dropSet.has(m.id)));
                }
                upsertMessages(replacements.map((r) => r.canonical));
              }
            } catch {
              // Refetch failed — malformed rows remain in place (per spec §3.4).
            }
          })();
        }

        const ndk = await connectNdk(privateKeyHex);

        // Fetch historical kind-4 messages (legacy inbound path — D9a)
        // and kind-1059 gift wraps (new inbound path — G3 fix).
        // Both fire in parallel; step 5 waits for both to settle.
        const [incoming, outgoing, giftWrapHistorical] = await Promise.all([
          fetchEventsWithTimeout(ndk, { kinds: [DIRECT_MESSAGE_KIND], '#p': [pubkeyHex], authors: [peerPubkeyHex], limit: 200 }),
          fetchEventsWithTimeout(ndk, { kinds: [DIRECT_MESSAGE_KIND], '#p': [peerPubkeyHex], authors: [pubkeyHex], limit: 200 }),
          fetchEventsWithTimeout(ndk, { kinds: [GIFT_WRAP_KIND], '#p': [pubkeyHex], limit: 500 }),
        ]);

        // AC-SEC-6 race guard: wait for MarmotContext to finish loading groups
        // before running the walled-garden gate on ALL historical events (both kind-4
        // and kind-1059). On a fast relay (localhost strfry) the historical fetch
        // resolves in < 100 ms, well before MarmotContext.init() calls setGroups().
        // Without this wait, groupsRef.current is [] when we call isAllowedDmSender,
        // which drops every historical event from an allowed sender (false-positive
        // walled-garden drop).
        // We poll marmotReadyRef with a 5-second ceiling so the chat still renders
        // on slow networks / degraded state rather than hanging indefinitely.
        if (!marmotReadyRef.current) {
          await new Promise<void>((resolve) => {
            const POLL_INTERVAL_MS = 50;
            const MAX_WAIT_MS = 5_000;
            let elapsed = 0;
            const poll = setInterval(() => {
              elapsed += POLL_INTERVAL_MS;
              if (marmotReadyRef.current || elapsed >= MAX_WAIT_MS || cancelled) {
                clearInterval(poll);
                resolve();
              }
            }, POLL_INTERVAL_MS);
          });
        }

        // Process kind-4 results (existing path — D9a).
        // AC-SEC-6/AC-SEC-8: apply the walled-garden gate to peer-authored historical
        // kind-4 events (the fourth inbound path).  Self-authored outgoing events
        // bypass the gate — isAllowedDmSender returns false for own pubkey by design,
        // but the user's own messages must always be allowed.
        const handleHistoricalKind4Event = async (
          evt: { id: string; pubkey: string; content: string; created_at?: number },
        ): Promise<ChatMessage | null> => {
          const senderPeer = evt.pubkey.toLowerCase();
          const isSelf = senderPeer === pubkeyHex.toLowerCase();
          if (!isSelf && !isAllowedDmSender(senderPeer, groupsRef.current, pubkeyHex)) {
            dmLogger.info('dm:walled-garden-drop', { pubkey: senderPeer.slice(0, 8), kind: 4 });
            return null;
          }
          return ingestEvent(evt).catch(() => null);
        };

        const remoteMessages = (
          await Promise.all(
            [...incoming.events, ...outgoing.events].map((evt) => handleHistoricalKind4Event({
              id: evt.id,
              pubkey: evt.pubkey,
              content: evt.content,
              created_at: evt.created_at,
            })),
          )
        ).filter((msg): msg is ChatMessage => !!msg);

        // Process kind-1059 historical results through the gift-wrap handler.
        // Each successfully unwrapped chat-message rumor is collected so it can be
        // merged into upsertMessages alongside the kind-4 results — without this,
        // historical NIP-17 DMs land in IDB but stay invisible until the user
        // closes and reopens the chat (the §3.5 merge requirement).
        //
        // Implementation note: kind-7 (reaction) rumors are processed here too so
        // that the reactions IDB is in the correct terminal state before the live
        // subscription opens. Without this, the live sub re-delivers all stored
        // events (reaction + removal) in arbitrary order, which can result in the
        // removal event arriving before the reaction and being silently discarded,
        // leaving the reaction in IDB as non-removed. Processing historically
        // (with sort by created_at) eliminates the ordering race.
        //
        // Approach: unwrap all events in parallel (expensive crypto), then sort
        // the successfully-unwrapped rumors by created_at and apply sequentially
        // so that reactions are always processed before their removals.
        const giftWrapMessages: ChatMessage[] = [];

        type UnwrappedRumor = Awaited<ReturnType<typeof unwrapAndOpen>>;
        const unwrapHistoricalEvent = async (evt: NDKEvent): Promise<{ rumor: UnwrappedRumor; evt: NDKEvent } | null> => {
          try {
            const rawEvt = {
              kind: evt.kind ?? GIFT_WRAP_KIND,
              content: evt.content,
              tags: evt.tags as string[][],
              pubkey: evt.pubkey,
              created_at: evt.created_at ?? Math.floor(Date.now() / 1000),
              id: evt.id,
              sig: (evt as any).sig ?? '',
            };
            const rumor = await unwrapAndOpen(rawEvt as any, privateKeyHex);
            return { rumor, evt };
          } catch {
            // Silently ignore gift wraps we can't decrypt (other-conversation traffic).
            return null;
          }
        };

        const unwrappedHistorical = (
          await Promise.all([...giftWrapHistorical.events].map(unwrapHistoricalEvent))
        )
          .filter((r): r is { rumor: UnwrappedRumor; evt: NDKEvent } => r !== null)
          .sort((a, b) => (a.rumor.created_at ?? 0) - (b.rumor.created_at ?? 0));

        for (const { rumor } of unwrappedHistorical) {
          if (!shouldIngestRumor(rumor, peerPubkeyHex)) continue;
          // AC-SEC-6: walled-garden gate — in addition to thread isolation.
          const senderPeer = rumor.pubkey.toLowerCase();
          if (!isAllowedDmSender(senderPeer, groupsRef.current, pubkeyHex)) {
            dmLogger.info('dm:walled-garden-drop', { pubkey: senderPeer.slice(0, 8), kind: rumor.kind });
            continue;
          }
          if (rumor.kind === 7) {
            // Kind-7 reaction/removal: apply in created_at order so that reactions
            // always land before their removals, giving applyInboundRumor the correct
            // row state to work with. The knownMessageIdsRef guard mirrors the live
            // subscription dispatcher: silently discard reactions for unknown messages.
            const targetETag = rumor.tags?.find((t: string[]) => t[0] === 'e');
            const targetMessageId = targetETag?.[1];
            if (targetMessageId && knownMessageIdsRef.current.has(targetMessageId)) {
              await applyInboundRumor({ kind: 'dm', peerPubkeyHex }, rumor);
            }
            continue;
          }
          if (rumor.kind === CHAT_MESSAGE_KIND) {
            const parsed = parseDirectPayload(rumor.content);
            if (!parsed) continue;
            const msg = toMessage(threadId, {
              id: rumor.id,
              pubkey: rumor.pubkey,
              created_at: rumor.created_at,
              content: parsed.content,
              attachments: parsed.attachments,
            });
            await appendMessage(threadId, msg);
            // Update knownMessageIdsRef immediately so that a kind-7 reaction
            // processed later in this same loop can find the message.
            knownMessageIdsRef.current.add(msg.id);
            giftWrapMessages.push(msg);
          }
        }

        // Step 5 (§3.5): merge both result sets, sort by createdAt, call upsertMessages once.
        // Sort is required so the rendered list is monotonic regardless of fetch order.
        if (!cancelled) {
          upsertMessages(
            [...remoteMessages, ...giftWrapMessages].sort((a, b) => a.createdAt - b.createdAt),
          );
        }

        // --- Legacy kind-4 live subscriptions (inbound only, forever per D9a) ---
        incomingSub = ndk.subscribe({ kinds: [DIRECT_MESSAGE_KIND], '#p': [pubkeyHex], authors: [peerPubkeyHex] });
        outgoingSub = ndk.subscribe({ kinds: [DIRECT_MESSAGE_KIND], '#p': [peerPubkeyHex], authors: [pubkeyHex] });

        const handleKind4Event = (evt: { id: string; pubkey: string; content: string; created_at?: number }) => {
          // AC-SEC-6: walled-garden gate before appendMessage (via ingestEvent).
          // Self-authored echoes (outgoingSub) bypass the gate — isAllowedDmSender
          // returns false for own pubkey by design, but own messages are legitimate.
          const senderPeer = evt.pubkey.toLowerCase();
          const isSelf = senderPeer === pubkeyHex.toLowerCase();
          if (!isSelf && !isAllowedDmSender(senderPeer, groupsRef.current, pubkeyHex)) {
            dmLogger.info('dm:walled-garden-drop', { pubkey: senderPeer.slice(0, 8), kind: 4 });
            return;
          }
          void ingestEvent(evt).then((msg) => {
            if (!msg || cancelled) return;
            upsertMessages([msg]);
          }).catch(() => {});
        };

        if (incomingSub) incomingSub.on?.('event', handleKind4Event);
        if (outgoingSub) outgoingSub.on?.('event', handleKind4Event);

        // --- NIP-17/59 kind-1059 gift-wrap subscription (new inbound path) ---
        // Filter: kind 1059 addressed to selfPubkey (pubkeyHex). No author filter —
        // the outer wrap uses an ephemeral key, so author filtering would miss all messages.
        giftWrapSub = ndk.subscribe({ kinds: [GIFT_WRAP_KIND], '#p': [pubkeyHex] });

        const handleGiftWrapEvent = (evt: NDKEvent) => {
          void (async () => {
            try {
              const rawEvt = {
                kind: evt.kind ?? GIFT_WRAP_KIND,
                content: evt.content,
                tags: evt.tags as string[][],
                pubkey: evt.pubkey,
                created_at: evt.created_at ?? Math.floor(Date.now() / 1000),
                id: evt.id,
                sig: (evt as any).sig ?? '',
              };
              const rumor = await unwrapAndOpen(rawEvt as any, privateKeyHex);

              // Thread isolation: gift wraps for selfPubkey arrive from any sender.
              // The legacy kind-4 path is filtered by authors: [peerPubkeyHex], but
              // kind-1059's outer key is ephemeral per NIP-59, so we must validate the
              // inner rumor pubkey here.
              if (!shouldIngestRumor(rumor, peerPubkeyHex)) return;

              // AC-SEC-6/7: walled-garden gate — runs after thread isolation, before
              // any write path (appendMessage, upsertMessages, applyInboundRumor).
              const rumorSender = rumor.pubkey.toLowerCase();
              if (!isAllowedDmSender(rumorSender, groupsRef.current, pubkeyHex)) {
                dmLogger.info('dm:walled-garden-drop', { pubkey: rumorSender.slice(0, 8), kind: rumor.kind });
                return;
              }

              // Story-07: kind-7 (reaction) inbound dispatch (AC-45, S4).
              if (rumor.kind === 7) {
                // Dispatcher gate: only call applyInboundRumor if the target message is
                // known to this thread (spec §2.4 silent discard for unknown messages).
                // Bug-fix (round-2): use knownMessageIdsRef instead of messagesRef.current.
                // messagesRef.current is synced via useEffect (runs after render), so it can
                // be stale for a kind-7 that arrives between a setMessages call and the next
                // render. knownMessageIdsRef is mutated synchronously alongside every message
                // append and is therefore never stale.
                const targetETag = rumor.tags?.find((t: string[]) => t[0] === 'e');
                const targetMessageId = targetETag?.[1];
                if (!targetMessageId) return; // malformed rumor
                if (!knownMessageIdsRef.current.has(targetMessageId)) return; // silent discard per spec §2.4
                await applyInboundRumor({ kind: 'dm', peerPubkeyHex }, rumor);
                // subscribeReactions listeners fire automatically after the idb write,
                // driving reactionsByMessageId recompute in useDirectReactions.
                return;
              }

              // Only process kind-14 (chat message) inner rumors below.
              if (rumor.kind !== CHAT_MESSAGE_KIND) return;

              // Parse the kind-14 payload (same JSON envelope as NIP-04 path)
              const parsed = parseDirectPayload(rumor.content);
              if (!parsed) return;

              const msg = toMessage(threadId, {
                id: rumor.id,
                pubkey: rumor.pubkey,
                created_at: rumor.created_at,
                content: parsed.content,
                attachments: parsed.attachments,
              });
              await appendMessage(threadId, msg);
              // Re-check cancelled after the async appendMessage to avoid stale state updates
              if (!cancelled) upsertMessages([msg]);
            } catch {
              // Silently ignore gift wraps we can't decrypt (e.g. from other conversations)
            }
          })();
        };

        if (giftWrapSub) giftWrapSub.on?.('event', handleGiftWrapEvent);
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
      giftWrapSub?.stop?.();
    };
  }, [ingestEvent, peerPubkeyHex, privateKeyHex, pubkeyHex, threadId, upsertMessages]);

  // Mark the thread read whenever it is open and new messages land — the user
  // is actively viewing this chat, so any incoming DM is "seen" by definition.
  useEffect(() => {
    markDirectMessagesRead(peerPubkeyHex);
  }, [peerPubkeyHex, messages.length]);

  const sendMessage = useCallback(async (content: string) => {
    // Build the NIP-17 kind-14 rumor first so we know its id before any network
    // round-trip. The rumor id is the stable message id used by appendMessage and
    // dedup — the outer kind-1059 wrap id is irrelevant to the UI layer.
    const rumor = buildChatRumor({ privateKeyHex, peerPubkeyHex, content });
    const optimistic = toMessage(threadId, {
      id: rumor.id,
      pubkey: pubkeyHex,
      created_at: rumor.created_at,
      content,
    });
    upsertMessages([optimistic]);

    try {
      const ndk = await connectNdk(privateKeyHex);
      const wrap = await sealAndWrap(rumor, peerPubkeyHex, privateKeyHex);
      const ndkEvent = new NDKEvent(ndk, wrap as any);
      await ndkEvent.publish();
      await appendMessage(threadId, optimistic);
    } catch (err) {
      setMessages((prev) => prev.filter((msg) => msg.id !== rumor.id));
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
      // See sendMessage above: NDK's optimistic dispatch can race the swap and
      // leave a duplicate echo entry under the real event id.
      // Also register the real event id synchronously so the kind-7 gate is up-to-date.
      knownMessageIdsRef.current.add(result.eventId);
      setMessages((prev) => {
        const filtered = prev.filter((msg) => msg.id !== tempId && msg.id !== result.eventId);
        return [...filtered, finalMsg].sort((a, b) => a.createdAt - b.createdAt);
      });
      await appendMessage(threadId, finalMsg);
    } catch (err) {
      setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
      throw err;
    }
  }, [peerPubkeyHex, privateKeyHex, pubkeyHex, signer, threadId, upsertMessages]);

  const decryptMedia = useCallback((attachment: ChatMediaAttachment) => {
    return decryptDirectMedia(attachment as any, privateKeyHex, peerPubkeyHex);
  }, [peerPubkeyHex, privateKeyHex]);

  /**
   * Story-07: DM reaction send handler (AC-43, AC-44, AC-54, AC-55).
   *
   * Builds the rumor ONCE (single call to buildReactionRumor), writes the optimistic
   * row with the real rumor id (AC-43 — no temp UUID), seals+wraps, publishes,
   * and rolls back on failure with a toast (D7).
   *
   * The single-build design avoids the created_at second-boundary race that would
   * arise if we built the rumor twice (once for the id, once for publish). By
   * reusing the same rumor object we guarantee the optimistic row id and the
   * published event id are always identical.
   */
  const handleReact = useCallback(async (emoji: string, message: ChatMessage, op: 'add' | 'remove') => {
    const ndk = await connectNdk(privateKeyHex);

    // Build the rumor exactly once so the optimistic row id == published event id (AC-43).
    const { buildReactionRumor } = await import('@/src/lib/reactions/rumor');
    const rumor = buildReactionRumor({
      emoji,
      targetMessageId: message.id,
      targetMessageKind: CHAT_MESSAGE_KIND,
      targetAuthorPubkey: peerPubkeyHex,
      selfPrivKeyHex: privateKeyHex,
      isRemoval: op === 'remove',
    });
    const rumorId = rumor.id;

    // AC-43 / AC-59: optimistic state update.
    //   add path → insert new row keyed on rumorId (the published id).
    //   remove path → tombstone the existing non-removed row in-place. We
    //   cannot insert a fresh row with `removed: true` keyed on the new
    //   rumorId, because applyOptimistic is idempotent on row id and would
    //   leave the original add row untouched, keeping the badge visible.
    if (op === 'remove') {
      await applyOptimisticRemoval(dmThread, message.id, pubkeyHex, emoji);
    } else {
      const optimisticRow: Reaction = {
        id: rumorId,
        messageId: message.id,
        reactorPubkey: pubkeyHex,
        emoji,
        eventId: '',
        createdAt: Date.now(),
        removed: false,
      };
      await applyOptimistic(dmThread, optimisticRow);
    }

    try {
      // Seal and publish the pre-built rumor directly (avoids rebuilding and any id mismatch).
      const wrap = await sealAndWrap(rumor, peerPubkeyHex, privateKeyHex);
      const ndkEvent = new NDKEvent(ndk, wrap as any);
      await ndkEvent.publish();
      // Success: the echo will reconcile via inbound dispatch (applyInboundRumor).
    } catch (err) {
      // AC-44, D7: rollback optimistic state and show toast.
      // For the add path, rollbackOptimistic deletes the in-flight insert by id.
      // For the remove path, we re-insert a fresh non-removed row so the badge
      // returns. The original row id is unknown here; aggregateForMessage groups
      // by (messageId, emoji) and counts non-removed rows, so re-inserting under
      // a new id is observationally correct. The inbound echo would later dedup
      // on (messageId, reactorPubkey, emoji) but this branch only fires on
      // publish failure, so no echo is expected.
      if (op === 'remove') {
        const restoreRow: Reaction = {
          id: rumorId,
          messageId: message.id,
          reactorPubkey: pubkeyHex,
          emoji,
          eventId: '',
          createdAt: Date.now(),
          removed: false,
        };
        await applyOptimistic(dmThread, restoreRow);
      } else {
        await rollbackOptimistic(dmThread, rumorId);
      }
      toast({
        title: copy.emoji.couldntReact,
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      throw err;
    }
  }, [copy.emoji.couldntReact, dmThread, peerPubkeyHex, privateKeyHex, pubkeyHex, toast]);

  // Story-07: __quizzlDmReactions dev bridge for E2E tests (AC-46, e2e-policy.md).
  // Guarded by NODE_ENV !== 'production' so it is tree-shaken in production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const bridge = {
      send: (targetPeerPubkeyHex: string, messageId: string, emoji: string, isRemoval: boolean) => {
        if (targetPeerPubkeyHex !== peerPubkeyHex) return;
        const msg = messagesRef.current.find((m) => m.id === messageId);
        if (!msg) {
          console.warn('[__quizzlDmReactions] message not found:', messageId);
          return;
        }
        void handleReact(emoji, msg, isRemoval ? 'remove' : 'add');
      },
    };
    (window as any).__quizzlDmReactions = bridge;
    return () => {
      if ((window as any).__quizzlDmReactions === bridge) {
        delete (window as any).__quizzlDmReactions;
      }
    };
  }, [handleReact, peerPubkeyHex]);

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
      onReact={handleReact}
      // Story-08: pass DM reactions map so ChatBox doesn't read from ChatStoreContext
      // (which is group-only — arch §3 rule 3). AC-55.
      reactionsByMessageId={reactionsByMessageId}
    />
  );
}
