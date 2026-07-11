import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

/**
 * The manual "Add Contact by npub" modal was removed (the npub abstraction
 * confused new users). Contacts are now added only indirectly — via a shared
 * group, an inbound DM, or opening a contact-card link. The addContact*
 * SUCCESS/ERROR copy is retained because the surviving card-link add path
 * (the `/add` deep-link page) still surfaces it; the modal-only labels
 * (button/title/input/help/submit/cancel) were deleted along with the modal.
 */
describe('addContact i18n keys (card-link add path)', () => {
  it('English copy has the retained add-result keys and npub-free list copy', () => {
    const en = getCopy('en');
    expect(en.contacts.addContactSuccess).toBe('Contact added');
    expect(en.contacts.addContactErrorInvalidNpub).toBe(
      "That doesn't look like a valid npub. Please check and try again."
    );
    expect(en.contacts.addContactErrorSelf).toBe("You can't add yourself as a contact.");
    expect(en.contacts.addContactErrorAlreadyExists).toBe('This person is already in your contacts.');
    expect(en.contacts.addContactErrorGeneric).toBe("Couldn't add this contact. Please try again.");

    // The list copy no longer teaches the npub concept.
    expect(en.contacts.emptyBody).toBe(
      'Join a group with someone, or open a contact card link they share with you, and they will appear here.'
    );
    expect(en.contacts.emptyBody).not.toMatch(/npub/i);
  });

  it('German copy has the retained add-result keys and npub-free list copy', () => {
    const de = getCopy('de');
    expect(de.contacts.addContactSuccess).toBe('Kontakt hinzugefügt');
    expect(de.contacts.addContactErrorInvalidNpub).toBe(
      'Das sieht nicht nach einem gültigen Npub aus. Bitte überprüfe die Eingabe.'
    );
    expect(de.contacts.addContactErrorSelf).toBe('Du kannst dich nicht selbst als Kontakt hinzufügen.');
    expect(de.contacts.addContactErrorAlreadyExists).toBe('Diese Person ist bereits in deinen Kontakten.');
    expect(de.contacts.addContactErrorGeneric).toBe(
      'Der Kontakt konnte nicht hinzugefügt werden. Bitte versuche es erneut.'
    );

    expect(de.contacts.emptyBody).toBe(
      'Tritt einer Gruppe mit anderen Personen bei oder öffne eine Kontaktkarte, die dir jemand teilt, dann erscheinen sie hier.'
    );
    expect(de.contacts.emptyBody).not.toMatch(/npub/i);
  });
});
