import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Flex,
  Image,
  Link,
  Text,
  Textarea,
  IconButton,
  VStack,
} from '@chakra-ui/react';
import { useChatStore } from '@/src/context/ChatStoreContext';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { truncateNpub, pubkeyToNpub } from '@/src/lib/nostrKeys';
import { splitLinks } from '@/src/lib/linkify';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import type { MemberProfile } from '@/src/types';
import PollChatAnnouncement from './PollChatAnnouncement';
import PollChatResults from './PollChatResults';

/** Messages from the same sender within this window are grouped (inclusive). */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

const SCROLL_NEAR_BOTTOM_PX = 100;

const AVATAR_COLORS = [
  'purple.500',
  'blue.500',
  'teal.500',
  'green.500',
  'orange.500',
  'pink.500',
  'red.500',
  'cyan.500',
];

function getAvatarColor(pubkey: string): string {
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = (hash * 31 + pubkey.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function formatTimestamp(ms: number, locale: string, justNow: string, minutesAgo: (m: number) => string): string {
  const now = Date.now();
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return justNow;
  if (diff < 3_600_000) return minutesAgo(Math.floor(diff / 60_000));
  const d = new Date(ms);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  const timeStr = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  if (isToday) return timeStr;
  const dayStr = d.toLocaleDateString(locale, { weekday: 'short' });
  const timeStr24 = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${dayStr} ${timeStr24}`;
}

function isGrouped(prev: ChatMessage, curr: ChatMessage): boolean {
  const delta = curr.createdAt - prev.createdAt;
  return prev.senderPubkey === curr.senderPubkey && delta >= 0 && delta <= GROUP_WINDOW_MS;
}

type StructuredContent =
  | { type: 'poll_open'; pollId: string; title: string; creatorPubkey: string }
  | { type: 'poll_close'; pollId: string; title: string; results: any[]; totalVoters: number }
  | null;

function parseStructured(content: string): StructuredContent {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type === 'poll_open' && parsed.pollId && parsed.title) return parsed;
    if (parsed?.type === 'poll_close' && parsed.pollId && parsed.title && Array.isArray(parsed.results)) return parsed;
  } catch {
    // Not JSON — plain text message
  }
  return null;
}

type GroupChatProps = {
  pubkey: string;
  profileMap: Record<string, MemberProfile>;
};

export default function GroupChat({ pubkey, profileMap }: GroupChatProps) {
  const { messages, sendMessage, loading } = useChatStore();
  const copy = useCopy();
  const { language } = useLanguage();
  const [inputValue, setInputValue] = useState('');
  const [showBadge, setShowBadge] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMsgCountRef = useRef(messages.length);
  const groupInitializedRef = useRef(false);

  // Mark initialized when IDB load completes
  useEffect(() => {
    if (!loading) {
      groupInitializedRef.current = true;
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [loading]);

  // Auto-scroll + badge
  useEffect(() => {
    const newCount = messages.length;
    const hasNew = newCount > prevMsgCountRef.current;
    prevMsgCountRef.current = newCount;

    if (!hasNew || !groupInitializedRef.current) return;

    const el = scrollRef.current;
    if (!el) return;

    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowBadge(false);
    } else {
      setShowBadge(true);
    }
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distFromBottom <= SCROLL_NEAR_BOTTOM_PX;
    if (isNearBottomRef.current) setShowBadge(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setShowBadge(false);
  }, []);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim()) return;
    const content = inputValue;
    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      await sendMessage(content);
    } catch {
      setInputValue(content);
    }
  }, [inputValue, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  function getDisplayName(senderPubkey: string): string {
    const profile = profileMap[senderPubkey];
    if (profile?.nickname) return profile.nickname;
    return truncateNpub(pubkeyToNpub(senderPubkey));
  }

  function getAvatarInitial(senderPubkey: string): string {
    return truncateNpub(pubkeyToNpub(senderPubkey))[0]?.toUpperCase() ?? '?';
  }

  return (
    <Flex direction="column" h="400px" borderWidth="1px" borderColor="borderSubtle" borderRadius="md" overflow="hidden">
      {/* Message list */}
      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        flex="1"
        overflowY="auto"
        px={4}
        py={3}
        data-testid="chat-scroll-container"
      >
        {loading && messages.length === 0 ? (
          <Flex align="center" justify="center" py={8}>
            <Text fontSize="sm" color="textMuted">{copy.groups.chatLoading}</Text>
          </Flex>
        ) : messages.length === 0 ? (
          <Flex align="center" justify="center" py={8} data-testid="chat-empty-state">
            <Text fontSize="sm" color="textMuted">
              {copy.groups.chatEmpty}
            </Text>
          </Flex>
        ) : (
          <VStack spacing={0} align="stretch">
            {messages.map((msg, i) => {
              const prev = messages[i - 1];
              const grouped = prev ? isGrouped(prev, msg) : false;
              const isSelf = msg.senderPubkey === pubkey;
              const displayName = getDisplayName(msg.senderPubkey);
              const avatarImage = profileMap[msg.senderPubkey]?.avatar?.imageUrl;
              const avatarInitial = getAvatarInitial(msg.senderPubkey);
              const avatarColor = getAvatarColor(msg.senderPubkey);

              return (
                <Flex
                  key={msg.id}
                  data-testid={`msg-${msg.id}`}
                  gap={2}
                  mt={grouped ? '2px' : 3}
                  direction={isSelf ? 'row-reverse' : 'row'}
                  align="flex-start"
                >
                  {/* Avatar */}
                  {!grouped ? (
                    <Flex
                      w="28px"
                      h="28px"
                      flexShrink={0}
                      align="center"
                      justify="center"
                      borderRadius="full"
                      bg={avatarImage ? 'white' : avatarColor}
                      color="white"
                      fontSize="xs"
                      fontWeight="semibold"
                      borderWidth={avatarImage ? '1px' : 0}
                      borderColor="borderSubtle"
                      overflow="hidden"
                    >
                      {avatarImage ? (
                        <Image
                          src={avatarImage}
                          alt={displayName}
                          boxSize="22px"
                          objectFit="contain"
                        />
                      ) : (
                        avatarInitial
                      )}
                    </Flex>
                  ) : (
                    <Box w="28px" flexShrink={0} />
                  )}

                  <Flex direction="column" maxW="75%" align={isSelf ? 'flex-end' : 'flex-start'}>
                    {/* Name + timestamp */}
                    {!grouped && (
                      <Flex
                        gap={2}
                        mb="2px"
                        fontSize="xs"
                        color="textMuted"
                        direction={isSelf ? 'row-reverse' : 'row'}
                        align="baseline"
                      >
                        <Text fontWeight="medium" color="text">
                          {displayName}
                        </Text>
                        <Text title={new Date(msg.createdAt).toLocaleString()}>
                          {formatTimestamp(msg.createdAt, language, copy.groups.chatJustNow, copy.groups.chatMinutesAgo)}
                        </Text>
                      </Flex>
                    )}

                    {/* Bubble */}
                    {(() => {
                      const structured = parseStructured(msg.content);
                      if (structured?.type === 'poll_open') {
                        const creatorDisplay = profileMap[structured.creatorPubkey]?.nickname
                          ?? truncateNpub(pubkeyToNpub(structured.creatorPubkey));
                        return <PollChatAnnouncement creatorName={creatorDisplay} title={structured.title} />;
                      }
                      if (structured?.type === 'poll_close') {
                        const creatorDisplay = profileMap[msg.senderPubkey]?.nickname
                          ?? truncateNpub(pubkeyToNpub(msg.senderPubkey));
                        return (
                          <PollChatResults
                            creatorName={creatorDisplay}
                            title={structured.title}
                            results={structured.results}
                            totalVoters={structured.totalVoters}
                          />
                        );
                      }
                      return (
                        <Box
                          px={3}
                          py={1.5}
                          borderRadius="lg"
                          bg={isSelf ? 'brand.500' : 'surfaceMutedBg'}
                          color={isSelf ? 'white' : 'text'}
                          fontSize="sm"
                          {...(grouped && {
                            borderTopRightRadius: isSelf ? 'sm' : undefined,
                            borderTopLeftRadius: !isSelf ? 'sm' : undefined,
                          })}
                        >
                          <Text whiteSpace="pre-wrap" wordBreak="break-word">
                            {splitLinks(msg.content).map((token, i) =>
                              token.type === 'link' ? (
                                <Link
                                  key={i}
                                  href={token.value}
                                  isExternal
                                  color="inherit"
                                  textDecoration="underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {token.value}
                                </Link>
                              ) : (
                                token.value
                              ),
                            )}
                          </Text>
                        </Box>
                      );
                    })()}
                  </Flex>
                </Flex>
              );
            })}
          </VStack>
        )}

        {/* New messages badge */}
        {showBadge && (
          <Flex
            position="sticky"
            bottom={3}
            justify="center"
            mt={2}
          >
            <Box
              as="button"
              onClick={scrollToBottom}
              data-testid="new-messages-badge"
              px={4}
              py={1}
              borderRadius="full"
              bg="brand.500"
              color="white"
              fontSize="xs"
              fontWeight="medium"
              boxShadow="lg"
              _hover={{ opacity: 0.9 }}
            >
              {copy.groups.chatNewMessages}
            </Box>
          </Flex>
        )}
      </Box>

      {/* Input bar */}
      <Flex
        borderTopWidth="1px"
        borderColor="borderSubtle"
        p={2}
        gap={2}
        align="flex-end"
        bg="surfaceMutedBg"
      >
        <Textarea
          ref={textareaRef}
          data-testid="chat-input"
          placeholder={copy.groups.chatPlaceholder}
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          minH="36px"
          maxH="128px"
          resize="none"
          overflowY="auto"
          fontSize="sm"
          bg="white"
          _dark={{ bg: 'gray.800' }}
          borderColor="borderSubtle"
        />
        <IconButton
          data-testid="chat-send-btn"
          aria-label="Send message"
          icon={<SendIcon />}
          size="sm"
          colorScheme="brand"
          isDisabled={!inputValue.trim()}
          onClick={handleSend}
        />
      </Flex>
    </Flex>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
