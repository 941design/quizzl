/**
 * Pure helper for inserting an emoji glyph into a textarea value at the
 * current cursor position. Extracted from the compose UI so it can be
 * unit-tested without a DOM or React component rendering.
 *
 * Owned by: reactions-store (app/src/lib/reactions/)
 * Consumed by: chat-shell (app/src/components/chat/ChatBox.tsx)
 */

/**
 * Insert an emoji glyph into `current` at the selection range
 * [selectionStart, selectionEnd].
 *
 * When `selectionStart` or `selectionEnd` is null (textarea is unfocused /
 * no cursor established), the emoji is appended to the end.
 *
 * Returns the new textarea value and the caret position that should be
 * set after the React state update is committed to the DOM.
 *
 * Note: uses String.prototype.slice — byte positions are UTF-16 code-unit
 * indices, consistent with selectionStart/selectionEnd on <textarea>.
 */
export function insertAtCursor(
  current: string,
  selectionStart: number | null,
  selectionEnd: number | null,
  emoji: string,
): { value: string; nextCaret: number } {
  if (selectionStart === null || selectionEnd === null) {
    // Unfocused fallback: append to end.
    return {
      value: current + emoji,
      nextCaret: current.length + emoji.length,
    };
  }

  // Clamp each endpoint independently, then normalize order so that a
  // right-to-left drag (selectionStart > selectionEnd) still replaces the
  // visually-selected range rather than collapsing it to a point.
  const rawStart = Math.max(0, Math.min(selectionStart, current.length));
  const rawEnd = Math.max(0, Math.min(selectionEnd, current.length));
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd);

  const before = current.slice(0, start);
  const after = current.slice(end);
  const value = before + emoji + after;
  const nextCaret = start + emoji.length;

  return { value, nextCaret };
}
