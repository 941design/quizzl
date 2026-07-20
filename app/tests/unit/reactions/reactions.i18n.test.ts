import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

describe('emoji-feature i18n keys', () => {
  it('English copy has all seven emoji keys with exact non-empty string values', () => {
    const en = getCopy('en');
    expect(en.emoji.openPicker).toBe('Open emoji picker');
    expect(en.emoji.closePicker).toBe('Close emoji picker');
    expect(en.emoji.reactWith).toBe('React with emoji');
    expect(en.emoji.insertEmoji).toBe('Insert emoji');
    expect(en.emoji.removeReaction).toBe('Remove reaction');
    expect(en.emoji.reactors).toBe('Reactors');
    expect(en.emoji.reactionCount).toBe('reactions');
  });

  it('German copy has all seven emoji keys with exact non-empty string values', () => {
    const de = getCopy('de');
    expect(de.emoji.openPicker).toBe('Emoji-Auswahl öffnen');
    expect(de.emoji.closePicker).toBe('Emoji-Auswahl schließen');
    expect(de.emoji.reactWith).toBe('Mit Emoji reagieren');
    expect(de.emoji.insertEmoji).toBe('Emoji einfügen');
    expect(de.emoji.removeReaction).toBe('Reaktion entfernen');
    expect(de.emoji.reactors).toBe('Reagiert von');
    expect(de.emoji.reactionCount).toBe('Reaktionen');
  });
});
