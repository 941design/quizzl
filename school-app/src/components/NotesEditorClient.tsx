import React, { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Box, HStack, IconButton, Divider, Button, Tooltip } from '@chakra-ui/react';

type NotesEditorClientProps = {
  initialContent: string;
  onUpdate: (html: string) => void;
};

const DEBOUNCE_MS = 500;

export default function NotesEditorClient({
  initialContent,
  onUpdate,
}: NotesEditorClientProps) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'editor-link',
        },
      }),
    ],
    content: initialContent || '<p></p>',
    onUpdate: ({ editor }) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        onUpdate(editor.getHTML());
      }, DEBOUNCE_MS);
    },
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  if (!editor) return null;

  return (
    <Box>
      {/* Toolbar */}
      <Box
        p={2}
        bg="gray.50"
        borderBottomWidth="1px"
        borderColor="gray.200"
        data-testid="editor-toolbar"
      >
        <HStack spacing={1} flexWrap="wrap">
          <Tooltip label="Bold (Ctrl+B)" hasArrow>
            <Button
              size="xs"
              variant={editor.isActive('bold') ? 'solid' : 'ghost'}
              onClick={() => editor.chain().focus().toggleBold().run()}
              aria-label="Bold"
              fontWeight="bold"
              data-testid="toolbar-bold"
            >
              B
            </Button>
          </Tooltip>

          <Tooltip label="Italic (Ctrl+I)" hasArrow>
            <Button
              size="xs"
              variant={editor.isActive('italic') ? 'solid' : 'ghost'}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              aria-label="Italic"
              fontStyle="italic"
              data-testid="toolbar-italic"
            >
              I
            </Button>
          </Tooltip>

          <Divider orientation="vertical" h="24px" />

          <Tooltip label="Heading 1" hasArrow>
            <Button
              size="xs"
              variant={editor.isActive('heading', { level: 1 }) ? 'solid' : 'ghost'}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              aria-label="Heading 1"
              data-testid="toolbar-h1"
            >
              H1
            </Button>
          </Tooltip>

          <Tooltip label="Heading 2" hasArrow>
            <Button
              size="xs"
              variant={editor.isActive('heading', { level: 2 }) ? 'solid' : 'ghost'}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              aria-label="Heading 2"
              data-testid="toolbar-h2"
            >
              H2
            </Button>
          </Tooltip>

          <Divider orientation="vertical" h="24px" />

          <Tooltip label="Bullet List" hasArrow>
            <Button
              size="xs"
              variant={editor.isActive('bulletList') ? 'solid' : 'ghost'}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              aria-label="Bullet list"
              data-testid="toolbar-bullet-list"
            >
              UL
            </Button>
          </Tooltip>

          <Tooltip label="Numbered List" hasArrow>
            <Button
              size="xs"
              variant={editor.isActive('orderedList') ? 'solid' : 'ghost'}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              aria-label="Ordered list"
              data-testid="toolbar-ordered-list"
            >
              OL
            </Button>
          </Tooltip>
        </HStack>
      </Box>

      {/* Editor Content */}
      <Box
        p={4}
        minH="200px"
        className="tiptap-editor"
        sx={{
          '.ProseMirror': {
            outline: 'none',
            minHeight: '150px',
            '& p': { marginBottom: '0.5rem' },
            '& h1': { fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' },
            '& h2': { fontSize: '1.25rem', fontWeight: 'semibold', marginBottom: '0.5rem' },
            '& ul': { paddingLeft: '1.5rem', listStyleType: 'disc' },
            '& ol': { paddingLeft: '1.5rem', listStyleType: 'decimal' },
            '& a': { color: 'teal.500', textDecoration: 'underline' },
            '& p.is-editor-empty:first-child::before': {
              content: '"Start writing your notes here..."',
              color: 'gray.400',
              pointerEvents: 'none',
              float: 'left',
              height: 0,
            },
          },
        }}
        data-testid="editor-content"
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}
