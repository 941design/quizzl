/**
 * ChatStoreContext — manages chat messages for the active group.
 *
 * Wraps a MarmotGroup's applicationMessage events, provides optimistic send,
 * and persists messages to IndexedDB via chatPersistence.
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

type MarmotGroupType = import('@internet-privacy/marmot-ts').MarmotGroup;

/**
 * Commit any pending MLS proposals so that sendChatMessage won't throw
 * "Cannot send application message with unapplied proposals".
 */
async function commitPendingProposals(group: MarmotGroupType): Promise<void> {
  if (Object.keys(group.unappliedProposals).length === 0) return;
  try {
    await group.commit();
  } catch {
    // Not an admin or commit failed — let the send surface the original error.
  }
}

interface ChatStoreContextValue {
  messages: ChatMessage[];
  sendMessage: (content: string) => Promise<void>;
  loading: boolean;
}

const ChatStoreContext = createContext<ChatStoreContextValue>({
  messages: [],
  sendMessage: async () => {},
  loading: false,
});

interface ChatStoreProviderProps {
  groupId: string | null;
  group: MarmotGroupType | null;
  pubkey: string;
  /** Bumped by MarmotContext when a chat message is persisted to IDB */
  chatVersion?: number;
  children: React.ReactNode;
}

export function ChatStoreProvider({
  groupId,
  group,
  pubkey,
  chatVersion,
  children,
}: ChatStoreProviderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const handlerRef = useRef<((data: Uint8Array) => void) | null>(null);
  const groupRef = useRef<MarmotGroupType | null>(null);

  useEffect(() => {
    // Detach previous listener
    if (groupRef.current && handlerRef.current) {
      groupRef.current.off('applicationMessage', handlerRef.current);
      handlerRef.current = null;
      groupRef.current = null;
    }

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

    const handler = async (data: Uint8Array) => {
      try {
        const { deserializeApplicationData } = await import('@internet-privacy/marmot-ts');
        const rumor = deserializeApplicationData(data);
        if (rumor.kind !== CHAT_MESSAGE_KIND) return;
        const msg: ChatMessage = {
          id: rumor.id,
          content: rumor.content,
          senderPubkey: rumor.pubkey,
          groupId,
          createdAt: rumor.created_at * 1000,
        };
        appendMessage(groupId, msg).catch((err) => {
          console.error('[chat-store] Failed to persist received message:', err);
        });
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg].sort((a, b) => a.createdAt - b.createdAt);
        });
      } catch {
        // malformed application message — ignore
      }
    };

    handlerRef.current = handler;
    groupRef.current = group;
    group.on('applicationMessage', handler);

    return () => {
      active = false;
      group.off('applicationMessage', handler);
      handlerRef.current = null;
      groupRef.current = null;
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
        await commitPendingProposals(group);
        await group.sendChatMessage(content);
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

  return (
    <ChatStoreContext.Provider value={{ messages, sendMessage, loading }}>
      {children}
    </ChatStoreContext.Provider>
  );
}

export function useChatStore(): ChatStoreContextValue {
  return useContext(ChatStoreContext);
}
