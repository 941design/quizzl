import { describe, it, expect } from 'vitest';
import { insertAtCursor } from '@/src/lib/reactions/composeInsert';

describe('insertAtCursor', () => {
  it('inserts in the middle of text (collapsed cursor)', () => {
    const { value, nextCaret } = insertAtCursor('hello world', 5, 5, '👍');
    expect(value).toBe('hello👍 world');
    // '👍' is U+1F44D — 2 UTF-16 code units
    expect(nextCaret).toBe(5 + '👍'.length);
  });

  it('replaces a selection range with the emoji', () => {
    // Select "hello", replace with 👍
    const { value, nextCaret } = insertAtCursor('hello world', 0, 5, '👍');
    expect(value).toBe('👍 world');
    expect(nextCaret).toBe('👍'.length);
  });

  it('inserts at the start (position 0)', () => {
    const { value, nextCaret } = insertAtCursor('hello', 0, 0, '🎉');
    expect(value).toBe('🎉hello');
    expect(nextCaret).toBe('🎉'.length);
  });

  it('inserts at the end of the string', () => {
    const { value, nextCaret } = insertAtCursor('hello', 5, 5, '✅');
    expect(value).toBe('hello✅');
    expect(nextCaret).toBe(5 + '✅'.length);
  });

  it('appends when selectionStart is null (textarea unfocused)', () => {
    const { value, nextCaret } = insertAtCursor('hello', null, null, '🔥');
    expect(value).toBe('hello🔥');
    expect(nextCaret).toBe('hello🔥'.length);
  });

  it('appends when selectionEnd is null even if selectionStart is set', () => {
    const { value, nextCaret } = insertAtCursor('hello', 3, null, '🔥');
    expect(value).toBe('hello🔥');
    expect(nextCaret).toBe('hello🔥'.length);
  });

  it('handles the multi-codepoint emoji ❤️ (U+2764 + U+FE0F) byte-exactly', () => {
    // ❤️ = U+2764 HEAVY BLACK HEART + U+FE0F VARIATION SELECTOR-16
    // In UTF-16 that is 2 code units (both are BMP), so .length === 2
    const heartWithVariation = '❤️'; // ❤️
    expect(heartWithVariation.length).toBe(2); // precondition sanity check

    const { value, nextCaret } = insertAtCursor('ab', 1, 1, heartWithVariation);
    // Expected: 'a' + '❤️' + 'b'
    expect(value).toBe('a' + heartWithVariation + 'b');
    // nextCaret = 1 + 2 = 3
    expect(nextCaret).toBe(1 + heartWithVariation.length);
    // Verify the before/after are byte-exact
    expect(value.slice(0, 1)).toBe('a');
    expect(value.slice(1, 1 + heartWithVariation.length)).toBe(heartWithVariation);
    expect(value.slice(1 + heartWithVariation.length)).toBe('b');
  });

  it('handles a surrogate-pair emoji (U+1F600 😀) byte-exactly', () => {
    // 😀 is U+1F600 — encoded as a surrogate pair in UTF-16, .length === 2
    const grinning = '😀';
    expect(grinning.length).toBe(2); // surrogate pair sanity check

    const { value, nextCaret } = insertAtCursor('xy', 1, 1, grinning);
    expect(value).toBe('x' + grinning + 'y');
    expect(nextCaret).toBe(1 + grinning.length);
    expect(value.slice(0, 1)).toBe('x');
    expect(value.slice(1 + grinning.length)).toBe('y');
  });

  it('inserts into empty string', () => {
    const { value, nextCaret } = insertAtCursor('', 0, 0, '👋');
    expect(value).toBe('👋');
    expect(nextCaret).toBe('👋'.length);
  });

  it('appends into empty string when unfocused', () => {
    const { value, nextCaret } = insertAtCursor('', null, null, '👋');
    expect(value).toBe('👋');
    expect(nextCaret).toBe('👋'.length);
  });

  // --- Edge-case normalization (round-2 remediation) ---

  it('handles reversed selection (selectionStart > selectionEnd, right-to-left drag)', () => {
    // User dragged right-to-left over "llo" (indices 2..5 in "hello world").
    // Browser passes selectionStart=5, selectionEnd=2. The selected text
    // "llo" should be replaced, producing "heX world".
    const { value, nextCaret } = insertAtCursor('hello world', 5, 2, 'X');
    expect(value).toBe('heX world');
    expect(nextCaret).toBe(2 + 'X'.length);
  });

  it('clamps negative selectionStart to 0', () => {
    // selectionStart=-3 is out-of-range; treat as 0.
    const { value, nextCaret } = insertAtCursor('abc', -3, 1, 'X');
    expect(value).toBe('Xbc');
    expect(nextCaret).toBe('X'.length);
  });

  it('clamps selectionEnd past string length to current.length', () => {
    // selectionEnd=99 exceeds string length 3; treat as 3.
    const { value, nextCaret } = insertAtCursor('abc', 1, 99, 'X');
    expect(value).toBe('aX');
    expect(nextCaret).toBe(1 + 'X'.length);
  });
});
