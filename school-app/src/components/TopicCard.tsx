import React from 'react';
import {
  Box,
  Heading,
  Text,
  HStack,
  Tag,
  Button,
  Flex,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import type { Topic } from '@/src/types';
import { useCopy } from '@/src/context/LanguageContext';

type TopicCardProps = {
  topic: Topic;
  isSelected: boolean;
  onToggle: (slug: string) => void;
};

export default function TopicCard({ topic, isSelected, onToggle }: TopicCardProps) {
  const copy = useCopy();

  return (
    <Box
      p={5}
      bg="surfaceBg"
      borderRadius="lg"
      shadow="sm"
      borderWidth="2px"
      borderColor={isSelected ? 'brand.400' : 'borderSubtle'}
      transition="border-color 0.2s, box-shadow 0.2s"
      _hover={{ shadow: 'md', borderColor: isSelected ? 'brand.500' : 'brand.200' }}
      data-testid={`topic-card-${topic.slug}`}
    >
      <Flex direction="column" h="100%" gap={3}>
        <Box flex="1">
          <Heading size="md" mb={1}>
            {topic.title}
          </Heading>
          <Text color="textMuted" fontSize="sm" mb={3}>
            {topic.description}
          </Text>
          {topic.tags && topic.tags.length > 0 && (
            <HStack flexWrap="wrap" gap={1}>
              {topic.tags.map((tag) => (
                <Tag key={tag} size="sm" variant="subtle">
                  {tag}
                </Tag>
              ))}
            </HStack>
          )}
        </Box>

        <HStack mt={2}>
          <Button
            size="sm"
            variant={isSelected ? 'outline' : 'solid'}
            onClick={() => onToggle(topic.slug)}
            aria-pressed={isSelected}
            data-testid={`toggle-topic-${topic.slug}`}
          >
            {isSelected ? copy.topics.remove : copy.topics.select}
          </Button>

          {isSelected && (
            <NextLink href={`/topic/${topic.slug}`} passHref legacyBehavior>
              <Button as="a" size="sm" variant="ghost">
                {copy.topics.studyNow} →
              </Button>
            </NextLink>
          )}
        </HStack>
      </Flex>
    </Box>
  );
}
