import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Flex,
  Heading,
  Radio,
  RadioGroup,
  Text,
  VStack,
} from '@chakra-ui/react';
import type { Poll, PollVote } from '@/src/lib/marmot/pollPersistence';
import { usePollStore } from '@/src/context/PollStoreContext';
import { useCopy } from '@/src/context/LanguageContext';

type PollCardProps = {
  poll: Poll;
  votes: PollVote[];
  pubkey: string;
  profileMap: Record<string, { nickname: string }>;
};

export default function PollCard({ poll, votes, pubkey, profileMap }: PollCardProps) {
  const { castVote, closePoll } = usePollStore();
  const copy = useCopy();
  const [isVoting, setIsVoting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const myVote = votes.find((v) => v.voterPubkey === pubkey);
  const [selected, setSelected] = useState<string[]>(myVote?.responses ?? []);
  const hasVoted = !!myVote;
  const isCreator = poll.creatorPubkey === pubkey;
  const participantCount = votes.length;

  const creatorName = profileMap[poll.creatorPubkey]?.nickname ?? poll.creatorPubkey.slice(0, 8);

  async function handleVote() {
    if (selected.length === 0) return;
    setIsVoting(true);
    try {
      await castVote(poll.id, selected);
    } catch (err) {
      console.error('[PollCard] castVote failed:', err);
    } finally {
      setIsVoting(false);
    }
  }

  async function handleClose() {
    setIsClosing(true);
    try {
      await closePoll(poll.id);
    } catch (err) {
      console.error('[PollCard] closePoll failed:', err);
    } finally {
      setIsClosing(false);
      setConfirmClose(false);
    }
  }

  function handleSelectionChange(value: string | string[]) {
    if (poll.pollType === 'singlechoice') {
      setSelected([value as string]);
    } else {
      setSelected(value as string[]);
    }
  }

  const truncate = (text: string, max: number) =>
    text.length > max ? text.slice(0, max) + '...' : text;

  return (
    <Box
      borderWidth="1px"
      borderColor="borderSubtle"
      borderRadius="md"
      p={3}
      data-testid={`poll-card-${poll.id}`}
    >
      <Heading as="h4" size="xs" mb={1} noOfLines={2}>
        {truncate(poll.title, 200)}
      </Heading>
      {poll.description && (
        <Text fontSize="xs" color="textMuted" mb={2} noOfLines={2}>
          {truncate(poll.description, 200)}
        </Text>
      )}
      <Text fontSize="xs" color="textMuted" mb={2}>
        by {creatorName} &middot; {poll.pollType === 'singlechoice' ? copy.polls.singleChoice : copy.polls.multipleChoice}
      </Text>

      {/* Vote controls */}
      {poll.pollType === 'singlechoice' ? (
        <RadioGroup value={selected[0] ?? ''} onChange={(val) => handleSelectionChange(val)}>
          <VStack spacing={1} align="stretch">
            {poll.options.map((opt) => (
              <Radio key={opt.id} value={opt.id} size="sm" data-testid={`poll-option-${poll.id}-${opt.id}`}>
                <Text fontSize="sm" title={opt.label}>{truncate(opt.label, 100)}</Text>
              </Radio>
            ))}
          </VStack>
        </RadioGroup>
      ) : (
        <CheckboxGroup value={selected} onChange={(vals) => handleSelectionChange(vals as string[])}>
          <VStack spacing={1} align="stretch">
            {poll.options.map((opt) => (
              <Checkbox key={opt.id} value={opt.id} size="sm" data-testid={`poll-option-${poll.id}-${opt.id}`}>
                <Text fontSize="sm" title={opt.label}>{truncate(opt.label, 100)}</Text>
              </Checkbox>
            ))}
          </VStack>
        </CheckboxGroup>
      )}

      <Flex mt={3} gap={2} align="center" justify="space-between" flexWrap="wrap">
        <Flex gap={2} align="center">
          <Button
            size="xs"
            colorScheme="brand"
            onClick={() => void handleVote()}
            isLoading={isVoting}
            isDisabled={selected.length === 0}
            data-testid={`poll-vote-btn-${poll.id}`}
          >
            {hasVoted ? copy.polls.updateVote : copy.polls.vote}
          </Button>
          {hasVoted && (
            <Text fontSize="xs" color="green.500">
              {copy.polls.voted}
            </Text>
          )}
        </Flex>

        <Text fontSize="xs" color="textMuted">
          {copy.polls.voteCount(participantCount)}
        </Text>
      </Flex>

      {/* Close button (creator only) */}
      {isCreator && !confirmClose && (
        <Button
          size="xs"
          variant="ghost"
          colorScheme="red"
          mt={2}
          onClick={() => setConfirmClose(true)}
          data-testid={`poll-close-btn-${poll.id}`}
        >
          {copy.polls.closePoll}
        </Button>
      )}
      {isCreator && confirmClose && (
        <Flex mt={2} gap={2} align="center">
          <Text fontSize="xs" color="textMuted">{copy.polls.closeConfirm}</Text>
          <Button size="xs" colorScheme="red" onClick={() => void handleClose()} isLoading={isClosing}>
            {copy.polls.confirm}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirmClose(false)}>
            {copy.polls.cancel}
          </Button>
        </Flex>
      )}
    </Box>
  );
}
