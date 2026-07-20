/**
 * EmojiReactionPicker — per-message-bubble reaction trigger and picker.
 *
 * Architecture:
 * - Anchors on a per-bubble basis (NOT the compose textarea toolbar).
 * - Plain conditional render (no Chakra Popover) — Chakra Popover's
 *   AnimatePresence/lazy-unmount path proved racy in this trigger context
 *   (the picker stayed mounted ~50% of the time after onClose). The conditional
 *   render gives a deterministic mount/unmount tied to isOpen.
 * - 36-glyph grid from CURATED_EMOJI in a 6-column layout (more compact than compose
 *   picker's 4-column layout, per spec §1.2 "more compact layout for reaction picker").
 * - Initial focus moves to the first glyph on open (lesson from story-05 round 1).
 * - data-testid namespace: reaction-picker-glyph-{emoji} (distinct from compose picker).
 * - Trigger: data-testid="reaction-trigger-{messageId}", aria-label=copy.emoji.reactWith.
 * - onSelect(emoji) calls computeReactOp to determine add/remove, then calls onReact.
 *
 * Module boundary: imports only from lib/ and context/ — no ChatStoreContext or
 * useDirectReactions (those live in parent components and pass data via props).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Grid,
  IconButton,
  Portal,
  useDisclosure,
} from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import { CURATED_EMOJI } from '@/src/lib/reactions/types';
import type { ReactionAggregate } from '@/src/lib/reactions/api';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import { computeReactOp } from '@/src/lib/reactions/reactionUiHelpers';

// 6 columns × 4 rows for the reaction picker (more compact than compose picker's 4-col layout).
const GRID_COLS = 6;

type Props = {
  messageId: string;
  message: ChatMessage;
  aggregates: ReactionAggregate[];
  onReact: (emoji: string, message: ChatMessage, op: 'add' | 'remove') => Promise<void>;
};

/**
 * Renders a small ghost IconButton on each message bubble that opens a compact
 * reaction picker popover anchored to the trigger.
 *
 * The trigger is revealed on hover via the parent's _groupHover pattern (the
 * parent Box wrapping the bubble has role="group").
 */
export default function EmojiReactionPicker({ messageId, message, aggregates, onReact }: Props) {
  const copy = useCopy();
  const { isOpen, onClose, onToggle } = useDisclosure();

  // Wrapper around trigger+picker; used by the outside-click effect.
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Trigger ref for computing portal-rendered picker coords.
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Picker portal ref so the outside-click handler can also exempt clicks inside
  // the portaled picker (the picker is no longer a DOM descendant of wrapperRef).
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Picker coords in viewport space; computed once when isOpen flips true.
  // Drift on scroll while open is acceptable (the picker is short-lived).
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Initial focus target on open (first glyph).
  const firstGlyphRef = useRef<HTMLButtonElement | null>(null);

  // Refs for arrow-key navigation between glyph cells.
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusedIndexRef = useRef<number>(0);

  // Compute picker coords once when it opens — anchored above the trigger,
  // horizontally centered on it. No resize/scroll listener; drift is acceptable.
  useEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({
        top: rect.top, // picker is positioned with `bottom: rect.top` via translate
        left: rect.left + rect.width / 2,
      });
    }
  }, [isOpen]);

  // Move focus to the first glyph when the picker opens (a11y / keyboard nav).
  useEffect(() => {
    if (isOpen) firstGlyphRef.current?.focus();
  }, [isOpen]);

  // closeOnEsc replacement: document-level keydown listener active while open.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // closeOnBlur replacement: outside-mousedown listener active while open.
  // The picker is portaled, so we exempt clicks inside the picker as well as
  // clicks inside the trigger wrapper.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideWrapper = wrapperRef.current?.contains(target);
      const insidePicker = pickerRef.current?.contains(target);
      if (!insideWrapper && !insidePicker) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

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
      const op = computeReactOp(aggregates, emoji);
      onReact(emoji, message, op).catch(() => {
        // Failure is handled by the onReact owner, which silently rolls back
        // the optimistic reaction (no user-facing notice).
      });
      onClose();
    },
    [aggregates, message, onReact, onClose],
  );

  return (
    <Box ref={wrapperRef} display="inline-block">
      <IconButton
        ref={triggerRef}
        data-testid={`reaction-trigger-${messageId}`}
        aria-label={copy.emoji.reactWith}
        icon={<PlusSmileIcon />}
        size="xs"
        variant="ghost"
        opacity={0}
        _groupHover={{ opacity: 1 }}
        _focusVisible={{ opacity: 1 }}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      />
      {isOpen && coords && (
        // Portaled into document.body to escape the parent stacking context
        // (contact-detail-page would otherwise overlay the picker).
        <Portal>
          <Box
            ref={pickerRef}
            data-testid={`reaction-picker-${messageId}`}
            role="dialog"
            position="fixed"
            top={`${coords.top}px`}
            left={`${coords.left}px`}
            transform="translate(-50%, -100%)"
            mt={-1}
            zIndex="popover"
            bg="surfaceBg"
            borderColor="borderSubtle"
            borderWidth="1px"
            borderRadius="md"
            boxShadow="md"
            p={1.5}
          >
          <Grid
            role="grid"
            templateColumns={`repeat(${GRID_COLS}, 1fr)`}
            gap={0.5}
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
                    if (index === 0) {
                      firstGlyphRef.current = el;
                    }
                  }}
                  data-testid={`reaction-picker-glyph-${emoji}`}
                  aria-label={`${copy.emoji.reactWith} ${emoji}`}
                  role="button"
                  tabIndex={index === 0 ? 0 : -1}
                  fontSize="lg"
                  lineHeight="1"
                  p={1}
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
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      onClose();
                    }
                  }}
                >
                  {emoji}
                </Box>
              </Box>
            ))}
          </Grid>
          </Box>
        </Portal>
      )}
    </Box>
  );
}

function PlusSmileIcon() {
  return (
    <svg
      width="14"
      height="14"
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
      <line x1="18" y1="6" x2="18" y2="10" />
      <line x1="16" y1="8" x2="20" y2="8" />
    </svg>
  );
}
