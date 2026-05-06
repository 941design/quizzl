import React, { useCallback, useEffect, useRef, useState } from 'react';
import EmojiComposerPicker, { type EmojiComposerPickerHandle } from '@/src/components/chat/EmojiComposerPicker';
import EmojiReactionPicker from '@/src/components/chat/EmojiReactionPicker';
import ReactionBadgeRow from '@/src/components/chat/ReactionBadgeRow';
import { insertAtCursor } from '@/src/lib/reactions/composeInsert';
import {
  Box,
  Flex,
  Image,
  Link,
  Text,
  Textarea,
  IconButton,
  VStack,
  CloseButton,
} from '@chakra-ui/react';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { useChatStore } from '@/src/context/ChatStoreContext';
import { truncateNpub, pubkeyToNpub } from '@/src/lib/nostrKeys';
import { splitLinks } from '@/src/lib/linkify';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import type { StructuredContent } from '@/src/lib/marmot/parseStructured';
import { parseStructured, resolveCancellerDisplay } from '@/src/lib/marmot/parseStructured';
import type { MemberProfile } from '@/src/types';
import type { ChatMediaAttachment } from '@/src/lib/media/imageMessage';
import PollChatAnnouncement from '@/src/components/groups/PollChatAnnouncement';
import PollChatResults from '@/src/components/groups/PollChatResults';
import InviteCancelledChatAnnouncement from '@/src/components/groups/InviteCancelledChatAnnouncement';
import ImageAttachmentButton from '@/src/components/groups/ImageAttachmentButton';
import ImageMessageBubble from '@/src/components/groups/ImageMessageBubble';

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

type ChatBoxProps = {
  threadId: string;
  pubkey: string;
  messages: ChatMessage[];
  loading: boolean;
  profileMap: Record<string, MemberProfile>;
  sendMessage: (content: string) => Promise<void>;
  sendImageMessage: (file: File, caption: string) => Promise<void>;
  decryptMedia?: (attachment: ChatMediaAttachment) => Promise<{ bytes: Uint8Array; type: string }>;
  allowPollMessages?: boolean;
  /**
   * Story-08: reaction send callback. Supplied by GroupChat (sendReaction) and
   * by ContactChat (handleReact). Used by both EmojiReactionPicker and
   * ReactionBadgeRow. AC-55.
   */
  onReact?: (emoji: string, message: ChatMessage, op: 'add' | 'remove') => Promise<void>;
  /**
   * Story-08: optional pre-computed reactions map for DM surface.
   * ContactChat supplies this from useDirectReactions so that ChatBox
   * does not need to read from ChatStoreContext (which is group-only).
   * When absent, ChatBox falls back to useChatStore().reactionsByMessageId
   * (group surface). AC-55, arch §3 rule 3.
   */
  reactionsByMessageId?: Map<string, import('@/src/lib/reactions/api').ReactionAggregate[]>;
};

