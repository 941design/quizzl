import { describe, it, expect } from 'vitest';
import { capNickname, NICKNAME_MAX_BYTES } from '@/src/config/profile';
import { utf8ByteLength } from '@/src/lib/contactCard';
import { getCopy } from '@/src/lib/i18n';

// AC-CARD-7: the profile nickname save enforces a 32-UTF-8-BYTE cap (not a
// character / UTF-16 code-unit count). These tests deliberately use multi-byte
// characters so the byte boundary is NOT accidentally aligned with a character
// count: "ü" is 2 UTF-8 bytes, "😀" is 4. They drive the real capNickname()
// (a thin adapter over S1's truncateUtf8), never a re-implemented byte count.

describe('capNickname — 32-UTF-8-byte boundary', () => {
  it('caps at 32 bytes, not 32 characters', () => {
    expect(NICKNAME_MAX_BYTES).toBe(32);
  });

  it('leaves a 31-byte nickname untouched (15×"ü" + "a" = 31 bytes)', () => {
    const raw = 'ü'.repeat(15) + 'a';
    expect(utf8ByteLength(raw)).toBe(31);
    const { value, capped } = capNickname(raw);
    expect(capped).toBe(false);
    expect(value).toBe(raw);
  });

  it('leaves a nickname exactly at the 32-byte cap untouched (16×"ü" = 32 bytes)', () => {
    const raw = 'ü'.repeat(16);
    expect(utf8ByteLength(raw)).toBe(32);
    const { value, capped } = capNickname(raw);
    expect(capped).toBe(false);
    expect(value).toBe(raw);
  });

  it('truncates a 33-byte nickname to 32 bytes and reports capped (16×"ü" + "a")', () => {
    const raw = 'ü'.repeat(16) + 'a';
    expect(utf8ByteLength(raw)).toBe(33);
    const { value, capped } = capNickname(raw);
    expect(capped).toBe(true);
    // Drops the trailing "a"; the 16 umlauts (32 bytes) survive intact.
    expect(value).toBe('ü'.repeat(16));
    expect(utf8ByteLength(value)).toBe(32);
  });

  it('never splits a multi-byte character when truncating (emoji, 4 bytes each)', () => {
    const raw = '😀'.repeat(9); // 36 bytes
    expect(utf8ByteLength(raw)).toBe(36);
    const { value, capped } = capNickname(raw);
    expect(capped).toBe(true);
    // 8 emoji = 32 bytes exactly; a 9th would overshoot and is dropped whole,
    // never leaving a broken partial 4-byte sequence.
    expect(value).toBe('😀'.repeat(8));
    expect(utf8ByteLength(value)).toBe(32);
    expect([...value]).toHaveLength(8);
  });

  it('caps 33 ASCII bytes (proves plain-ASCII path still enforced)', () => {
    const { value, capped } = capNickname('a'.repeat(33));
    expect(capped).toBe(true);
    expect(value).toBe('a'.repeat(32));
    expect(utf8ByteLength(value)).toBeLessThanOrEqual(NICKNAME_MAX_BYTES);
  });
});

describe('nicknameLimit i18n copy', () => {
  it('is a translated function in both languages, referencing the limit', () => {
    const en = getCopy('en').settings.nicknameLimit;
    const de = getCopy('de').settings.nicknameLimit;
    expect(typeof en).toBe('function');
    expect(typeof de).toBe('function');
    const enMsg = en(NICKNAME_MAX_BYTES);
    const deMsg = de(NICKNAME_MAX_BYTES);
    expect(enMsg).toContain(String(NICKNAME_MAX_BYTES));
    expect(deMsg).toContain(String(NICKNAME_MAX_BYTES));
    expect(enMsg.length).toBeGreaterThan(0);
    // German copy is a distinct translation, not the English string.
    expect(deMsg).not.toBe(enMsg);
  });
});
