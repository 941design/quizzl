import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

describe('addContactByNpub i18n keys', () => {
  it('English copy has all required keys with exact values', () => {
    const en = getCopy('en');
    expect(en.contacts.addContactBtn).toBe('Add Contact');
    expect(en.contacts.addContactTitle).toBe('Add Contact by Npub');
    expect(en.contacts.addContactNpubLabel).toBe("Contact's npub");
    expect(en.contacts.addContactNpubPlaceholder).toBe('npub1...');
    expect(en.contacts.addContactHelp).toBe(
      "Enter or scan someone's npub to add them as a contact — no shared group needed."
    );
    expect(en.contacts.addContactSubmit).toBe('Add Contact');
    expect(en.contacts.addContactCancel).toBe('Cancel');
    expect(en.contacts.addContactSuccess).toBe('Contact added');
    expect(en.contacts.addContactErrorInvalidNpub).toBe(
      "That doesn't look like a valid npub. Please check and try again."
    );
    expect(en.contacts.addContactErrorSelf).toBe("You can't add yourself as a contact.");
    expect(en.contacts.addContactErrorAlreadyExists).toBe('This person is already in your contacts.');
    expect(en.contacts.addContactErrorGeneric).toBe("Couldn't add this contact. Please try again.");

    expect(en.contacts.description).toBe(
      'People from your shared groups stay here so you can keep chatting directly. You can also add someone directly by their npub.'
    );
    expect(en.contacts.emptyBody).toBe(
      'Join a group with someone, or add their npub directly, and they will appear here.'
    );
  });

  it('German copy has all required keys with exact values', () => {
    const de = getCopy('de');
    expect(de.contacts.addContactBtn).toBe('Kontakt hinzufügen');
    expect(de.contacts.addContactTitle).toBe('Kontakt per Npub hinzufügen');
    expect(de.contacts.addContactNpubLabel).toBe('Npub der Person');
    expect(de.contacts.addContactNpubPlaceholder).toBe('npub1...');
    expect(de.contacts.addContactHelp).toBe(
      'Gib den Npub einer Person ein oder scanne ihn, um sie als Kontakt hinzuzufügen – eine gemeinsame Gruppe ist nicht nötig.'
    );
    expect(de.contacts.addContactSubmit).toBe('Kontakt hinzufügen');
    expect(de.contacts.addContactCancel).toBe('Abbrechen');
    expect(de.contacts.addContactSuccess).toBe('Kontakt hinzugefügt');
    expect(de.contacts.addContactErrorInvalidNpub).toBe(
      'Das sieht nicht nach einem gültigen Npub aus. Bitte überprüfe die Eingabe.'
    );
    expect(de.contacts.addContactErrorSelf).toBe('Du kannst dich nicht selbst als Kontakt hinzufügen.');
    expect(de.contacts.addContactErrorAlreadyExists).toBe('Diese Person ist bereits in deinen Kontakten.');
    expect(de.contacts.addContactErrorGeneric).toBe(
      'Der Kontakt konnte nicht hinzugefügt werden. Bitte versuche es erneut.'
    );

    expect(de.contacts.description).toBe(
      'Personen aus gemeinsamen Gruppen bleiben hier erhalten, damit du direkt weiterschreiben kannst. Du kannst auch direkt jemanden über den Npub hinzufügen.'
    );
    expect(de.contacts.emptyBody).toBe(
      'Tritt einer Gruppe mit anderen Personen bei oder füge direkt einen Npub hinzu, dann erscheinen sie hier.'
    );
  });
});
