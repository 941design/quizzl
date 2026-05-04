import React from 'react';
import { useChatStore } from '@/src/context/ChatStoreContext';
import ChatBox from '@/src/components/chat/ChatBox';
import type { MemberProfile } from '@/src/types';

type GroupChatProps = {
  threadId?: string;
  pubkey: string;
  profileMap: Record<string, MemberProfile>;
};

export default function GroupChat({ threadId, pubkey, profileMap }: GroupChatProps) {
  const { messages, sendMessage, sendImageMessage, loading } = useChatStore();

  return (
    <ChatBox
      threadId={threadId ?? ''}
      pubkey={pubkey}
      profileMap={profileMap}
      messages={messages}
      loading={loading}
      sendMessage={sendMessage}
      sendImageMessage={sendImageMessage}
      allowPollMessages
    />
  );
}
