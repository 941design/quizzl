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
  children: React.ReactNode;
}

export function ChatStoreProvider({
  groupId,
  group,
  pubkey,
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
        const raw = JSON.parse(rumor.content);
        const msg: ChatMessage = {
          id: raw.id ?? rumor.id ?? `${rumor.pubkey}-${rumor.created_at}`,
          content: raw.content ?? rumor.content,
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

  const sendMessage = useCallback(
    async (content: string) => {
      if (!groupId || !group || !content.trim()) return;

      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const optimistic: ChatMessage = {
        id,
        content,
        senderPubkey: pubkey,
        groupId,
        createdAt: now * 1000,
      };

      setMessages((prev) => [...prev, optimistic]);

      try {
        const rumor = {
          kind: CHAT_MESSAGE_KIND,
          pubkey,
          created_at: now,
          tags: [],
          content: JSON.stringify({
            kind: CHAT_MESSAGE_KIND,
            id,
            content,
            pubkey,
            created_at: now,
          }),
          id,
        };
        await group.sendApplicationRumor(rumor as any);
        appendMessage(groupId, optimistic).catch((err) => {
          console.error('[chat-store] Failed to persist sent message:', err);
        });
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== id));
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
