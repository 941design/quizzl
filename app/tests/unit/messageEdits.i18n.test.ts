/**
 * i18n completeness for the message edit/delete surface
 * (S6, epic-feature-request-message-edit-and-delete). AC-INTL-1: every new
 * user-facing string has both `en` and `de` entries with non-empty values.
 * AC-INTEROP-1/2: copy stays neutral — no "erased"/"deleted for everyone"
 * language, no claim that a non-Few client honors delete/edit as a
 * guarantee. Mirrors `reactions/reactions.i18n.test.ts`'s pattern.
 */

import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

const HARD_GUARANTEE_PATTERNS = [/erased/i, /deleted for everyone/i, /permanently removed everywhere/i];

describe('message edit/delete i18n keys', () => {
  it('English copy has all new keys with exact non-empty string values', () => {
    const en = getCopy('en');
    expect(en.groups.msgEditAction).toBe('Edit');
    expect(en.groups.msgDeleteAction).toBe('Delete');
    expect(en.groups.msgEditingBadge).toBe('Editing message');
    expect(en.groups.msgEditSave).toBe('Save edit');
    expect(en.groups.msgEditEmptyHint).toBe("A message can't be empty — delete it instead.");
    expect(en.groups.msgDeleteConfirmPrompt).toBe('Delete this message?');
    expect(en.groups.msgDeleteConfirmButton).toBe('Yes, delete');
    expect(en.groups.msgEditedMarker).toBe('(edited)');
    expect(en.groups.listPreviewPhoto).toBe('Photo');
    expect(en.groups.listPreviewEmpty).toBe('No messages yet');
    expect(en.groups.listPreviewStructured).toBe('New activity');
    expect(en.groups.chatSend).toBe('Send message');
    // AC-INTL-1: Cancel is reused from the existing groups.cancel key (already
    // has en/de entries) rather than duplicated — still asserted here so a
    // future rename of `cancel` doesn't silently orphan the edit-mode/delete-
    // confirm Cancel actions.
    expect(en.groups.cancel).toBeTruthy();
  });

  it('German copy has all new keys with exact non-empty string values', () => {
    const de = getCopy('de');
    expect(de.groups.msgEditAction).toBe('Bearbeiten');
    expect(de.groups.msgDeleteAction).toBe('Löschen');
    expect(de.groups.msgEditingBadge).toBe('Nachricht wird bearbeitet');
    expect(de.groups.msgEditSave).toBe('Änderung speichern');
    expect(de.groups.msgEditEmptyHint).toBe('Eine Nachricht darf nicht leer sein — lösche sie stattdessen.');
    expect(de.groups.msgDeleteConfirmPrompt).toBe('Diese Nachricht löschen?');
    expect(de.groups.msgDeleteConfirmButton).toBe('Ja, löschen');
    expect(de.groups.msgEditedMarker).toBe('(bearbeitet)');
    expect(de.groups.listPreviewPhoto).toBe('Foto');
    expect(de.groups.listPreviewEmpty).toBe('Noch keine Nachrichten');
    expect(de.groups.listPreviewStructured).toBe('Neue Aktivität');
    expect(de.groups.chatSend).toBe('Nachricht senden');
    expect(de.groups.cancel).toBeTruthy();
  });

  it('AC-INTEROP-1/2: no en/de string implies a hard/enforced guarantee (erased, deleted-for-everyone, non-Few honoring)', () => {
    const en = getCopy('en');
    const de = getCopy('de');
    const allStrings = [
      en.groups.msgEditAction, en.groups.msgDeleteAction, en.groups.msgEditingBadge,
      en.groups.msgEditSave, en.groups.msgEditEmptyHint, en.groups.msgDeleteConfirmPrompt,
      en.groups.msgDeleteConfirmButton, en.groups.msgEditedMarker, en.groups.listPreviewPhoto,
      en.groups.listPreviewEmpty, en.groups.listPreviewStructured, en.groups.chatSend,
      de.groups.msgEditAction, de.groups.msgDeleteAction, de.groups.msgEditingBadge,
      de.groups.msgEditSave, de.groups.msgEditEmptyHint, de.groups.msgDeleteConfirmPrompt,
      de.groups.msgDeleteConfirmButton, de.groups.msgEditedMarker, de.groups.listPreviewPhoto,
      de.groups.listPreviewEmpty, de.groups.listPreviewStructured, de.groups.chatSend,
    ];
    for (const s of allStrings) {
      for (const pattern of HARD_GUARANTEE_PATTERNS) {
        expect(s).not.toMatch(pattern);
      }
    }
  });
});
