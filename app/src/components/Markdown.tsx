import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Heading, Text, Link, UnorderedList, OrderedList, ListItem } from '@chakra-ui/react';

/**
 * Renders a markdown string using the app's Chakra components, so long-form
 * content files (info, imprint) match the rest of the UI without bespoke
 * styling. Content lives in `src/content/*.md`; short UI strings stay in
 * i18n.ts (see CLAUDE.md's content/i18n split).
 */
const COMPONENTS: Components = {
  h1: ({ children }) => (
    <Heading as="h1" size="xl" mb={6}>
      {children}
    </Heading>
  ),
  h2: ({ children }) => (
    <Heading as="h2" size="sm" mt={6} mb={2}>
      {children}
    </Heading>
  ),
  h3: ({ children }) => (
    <Heading as="h3" size="sm" mt={4} mb={2}>
      {children}
    </Heading>
  ),
  p: ({ children }) => <Text mb={3}>{children}</Text>,
  a: ({ href, children }) => (
    <Link href={href} color="brand.500">
      {children}
    </Link>
  ),
  ul: ({ children }) => (
    <UnorderedList spacing={1} mb={3}>
      {children}
    </UnorderedList>
  ),
  ol: ({ children }) => (
    <OrderedList spacing={1} mb={3}>
      {children}
    </OrderedList>
  ),
  li: ({ children }) => <ListItem>{children}</ListItem>,
};

export default function Markdown({ children }: { children: string }) {
  return (
    // Content is first-party (our own src/content/*.md), so URL sanitization is
    // safe to bypass — needed so `tel:` links survive (react-markdown's default
    // urlTransform drops any protocol outside its http/https/mailto safe-list).
    <ReactMarkdown components={COMPONENTS} urlTransform={(url) => url}>
      {children}
    </ReactMarkdown>
  );
}
