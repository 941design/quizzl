/**
 * ChatStoreContext — manages chat messages and reactions for the active group.
 *
 * Wraps a MarmotGroup's applicationMessage events, provides optimistic send,
 * and persists messages to IndexedDB via chatPersistence.
 *
 * Story-06 additions:
 * - sendReaction(emoji, targetMessage, isRemoval?): optimistic write + MLS send + rollback (D7)
 * - reactionsByMessageId: Map<string, ReactionAggregate[]> derived from subscribeReactions
 * - Kind-7 dispatch in applicationMessage handler (for own-send echo via marmot-ts event bus)
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import {
  CHAT_MESSAGE_KIND,
  appendMessage,
  loadMessages,
} from '@/src/lib/marmot/chatPersistence';
import type { ReactionAggregate } from '@/src/lib/reactions/api';
import {
  applyOptimistic,
  applyOptimisticRemoval,
  rollbackOptimistic,
  subscribeReactions,
  loadReactions,
  aggregateForMessage,
} from '@/src/lib/reactions/api';
import { buildReactionRumor } from '@/src/lib/reactions/rumor';
import type { Reaction } from '@/src/lib/reactions/types';

type MarmotGroupType = import('@internet-privacy/marmot-ts').MarmotGroup;

/**
 * WORKAROUND: ts-mls forbids application messages when unappliedProposals
 * is non-empty. This catches the error, commits pending proposals, and
 * retries. Requires the sender to be an admin (commit() has an admin check).
 *
 * Root cause: admin promotion during invite can silently fail, leaving
 * members unable to commit. The real fix is to guarantee admin promotion
 * succeeds (retry / block invite until confirmed).
 */
const MAX_RETRIES = 3;
async function sendChatSafe(group: MarmotGroupType, content: string): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await group.sendChatMessage(content);
      return;
    } catch (err) {
      const isUnapplied = err instanceof Error && err.message.includes('unapplied proposals');
      if (!isUnapplied || attempt === MAX_RETRIES) throw err;
      console.warn(`[sendChatSafe] unapplied proposals (attempt ${attempt + 1}/${MAX_RETRIES + 1}), committing…`);
      await group.commit();
    }
  }
}

/**
 * Retry wrapper for sendApplicationRumor — same unapplied-proposals
 * workaround as sendChatSafe but for arbitrary rumors (e.g. kind-7 reactions).
 */
async function sendRumorSafe(
  group: MarmotGroupType,
  rumor: Parameters<MarmotGroupType['sendApplicationRumor']>[0],
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await group.sendApplicationRumor(rumor);
      return;
    } catch (err) {
      const isUnapplied = err instanceof Error && err.message.includes('unapplied proposals');
      if (!isUnapplied || attempt === MAX_RETRIES) throw err;
      console.warn(`[sendRumorSafe] unapplied proposals (attempt ${attempt + 1}/${MAX_RETRIES + 1}), committing…`);
      await group.commit();
    }
  }
}

interface ChatStoreContextValue {
  messages: ChatMessage[];
  sendMessage: (content: string) => Promise<void>;
  sendImageMessage: (file: File, caption: string) => Promise<void>;
  /** Story-06: send a kind-7 group reaction (add or remove). AC-34. */
  sendReaction: (emoji: string, targetMessage: ChatMessage, isRemoval?: boolean) => Promise<void>;
  /** Story-06: aggregated reactions per message id. Consumed by ChatBox → story-08. AC-34. */
  reactionsByMessageId: Map<string, ReactionAggregate[]>;
  loading: boolean;
}

const NOOP_ASYNC_MSG = async () => {};

const ChatStoreContext = createContext<ChatStoreContextValue>({
  messages: [],
  sendMessage: NOOP_ASYNC_MSG,
  sendImageMessage: NOOP_ASYNC_MSG,
  sendReaction: NOOP_ASYNC_MSG,
  reactionsByMessageId: new Map(),
  loading: false,
});

interface ChatStoreProviderProps {
  groupId: string | null;
  group: MarmotGroupType | null;
  pubkey: string;
  /** Private key hex used to build kind-7 reaction rumors (story-06, S3). */
  privateKeyHex?: string | null;
  signer?: import('applesauce-core').EventSigner | null;
  /** Bumped by MarmotContext when a chat message is persisted to IDB */
  chatVersion?: number;
  /** Bumped by MarmotContext when a kind-7 reaction is persisted to IDB (story-06, AC-38) */
  reactionsVersion?: number;
  children: React.ReactNode;
}

