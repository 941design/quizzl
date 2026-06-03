/**
 * Reusable MLS group setup helper for walled-garden tests.
 *
 * Creates a shared MLS group between two users (inviter + invitee) so that
 * the walled-garden gate allows DMs between them.
 *
 * Usage:
 *   await createGroupAndInvite(alicePage, USER_B.npub, bobPage, 'Test Group');
 *
 * After this call:
 *   - Alice has a group visible in her groups list.
 *   - Bob has received the Welcome and the group appears in his list.
 *   - isAllowedDmSender(bob, alice.groups, alice.pubkey) === true.
 *
 * Both pages must already be on /groups/ (groups-empty-state or groups-list visible).
 */

import { Page, expect } from '@playwright/test';
import { nip19 } from 'nostr-tools';
import { dismissErrorOverlay } from './dismiss-error-overlay';

/**
 * Alice creates a named group, invites Bob by npub, and waits for Bob to join.
 *
 * @param alicePage    Page where Alice is already on /groups/
 * @param inviteeNpub  Bob's npub (bech32 public key)
 * @param bobPage      Page where Bob can receive Welcome events
 * @param groupName    Display name for the new group
 */
export async function createGroupAndInvite(
  alicePage: Page,
  inviteeNpub: string,
  bobPage: Page,
  groupName: string,
): Promise<void> {
  // Ensure Alice is on the groups page
  await alicePage.goto('/groups/');
  await expect(
    alicePage.getByTestId('groups-empty-state').or(alicePage.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 30_000 });

  // Alice creates the group
  await alicePage.getByTestId('create-group-btn').click();
  await expect(alicePage.getByTestId('create-group-modal-content')).toBeVisible();
  await alicePage.getByTestId('create-group-name-input').fill(groupName);
  await alicePage.getByTestId('create-group-submit-btn').click();
  await expect(alicePage.getByText(groupName)).toBeVisible({ timeout: 30_000 });
  await expect(alicePage.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
  await dismissErrorOverlay(alicePage);
  // Give the group state time to stabilise before inviting
  await alicePage.waitForTimeout(3_000);

  // Open the group detail and invite Bob
  await alicePage.locator('[data-testid^="group-card-"]', { hasText: groupName }).click();
  await expect(alicePage.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

  await alicePage.getByTestId('invite-member-btn').click();
  await expect(alicePage.getByTestId('invite-member-modal-content')).toBeVisible();
  await alicePage.getByTestId('invite-npub-input').fill(inviteeNpub);
  await alicePage.getByTestId('invite-submit-btn').click();
  await expect(alicePage.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });
  await dismissErrorOverlay(alicePage);
  // Give the Welcome event time to propagate
  await alicePage.waitForTimeout(3_000);

  // Bob waits for the Welcome and the group to appear in his list
  await bobPage.waitForTimeout(5_000);
  await bobPage.goto('/groups/');
  await expect(
    bobPage.getByTestId('groups-empty-state').or(bobPage.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 30_000 });
  await expect(bobPage.getByText(groupName)).toBeVisible({ timeout: 90_000 });

  // Decode inviteeNpub to hex so the IDB poll can compare memberPubkeys
  // (IDB stores hex pubkeys, not bech32).
  const inviteeHex = inviteeNpub.startsWith('npub')
    ? (nip19.decode(inviteeNpub).data as string)
    : inviteeNpub;

  // Wait for Alice's MarmotContext to have persisted the invitee into memberPubkeys.
  // Groups are stored in IndexedDB ('quizzl-groups-meta' / 'groups').
  // The gate in DirectMessageNotificationsWatcher reads groupsRef.current which
  // is only accurate once MarmotContext has called setGroups with the updated
  // memberPubkeys — i.e. after reloadGroups() completes following Welcome processing.
  // Polling IDB directly gives us the ground-truth signal that the Welcome ratchet
  // has been processed and persisted on Alice's side.
  await alicePage.waitForFunction(
    (inviteePubHex: string) => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('quizzl-groups-meta');
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;
          let tx: IDBTransaction;
          try {
            tx = db.transaction('groups', 'readonly');
          } catch {
            db.close();
            resolve(false);
            return;
          }
          const store = tx.objectStore('groups');
          const allKeys = store.getAllKeys();
          allKeys.onsuccess = () => {
            const keys = allKeys.result as IDBValidKey[];
            if (keys.length === 0) { db.close(); resolve(false); return; }
            let checked = 0;
            let found = false;
            keys.forEach((k) => {
              const getReq = store.get(k);
              getReq.onsuccess = () => {
                const group = getReq.result as { memberPubkeys?: string[] } | undefined;
                if (group?.memberPubkeys?.includes(inviteePubHex)) found = true;
                checked++;
                if (checked === keys.length) { db.close(); resolve(found); }
              };
              getReq.onerror = () => {
                checked++;
                if (checked === keys.length) { db.close(); resolve(found); }
              };
            });
          };
          allKeys.onerror = () => { db.close(); resolve(false); };
        };
      });
    },
    inviteeHex,
    { timeout: 60_000, polling: 1_000 },
  );

  // Extra settle time for both MarmotContext instances to update their groups state
  await bobPage.waitForTimeout(2_000);
}
