import React, { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Box,
  HStack,
  IconButton,
  Text,
  Skeleton,
  Divider,
  Tooltip,
} from '@chakra-ui/react';

// Dynamic import to avoid SSR issues with TipTap
const NotesEditor = dynamic(() => import('./NotesEditorClient'), {
  ssr: false,
  loading: () => (
    <Box>
      <Skeleton height="40px" mb={2} />
      <Skeleton height="200px" />
    </Box>
  ),
});

type NotesTabProps = {
  slug: string;
  notesHtml: string;
  onUpdate: (html: string) => void;
};

export default function NotesTab({ slug, notesHtml, onUpdate }: NotesTabProps) {
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  const handleUpdate = useCallback(
    (html: string) => {
      setSaveStatus('saving');
      onUpdate(html);
      // Status updates after a brief delay to show "Saved"
      setTimeout(() => setSaveStatus('saved'), 600);
    },
    [onUpdate]
  );

  return (
    <Box>
      {/* Save status */}
      <HStack justify="flex-end" mb={2}>
        <Text
          fontSize="xs"
          color={
            saveStatus === 'saving'
              ? 'orange.500'
              : saveStatus === 'saved'
              ? 'green.500'
              : 'gray.400'
          }
          data-testid="save-status"
        >
          {saveStatus === 'saving'
            ? 'Saving...'
            : saveStatus === 'saved'
            ? 'Saved'
            : 'Unsaved'}
        </Text>
      </HStack>

      <Box
        borderWidth="1px"
        borderColor="gray.200"
        borderRadius="lg"
        overflow="hidden"
        data-testid="notes-editor"
      >
        <NotesEditor
          key={slug}
          initialContent={notesHtml}
          onUpdate={handleUpdate}
        />
      </Box>

      <Text fontSize="xs" color="gray.400" mt={2}>
        Notes are saved automatically to your browser.
      </Text>
    </Box>
  );
}
