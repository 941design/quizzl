import React, { useCallback, useEffect, useRef } from 'react';
import {
  Box,
  Grid,
  IconButton,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  useDisclosure,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { CURATED_EMOJI } from '@/src/lib/reactions/types';

// Number of columns in the emoji grid (4 columns × 6 rows = 24 glyphs).
const GRID_COLS = 4;

export type EmojiComposerPickerHandle = {
  toggle: () => void;
};

type Props = {
  onSelect: (emoji: string) => void;
  /**
   * Forwarded ref so ChatBox can call handle.toggle() from the
   * Cmd/Ctrl+Shift+E keyboard handler without lifting disclosure state.
   */
  handleRef?: React.RefObject<EmojiComposerPickerHandle>;
  /**
   * Ref to the compose textarea. When the picker closes (by any means),
   * focus is returned to the textarea so the keyboard-open flow (Ctrl+Shift+E
   * → picker opens → Escape → textarea regains focus) works correctly.
   */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
};

/**
 * Compose-area emoji picker.
 *
 * Renders a Chakra Popover anchored to a ghost IconButton trigger.
 * The grid is 4 columns, role="grid" with arrow-key navigation.
 * Clicking a glyph calls onSelect(emoji) and closes the popover.
 *
 * Focus management:
 * - On open: a rAF-deferred imperative focus on the first glyph button fires
 *   after Chakra's useFocusOnShow completes (which focuses the PopoverContent
 *   section). This makes AC-28 testable: Escape fires on the focused glyph
 *   and our document-level Escape handler calls onClose() reliably.
 * - Escape is handled via a document keydown listener (capture phase) rather
 *   than React's synthetic event system, which is unreliable for portals when
 *   the React root is a sibling of document.body (where portals mount).
 * - On close: a setTimeout(0) after React commits focuses the textarea so
 *   subsequent Ctrl+Shift+E presses land on the textarea. Fires after Chakra's
 *   useFocusOnHide rAF (which returns focus to the trigger button).
 * - isLazy+lazyBehavior="unmount" removes portal content from the DOM after
 *   close, preventing Chakra's onBlur → setRestoreFocus → React re-render →
 *   mergeVariants() new reference → Framer Motion animation restart chain.
 * - motionProps disables the scaleFade animation so isLazy unmount fires
 *   via onAnimationComplete immediately rather than after the 100ms exit.
 */
export default function EmojiComposerPicker({ onSelect, handleRef, textareaRef }: Props) {
  const copy = useCopy();
  const { isOpen, onClose, onToggle } = useDisclosure();

  // Refs to each glyph button, keyed by index.
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Stable ref to onClose so the document keydown listener doesn't become
  // stale (onClose identity is stable from useDisclosure, but the ref pattern
  // is defensive against future refactors).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // On open: (a) focus the first glyph via rAF, (b) add a document-level
  // Escape listener. The document listener is more reliable than relying on
  // React's synthetic event bubbling through Chakra's portal, which can miss
  // keydown events when the focused element is rendered into document.body
  // and the React root is a sibling div rather than an ancestor.
  // On close: restore textarea focus after Framer Motion's exit animation.
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (!wasOpen && isOpen) {
      // Focus first glyph after Chakra's useFocusOnShow completes (rAF order).
      const rafId = requestAnimationFrame(() => {
        cellRefs.current[0]?.focus();
      });

      // Document-level Escape handler: more reliable than React synthetic
      // events through portals when the React root is not a DOM ancestor
      // of the portal's mount point (document.body).
      const handleEscapeKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCloseRef.current();
        }
      };
      document.addEventListener('keydown', handleEscapeKey, true); // capture phase

      return () => {
        cancelAnimationFrame(rafId);
        document.removeEventListener('keydown', handleEscapeKey, true);
      };
    }
    if (wasOpen && !isOpen) {
      // Picker just closed. Restore focus to the textarea after Chakra's
      // useFocusOnHide rAF (which returns focus to the trigger button).
      // setTimeout(0) fires AFTER rAF-scheduled focus so we can override it.
      // isLazy+unmount ensures the popover content is already gone, avoiding
      // Chakra onBlur → re-render cycles during the focus restoration.
      const timer = setTimeout(() => {
        textareaRef?.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  // textareaRef is a stable ref object — excluding from deps is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Expose toggle to parent via the handleRef so the keyboard shortcut
  // in ChatBox can open/close without lifting disclosure state.
  if (handleRef) {
    // Mutate the ref object directly (same pattern as useImperativeHandle
    // but without forwardRef overhead — the caller controls the ref).
    (handleRef as React.MutableRefObject<EmojiComposerPickerHandle>).current = {
      toggle: onToggle,
    };
  }

  // Track the currently focused grid cell index for arrow-key navigation.
  const focusedIndexRef = useRef<number>(0);

  const focusCell = useCallback((index: number) => {
    const el = cellRefs.current[index];
    if (el) {
      focusedIndexRef.current = index;
      el.focus();
    }
  }, []);

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const total = CURATED_EMOJI.length;
      const current = focusedIndexRef.current;

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault();
          focusCell((current + 1) % total);
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          focusCell((current - 1 + total) % total);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          focusCell((current + GRID_COLS) % total);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          focusCell((current - GRID_COLS + total) % total);
          break;
        }
        default:
          break;
      }
    },
    [focusCell],
  );

  const handleGlyphClick = useCallback(
    (emoji: string) => {
      onSelect(emoji);
      onClose();
    },
    [onSelect, onClose],
  );

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      placement="top-start"
      closeOnEsc
      closeOnBlur
      isLazy
      lazyBehavior="unmount"
    >
      <PopoverTrigger>
        <IconButton
          data-testid="emoji-composer-trigger"
          aria-label={copy.emoji.openPicker}
          icon={<SmileIcon />}
          size="sm"
          variant="ghost"
          onClick={onToggle}
        />
      </PopoverTrigger>

      {/*
       * motionProps: disable the scaleFade animation so Framer Motion's
       * onAnimationComplete fires immediately on close. This triggers Chakra's
       * useAnimationState to dispatch animationend → setMounted(false), which
       * together with isLazy unmounts the portal content from the DOM quickly.
       * Without this, mergeVariants() creates a new variants object reference
       * on every render while the exit animation is in flight, causing Framer
       * Motion to restart the animation and keep the picker visible indefinitely.
       */}
      <PopoverContent
        w="auto"
        bg="surfaceBg"
        borderColor="borderSubtle"
        data-testid="emoji-composer-popover"
        motionProps={{ variants: { enter: {}, exit: {} } }}
      >
        <PopoverArrow bg="surfaceBg" />
        <PopoverBody p={2}>
          <Grid
            role="grid"
            templateColumns={`repeat(${GRID_COLS}, 1fr)`}
            gap={1}
            onKeyDown={handleGridKeyDown}
          >
            {CURATED_EMOJI.map((emoji, index) => (
              <Box
                key={emoji}
                role="gridcell"
              >
                <Box
                  as="button"
                  ref={(el: HTMLButtonElement | null) => {
                    cellRefs.current[index] = el;
                  }}
                  data-testid={`emoji-glyph-${emoji}`}
                  aria-label={`${copy.emoji.insertEmoji} ${emoji}`}
                  role="button"
                  tabIndex={index === 0 ? 0 : -1}
                  fontSize="xl"
                  lineHeight="1"
                  p={1.5}
                  borderRadius="md"
                  cursor="pointer"
                  bg="transparent"
                  border="none"
                  _hover={{ bg: 'surfaceMutedBg' }}
                  _focusVisible={{ boxShadow: 'outline' }}
                  onClick={() => handleGlyphClick(emoji)}
                  onFocus={() => {
                    focusedIndexRef.current = index;
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleGlyphClick(emoji);
                    }
                  }}
                >
                  {emoji}
                </Box>
              </Box>
            ))}
          </Grid>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

function SmileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 13s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}