export function ChatStoreProvider({
  groupId,
  group,
  pubkey,
  privateKeyHex,
  signer,
  chatVersion,
  reactionsVersion,
  children,
}: ChatStoreProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  // Story-06: aggregated reactions per message id. Updated by the subscribeReactions listener.
  const [reactionsByMessageId, setReactionsByMessageId] = useState<Map<string, ReactionAggregate[]>>(new Map());
  // Ref to the current messages so the reactions subscription can read them
  const messagesRef = useRef<ChatMessage[]>([]);

  // Keep messagesRef in sync for use in stable callbacks
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ─── Reactions subscription ───────────────────────────────────────────────
  // When the reactions store changes (via applyOptimistic, applyInboundRumor, rollback),
  // re-compute reactionsByMessageId from the current rows in IDB.
  // Also re-runs when reactionsVersion bumps (inbound from MarmotContext's kind-7 dispatch).
  useEffect(() => {
    if (!groupId) {
      setReactionsByMessageId(new Map());
      return;
    }
    const thread = { kind: 'group' as const, groupId };

    let cancelled = false;

    function recompute() {
      if (cancelled) return;
      loadReactions(thread).then((rows) => {
        if (cancelled) return;
        const msgs = messagesRef.current;
        const map = new Map<string, ReactionAggregate[]>();
        for (const msg of msgs) {
          const agg = aggregateForMessage(rows, msg.id, pubkey);
          if (agg.length > 0) {
            map.set(msg.id, agg);
          }
        }
        setReactionsByMessageId(map);
      }).catch(() => {});
    }

    // Initial load
    recompute();

    // Subscribe to changes driven by applyOptimistic / applyInboundRumor / rollback
    const unsub = subscribeReactions(thread, recompute);

    return () => {
      cancelled = true;
      unsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, pubkey, reactionsVersion]);

  // ─── Message load ─────────────────────────────────────────────────────────
  // Inbound message ingestion is now handled exclusively by the unified
  // applicationRumorDispatcher wired in MarmotContext (Story 02). This effect
  // only loads the initial message set from IDB; chatVersion bumps trigger
  // re-reads via the effect below.
  useEffect(() => {
    if (!groupId || !group) {
      setMessages([]);
      setLoading(false);
      return;
    }

    let active = true;
    setMessages([]);
    setLoading(true);

    loadMessages(groupId)
      .then((stored) => {
        if (!active) return;
        setMessages((prev) => {
          const prevIds = new Set(prev.map((m) => m.id));
          const newFromStore = stored.filter((m) => !prevIds.has(m.id));
          return [...newFromStore, ...prev].sort((a, b) => a.createdAt - b.createdAt);
        });
      })
      .catch(() => {
        if (active) setMessages([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [groupId, group]);

  // Re-read from IDB when MarmotContext persists a new chat message.
  // This handles messages that arrive via the Nostr subscription while
  // ChatStoreContext may or may not have received the MarmotGroup event.
  useEffect(() => {
    if (!groupId || chatVersion === undefined || chatVersion === 0) return;
    loadMessages(groupId).then((stored) => {
      setMessages((prev) => {
        const prevIds = new Set(prev.map((m) => m.id));
        const newFromStore = stored.filter((m) => !prevIds.has(m.id));
        if (newFromStore.length === 0) return prev;
        return [...prev, ...newFromStore].sort((a, b) => a.createdAt - b.createdAt);
      });
    }).catch(() => {});
  }, [groupId, chatVersion]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!groupId || !group || !content.trim()) return;

      const now = Math.floor(Date.now() / 1000);
      // Use a temporary ID for optimistic display; replaced after send
      const tempId = crypto.randomUUID();
      const optimistic: ChatMessage = {
        id: tempId,
        content,
        senderPubkey: pubkey,
        groupId,
        createdAt: now * 1000,
      };

      setMessages((prev) => [...prev, optimistic]);

      try {
        await sendChatSafe(group, content);
        appendMessage(groupId, optimistic).catch((err) => {
          console.error('[chat-store] Failed to persist sent message:', err);
        });
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        throw err;
      }
    },
    [groupId, group, pubkey],
  );

  const sendImageMessage = useCallback(
    async (file: File, caption: string) => {
      if (!groupId || !group || !signer) return;

      const tempId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const { buildImageMessageContent } = await import('@/src/lib/media/imageMessage');
      const optimistic: ChatMessage = {
        id: tempId,
        content: buildImageMessageContent(caption),
        senderPubkey: pubkey,
        groupId,
        createdAt: now * 1000,
        attachments: { full: null, thumb: null },
        localMediaRefs: [],
      };
      setMessages((prev) => [...prev, optimistic]);

      const { sendImageMessage: doSend } = await import('@/src/hooks/useImageSend');
      try {
        const { fullAttachment, thumbAttachment } = await doSend(file, caption, {
          groupId,
          group: group as any,
          pubkey,
          signer,
          onProgress: () => {},
        });

        const finalMsg: ChatMessage = {
          ...optimistic,
          attachments: { full: fullAttachment, thumb: thumbAttachment },
          localMediaRefs: [fullAttachment.sha256, thumbAttachment.sha256],
        };
        appendMessage(groupId, finalMsg).catch((err) => {
          console.error('[chat-store] Failed to persist image message:', err);
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? finalMsg : m)),
        );
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        throw err;
      }
    },
    [groupId, group, pubkey, signer],
  );

  /**
   * Send a kind-7 group reaction.
   *
   * Mirrors ContactChat.tsx handleReact — build rumor first so its id is
   * available before the optimistic write (guarantees optimistic row id ==
   * published event id, matching AC-43's rationale for the DM path).
   *
   * 1. Build kind-7 rumor via buildReactionRumor — no p tag for groups (spec §3.3, AC-36).
   * 2. Branch on isRemoval for the optimistic write (AC-35, AC-59):
   *    - remove path → applyOptimisticRemoval flips the existing add row in place.
   *    - add path → applyOptimistic inserts a new row keyed on rumor.id.
   * 3. Send via sendRumorSafe (group.sendApplicationRumor with retry) (AC-36).
   * 4. On failure: branch on isRemoval for the rollback (D7, AC-37, AC-59):
   *    - remove path → re-insert a fresh removed:false row (restores badge).
   *    - add path → rollbackOptimistic removes the in-flight insert by rumor.id.
   *
   * Inbound reactions from peers are handled by reactionHandler.ts via the unified
   * applicationRumorDispatcher wired in MarmotContext (Story 02). The dispatcher's
   * LRU deduplication ensures the optimistic row is not double-applied.
   */
  const sendReaction = useCallback(
    async (emoji: string, targetMessage: ChatMessage, isRemoval?: boolean) => {
      if (!groupId || !group || !privateKeyHex) return;

      const thread = { kind: 'group' as const, groupId };

      // AC-36: build rumor exactly once so the optimistic row id == published event id.
      // No p tag for groups (spec §3.3).
      const rumor = buildReactionRumor({
        emoji,
        targetMessageId: targetMessage.id,
        targetMessageKind: CHAT_MESSAGE_KIND, // kind 9 for group messages
        targetAuthorPubkey: undefined, // groups omit p tag
        selfPrivKeyHex: privateKeyHex,
        isRemoval,
      });

      // AC-35 / AC-59: optimistic state update.
      //   remove path → tombstone the existing non-removed row in-place.
      //     Cannot insert a fresh removed:true row (applyOptimistic is idempotent on
      //     row id; a new UUID would leave the original add row untouched, keeping
      //     the badge visible).
      //   add path → insert new row keyed on rumor.id (the published id).
      if (isRemoval) {
        await applyOptimisticRemoval(thread, targetMessage.id, pubkey, emoji);
      } else {
        const optimisticRow: Reaction = {
          id: rumor.id,
          messageId: targetMessage.id,
          reactorPubkey: pubkey,
          emoji,
          eventId: '',
          createdAt: Date.now(),
          removed: false,
        };
        await applyOptimistic(thread, optimisticRow);
      }

      try {
        // AC-36: send via MLS (kind-445 on wire — no plaintext kind-7 published, AC-61)
        await sendRumorSafe(group, rumor as any);
      } catch (err) {
        // D7, AC-37, AC-59: rollback optimistic state on failure.
        // remove path → re-insert a fresh non-removed row so the badge returns.
        //   The original row id is unknown here; aggregateForMessage groups by
        //   (messageId, emoji) and counts non-removed rows, so re-inserting under
        //   rumor.id is observationally correct. No echo is expected on failure.
        // add path → rollbackOptimistic removes the in-flight insert by rumor.id.
        if (isRemoval) {
          const restoreRow: Reaction = {
            id: rumor.id,
            messageId: targetMessage.id,
            reactorPubkey: pubkey,
            emoji,
            eventId: '',
            createdAt: Date.now(),
            removed: false,
          };
          await applyOptimistic(thread, restoreRow);
        } else {
          await rollbackOptimistic(thread, rumor.id);
        }

        // Surface the failure toast — caller (GroupChat / ChatBox) must render it.
        // We re-throw with a sentinel so callers can detect and show the toast.
        // The toast string is emoji.couldntReact (added in story-01).
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
          couldntReact: true,
        });
      }
    },
    [groupId, group, pubkey, privateKeyHex],
  );

  return (
    <ChatStoreContext.Provider value={{ messages, sendMessage, sendImageMessage, sendReaction, reactionsByMessageId, loading }}>
      {children}
    </ChatStoreContext.Provider>
  );
}

export function useChatStore(): ChatStoreContextValue {
  return useContext(ChatStoreContext);
}