export default function ChatBox({
  threadId,
  pubkey,
  messages,
  loading,
  profileMap,
  sendMessage,
  sendImageMessage,
  decryptMedia,
  allowPollMessages = true,
  onReact,
  reactionsByMessageId: reactionsByMessageIdProp,
}: ChatBoxProps) {
  const copy = useCopy();
  const { language } = useLanguage();
  // Story-08: read aggregated reactions from ChatStoreContext (group surface).
  // For DM surface, ContactChat passes reactionsByMessageId as a prop to avoid
  // ChatStoreContext (which is group-only — arch §3 rule 3).
  const { reactionsByMessageId: storeReactionsByMessageId } = useChatStore();
  // Prefer the prop (DM surface) over the store (group surface).
  const reactionsByMessageId = reactionsByMessageIdProp ?? storeReactionsByMessageId;
  const [inputValue, setInputValue] = useState('');
  const [showBadge, setShowBadge] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageSendFailed, setImageSendFailed] = useState(false);
  const [imageTooLarge, setImageTooLarge] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMsgCountRef = useRef(messages.length);
  const initializedRef = useRef(false);
  const prevPreviewUrl = useRef<string | null>(null);
  // Handle for the emoji picker so the keyboard shortcut can toggle it.
  const emojiPickerRef = useRef<EmojiComposerPickerHandle>({ toggle: () => {} });

  // Story-08: track which message's reaction picker is open (if any).
  // We keep a single open picker per ChatBox (only one message bubble can have
  // the picker open at a time). This is independent of useDisclosure inside
  // EmojiReactionPicker because the picker manages its own open/close state;
  // this ref is only used for touch long-press to programmatically open it.
  // Touch long-press: per-message timer ref.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevPreviewUrl.current && prevPreviewUrl.current !== previewUrl) {
      URL.revokeObjectURL(prevPreviewUrl.current);
    }
    prevPreviewUrl.current = previewUrl;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const attachFile = useCallback((file: File) => {
    setAttachedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setImageSendFailed(false);
    setImageTooLarge(false);
  }, []);

  const removeAttachment = useCallback(() => {
    setAttachedFile(null);
    setPreviewUrl(null);
    setImageSendFailed(false);
    setImageTooLarge(false);
  }, []);

  useEffect(() => {
    if (!loading) {
      initializedRef.current = true;
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [loading]);

  useEffect(() => {
    const newCount = messages.length;
    const hasNew = newCount > prevMsgCountRef.current;
    prevMsgCountRef.current = newCount;
    if (!hasNew || !initializedRef.current) return;
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
    if (attachedFile) {
      const caption = inputValue;
      setInputValue('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setImageSendFailed(false);
      setImageTooLarge(false);
      try {
        const { ImageTooLargeError } = await import('@/src/lib/media/imageProcessing');
        await sendImageMessage(attachedFile, caption);
        removeAttachment();
      } catch (err) {
        const { ImageTooLargeError } = await import('@/src/lib/media/imageProcessing');
        if (err instanceof ImageTooLargeError) {
          setImageTooLarge(true);
        } else {
          setImageSendFailed(true);
        }
      }
      return;
    }
    if (!inputValue.trim()) return;
    const content = inputValue;
    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      await sendMessage(content);
    } catch {
      setInputValue(content);
    }
  }, [attachedFile, inputValue, removeAttachment, sendImageMessage, sendMessage]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    const ta = textareaRef.current;
    // Read cursor position from the textarea DOM element (may be null if unfocused).
    const selStart = ta ? ta.selectionStart : null;
    const selEnd = ta ? ta.selectionEnd : null;
    const { value, nextCaret } = insertAtCursor(inputValue, selStart, selEnd, emoji);
    setInputValue(value);
    // Restore focus and set caret after React commits the new value.
    if (ta) {
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(nextCaret, nextCaret);
        // Keep auto-resize in sync.
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight}px`;
      });
    }
  }, [inputValue]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Shift+E — toggle the emoji picker.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      emojiPickerRef.current.toggle();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith('image/')) attachFile(file);
  }, [attachFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(
      (i) => i.kind === 'file' && i.type.startsWith('image/'),
    );
    if (item) {
      const file = item.getAsFile();
      if (file) attachFile(file);
    }
  }, [attachFile]);

  function getDisplayName(senderPubkey: string): string {
    const profile = profileMap[senderPubkey];
    if (profile?.nickname) return profile.nickname;
    return truncateNpub(pubkeyToNpub(senderPubkey));
  }

  function getAvatarInitial(senderPubkey: string): string {
    return truncateNpub(pubkeyToNpub(senderPubkey))[0]?.toUpperCase() ?? '?';
  }

  function renderStructuredMessage(
    structured: StructuredContent | null,
    msg: ChatMessage,
  ) {
    if (structured?.type === 'poll_open' && allowPollMessages) {
      const creatorDisplay = profileMap[structured.creatorPubkey]?.nickname
        ?? truncateNpub(pubkeyToNpub(structured.creatorPubkey));
      return <PollChatAnnouncement creatorName={creatorDisplay} title={structured.title} />;
    }
    if (structured?.type === 'poll_close' && allowPollMessages) {
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
    if (structured?.type === 'invite_cancelled' && allowPollMessages) {
      const memberDisplay = profileMap[structured.pubkey]?.nickname
        ?? truncateNpub(pubkeyToNpub(structured.pubkey));
      const cancellerDisplay = resolveCancellerDisplay(
        msg.senderPubkey,
        profileMap,
        (pk) => truncateNpub(pubkeyToNpub(pk)),
      );
      return (
        <InviteCancelledChatAnnouncement
          memberDisplay={memberDisplay}
          cancellerDisplay={cancellerDisplay}
        />
      );
    }
    if (structured?.type === 'image') {
      return (
        <ImageMessageBubble
          groupId={threadId}
          caption={structured.caption}
          attachments={msg.attachments ?? { full: null, thumb: null }}
          senderPubkey={msg.senderPubkey}
          createdAt={msg.createdAt}
          decryptMedia={decryptMedia}
        />
      );
    }
    return (
      <Box
        px={3}
        py={1.5}
        borderRadius="lg"
        bg={msg.senderPubkey === pubkey ? 'brand.500' : 'surfaceMutedBg'}
        color={msg.senderPubkey === pubkey ? 'white' : 'text'}
        fontSize="sm"
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
  }

  return (
    <Flex direction="column" h="400px" borderWidth="1px" borderColor="borderSubtle" borderRadius="md" overflow="hidden">
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
            <Text fontSize="sm" color="textMuted">{copy.groups.chatEmpty}</Text>
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
              const structured = parseStructured(msg.content);

              const aggregates = reactionsByMessageId.get(msg.id) ?? [];

              return (
                <Flex
                  key={msg.id}
                  data-testid={`msg-${msg.id}`}
                  gap={2}
                  mt={grouped ? '2px' : 3}
                  direction={isSelf ? 'row-reverse' : 'row'}
                  align="flex-start"
                  // role="group" enables _groupHover on the reaction trigger inside
                  role="group"
                >
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
                        <Image src={avatarImage} alt={displayName} boxSize="22px" objectFit="contain" />
                      ) : (
                        avatarInitial
                      )}
                    </Flex>
                  ) : (
                    <Box w="28px" flexShrink={0} />
                  )}

                  <Flex direction="column" maxW="75%" align={isSelf ? 'flex-end' : 'flex-start'}>
                    {!grouped && (
                      <Flex
                        gap={2}
                        mb="2px"
                        fontSize="xs"
                        color="textMuted"
                        direction={isSelf ? 'row-reverse' : 'row'}
                        align="baseline"
                      >
                        <Text fontWeight="medium" color="text">{displayName}</Text>
                        <Text title={new Date(msg.createdAt).toLocaleString()}>
                          {formatTimestamp(msg.createdAt, language, copy.groups.chatJustNow, copy.groups.chatMinutesAgo)}
                        </Text>
                      </Flex>
                    )}

                    {/* Bubble + reaction trigger side-by-side so the trigger sits at bubble corner */}
                    <Flex
                      direction={isSelf ? 'row-reverse' : 'row'}
                      align="flex-start"
                      gap={1}
                      // Touch long-press: detect touch/pen to open reaction picker (spec §1.2).
                      // 500ms threshold per story brief. No new dependency.
                      onPointerDown={(e: React.PointerEvent) => {
                        if (!onReact) return;
                        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                          longPressMessageIdRef.current = msg.id;
                          longPressTimerRef.current = setTimeout(() => {
                            // Trigger is revealed visually by focus; programmatic open
                            // is handled by the EmojiReactionPicker's own disclosure.
                            // We imperatively click the trigger button for simplicity.
                            const trigger = document.querySelector<HTMLElement>(
                              `[data-testid="reaction-trigger-${msg.id}"]`,
                            );
                            trigger?.click();
                          }, 500);
                        }
                      }}
                      onPointerUp={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                      }}
                      onPointerLeave={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                      }}
                    >
                      <Box
                        {...(structured?.type !== 'image' && grouped
                          ? {
                              borderTopRightRadius: isSelf ? 'sm' : undefined,
                              borderTopLeftRadius: !isSelf ? 'sm' : undefined,
                            }
                          : {})}
                      >
                        {renderStructuredMessage(structured, msg)}
                      </Box>

                      {/* Reaction trigger — revealed on hover via _groupHover (AC-47) */}
                      {onReact && (
                        <Box alignSelf="center" flexShrink={0}>
                          <EmojiReactionPicker
                            messageId={msg.id}
                            message={msg}
                            aggregates={aggregates}
                            onReact={onReact}
                          />
                        </Box>
                      )}
                    </Flex>

                    {/* Reaction badge row — real implementation (AC-49, story-08) */}
                    {aggregates.length > 0 && onReact && (
                      <ReactionBadgeRow
                        messageId={msg.id}
                        message={msg}
                        aggregates={aggregates}
                        onReact={onReact}
                        profileMap={profileMap}
                        selfPubkey={pubkey}
                      />
                    )}
                  </Flex>
                </Flex>
              );
            })}
          </VStack>
        )}

        {showBadge && (
          <Flex position="sticky" bottom={3} justify="center" mt={2}>
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

      <Box
        borderTopWidth="1px"
        borderColor="borderSubtle"
        bg="surfaceMutedBg"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {previewUrl && (
          <Flex px={2} pt={2} align="center" gap={2}>
            <Box position="relative" display="inline-block">
              <Image
                data-testid="image-preview-thumbnail"
                src={previewUrl}
                alt="preview"
                maxH="80px"
                maxW="120px"
                objectFit="cover"
                borderRadius="md"
              />
              <CloseButton
                data-testid="image-preview-remove"
                size="sm"
                position="absolute"
                top="-1"
                right="-1"
                bg="blackAlpha.600"
                color="white"
                borderRadius="full"
                aria-label={copy.groups.imageRemove}
                onClick={removeAttachment}
              />
            </Box>
          </Flex>
        )}

        {imageTooLarge && (
          <Text data-testid="image-too-large-error" px={2} pt={1} fontSize="xs" color="red.500">
            {copy.groups.imageTooLarge}
          </Text>
        )}
        {imageSendFailed && (
          <Flex px={2} pt={1} gap={2} align="center">
            <Text data-testid="image-send-failed" fontSize="xs" color="red.500">
              {copy.groups.imageSendFailed}
            </Text>
            <Box
              as="button"
              data-testid="image-retry-button"
              fontSize="xs"
              color="brand.500"
              onClick={() => void handleSend()}
              _hover={{ textDecoration: 'underline' }}
            >
              {copy.groups.imageRetry}
            </Box>
          </Flex>
        )}

        <Flex p={2} gap={2} align="flex-end">
          <ImageAttachmentButton onFileSelected={attachFile} />
          <EmojiComposerPicker onSelect={handleEmojiSelect} handleRef={emojiPickerRef} textareaRef={textareaRef} />
          <Textarea
            ref={textareaRef}
            data-testid="chat-input"
            placeholder={copy.groups.chatPlaceholder}
            value={inputValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
            isDisabled={!inputValue.trim() && !attachedFile}
            onClick={() => void handleSend()}
          />
        </Flex>
      </Box>
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
