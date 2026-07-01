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
 */

import { Page, expect } from '@playwright/test';
import { nip19 } from 'nostr-tools';
import { dismissErrorOverlay } from './dismiss-error-overlay';

/**
 * Alice creates a named group, invites Bob by npub, and waits for Bob to join.
 *
 * Bob navigates to /groups/ BEFORE Alice's flow so that stale gift wraps from
 * previous test runs arrive and are processed (their eventIds get marked as seen
 * by the production fix in welcomeSubscription). We then clear only the pending
 * invitations queue (not the seen-set), so when Alice's fresh invite arrives it
 * is the sole entry in the queue.
 *
 * @param alicePage    Page logged in as Alice
 * @param inviteeNpub  Bob's npub (bech32 public key)
 * @param bobPage      Page logged in as Bob
 * @param groupName    Display name for the new group
 */
export async function createGroupAndInvite(
  alicePage: Page,
  inviteeNpub: string,
  bobPage: Page,
  groupName: string,
): Promise<void> {
  // Step 1: Bob navigates to /groups/ early so the welcome subscription is live.
  // Stale relay gift wraps arrive and are processed here; their eventIds are
  // recorded in the seen-set by the production fix.
  await bobPage.goto('/groups/');
  await expect(
    bobPage.getByTestId('groups-empty-state').or(bobPage.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 30_000 });

  // Step 2: Wait for stale relay events to arrive and be marked as seen.
  await bobPage.waitForTimeout(10_000);

  // Step 3: Clear only the pending invitations queue — NOT the seen-set.
  // Stale eventIds remain marked so they cannot re-appear as new invitations.
  await bobPage.evaluate(() => {
    localStorage.removeItem('lp_pendingInvitations_v1');
  });

  // Step 4: Alice navigates to the groups page.
  await alicePage.goto('/groups/');
  await expect(
    alicePage.getByTestId('groups-empty-state').or(alicePage.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 30_000 });

  // Step 5: Alice creates the group.
  await alicePage.getByTestId('create-group-btn').click();
  await expect(alicePage.getByTestId('create-group-modal-content')).toBeVisible();
  await alicePage.getByTestId('create-group-name-input').fill(groupName);
  await alicePage.getByTestId('create-group-submit-btn').click();
  await expect(alicePage.getByText(groupName)).toBeVisible({ timeout: 30_000 });
  await expect(alicePage.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
  await dismissErrorOverlay(alicePage);
  // Give the group state time to stabilise before inviting.
  await alicePage.waitForTimeout(3_000);

  // Step 6: Open the group detail and invite Bob.
  await alicePage.locator('[data-testid^="group-card-"]', { hasText: groupName }).click();
  await expect(alicePage.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

  await alicePage.getByTestId('invite-member-btn').click();
  await expect(alicePage.getByTestId('invite-member-modal-content')).toBeVisible();
  await alicePage.getByTestId('invite-npub-input').fill(inviteeNpub);
  await alicePage.getByTestId('invite-submit-btn').click();

  // Step 7: Wait for invite-success before timing relay delivery.
  await expect(alicePage.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });
  await dismissErrorOverlay(alicePage);

  // Step 8: Give the relay a few seconds to deliver Alice's fresh gift wrap to
  // Bob's already-running subscription. The eventId is NOT in the seen-set so
  // it will be enqueued as the only pending invitation.
  await bobPage.waitForTimeout(5_000);

  // Step 9: Bob is already on /groups/ — wait for the pending invitations section.
  // Under pull-only invitations (Walled Garden v2), Bob must explicitly Accept
  // the pending invitation before the group appears in his list.
  await expect(bobPage.getByTestId('pending-invitations-section')).toBeVisible({ timeout: 30_000 });

  // Step 10: Accept the first (and only) pending invitation.
  // The queue contains exactly one entry — Alice's fresh invite — because stale
  // eventIds were cleared above and the seen-set prevented their re-enqueue.
  await bobPage.locator('[data-testid^="accept-invitation-"]').first().click();

  await expect(bobPage.getByText(groupName)).toBeVisible({ timeout: 90_000 });

  // Decode inviteeNpub to hex so the IDB poll can compare memberPubkeys
  // (IDB stores hex pubkeys, not bech32).
  const inviteeHex = inviteeNpub.startsWith('npub')
    ? (nip19.decode(inviteeNpub).data as string)
    : inviteeNpub;

  // Wait for Alice's MarmotContext to have persisted the invitee into memberPubkeys.
  // Groups are stored in IndexedDB ('few-groups-meta' / 'groups').
  // The gate in DirectMessageNotificationsWatcher reads groupsRef.current which
  // is only accurate once MarmotContext has called setGroups with the updated
  // memberPubkeys — i.e. after reloadGroups() completes following Welcome processing.
  // Polling IDB directly gives us the ground-truth signal that the Welcome ratchet
  // has been processed and persisted on Alice's side.
  await alicePage.waitForFunction(
    (inviteePubHex: string) => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('few-groups-meta');
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
