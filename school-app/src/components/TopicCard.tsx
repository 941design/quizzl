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
      bg="white"
      borderRadius="lg"
      shadow="sm"
      borderWidth="2px"
      borderColor={isSelected ? 'teal.400' : 'gray.200'}
      transition="border-color 0.2s, box-shadow 0.2s"
      _hover={{ shadow: 'md', borderColor: isSelected ? 'teal.500' : 'teal.200' }}
      data-testid={`topic-card-${topic.slug}`}
    >
      <Flex direction="column" h="100%" gap={3}>
        <Box flex="1">
          <Heading size="md" mb={1}>
            {topic.title}
          </Heading>
          <Text color="gray.600" fontSize="sm" mb={3}>
            {topic.description}
          </Text>
          {topic.tags && topic.tags.length > 0 && (
            <HStack flexWrap="wrap" gap={1}>
              {topic.tags.map((tag) => (
                <Tag key={tag} size="sm" colorScheme="teal" variant="subtle">
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
            colorScheme="teal"
            onClick={() => onToggle(topic.slug)}
            aria-pressed={isSelected}
            data-testid={`toggle-topic-${topic.slug}`}
          >
            {isSelected ? copy.topics.remove : copy.topics.select}
          </Button>

          {isSelected && (
            <NextLink href={`/topic/${topic.slug}`} passHref legacyBehavior>
              <Button as="a" size="sm" variant="ghost" colorScheme="teal">
                {copy.topics.studyNow} →
              </Button>
            </NextLink>
          )}
        </HStack>
      </Flex>
    </Box>
  );
}
