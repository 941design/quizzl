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

/** Decode a bech32 npub to its hex pubkey. */
function npubToHex(npub: string): string {
  return npub.startsWith('npub') ? (nip19.decode(npub).data as string) : npub;
}

/**
 * Drive the app's REAL add-contact path (epic: invite-group-member-from-
 * contacts, S3 — AC-E2E-1/AC-E2E-2/AC-E2E-3) so a contact seeded this way is
 * indistinguishable from one a user added by hand: `page.goto('/add#c=' +
 * npub)`, the exact bare-npub payload `parseContactCard` accepts
 * (contactCard.ts's npub-branch), which drives `resolveAddDeepLink` ->
 * `processContactInput` -> `addContactByNpub` and lands on
 * `/contacts?id=<hex>&added=1`.
 *
 * Idempotent by design: re-seeding an npub that is already a contact lands on
 * `add.tsx`'s `already_exists` error branch (`add-page-error`) instead of the
 * success redirect (`contact-added-success`) — both outcomes mean the
 * contact is present in `page`'s contact list afterward, so both are treated
 * as success here. This lets `inviteContactViaPicker` be called more than
 * once for the same invitee (AC-E2E-8's re-invite) without a special case.
 *
 * This is the ONLY function in the e2e suite that may navigate to `/add#c=`
 * — every spec that needs a seeded contact goes through this helper (or
 * `inviteContactViaPicker`, which calls it), rather than duplicating the
 * navigation inline. No production code is bypassed: this is the same
 * `page.goto` a real user's deep-link tap would trigger.
 */
export async function seedContact(page: Page, npub: string): Promise<void> {
  await page.goto('/add#c=' + npub);
  await expect(
    page.getByTestId('contact-added-success').or(page.getByTestId('add-page-error')),
  ).toBeVisible({ timeout: 30_000 });
  await dismissErrorOverlay(page);
}

/**
 * The shared "ensure the invitee is a contact, then invite via the picker"
 * helper (epic: invite-group-member-from-contacts, S3 — AC-E2E-1). Replaces
 * every e2e spec's former direct fill of the now-removed npub free-text
 * input, now that `InviteMemberModal` only exposes a contact picker
 * (a scrollable list of clickable rows, `invite-contact-list`).
 *
 * Precondition: `inviterPage` is currently ON the target group's detail page
 * (`group-detail-page` visible, i.e. at `/groups?id=<groupId>`), with the
 * invite modal NOT open yet — this helper opens it itself. `inviteeNpub` is
 * a bech32 npub (not hex).
 *
 * Steps: (1) seed the invitee as a contact via `seedContact` — this
 * navigates the page away to `/add` and on to `/contacts`; (2) navigate back
 * to the group-detail URL captured before step 1; (3) open
 * `InviteMemberModal` and wait for the seeded contact's row to be attached
 * to `invite-contact-list` before interacting with it (never clicks into a
 * stale/empty picker); (4) click the row and click `invite-submit-btn`.
 *
 * Deliberately does NOT assert the outcome (`invite-success` / `invite-
 * error`) — that stays the caller's responsibility, exactly as it already
 * varies per spec (a 60s success wait in the happy-path specs, an
 * `invite-error` assertion in the KeyPackage-less error case).
 */
export async function inviteContactViaPicker(inviterPage: Page, inviteeNpub: string): Promise<void> {
  const groupDetailUrl = inviterPage.url();
  const inviteeHex = npubToHex(inviteeNpub);

  await seedContact(inviterPage, inviteeNpub);

  // Seeding navigated away from the group detail page — return to it and
  // re-open the invite modal.
  await inviterPage.goto(groupDetailUrl);
  await expect(inviterPage.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
  await dismissErrorOverlay(inviterPage);

  await inviterPage.getByTestId('invite-member-btn').click();
  await expect(inviterPage.getByTestId('invite-member-modal-content')).toBeVisible();

  const list = inviterPage.getByTestId('invite-contact-list');
  await expect(list).toBeVisible({ timeout: 10_000 });
  // Wait for the just-seeded contact's row to actually be present before
  // clicking it — avoids racing listContacts()'s localStorage read against
  // a stale render (VQ-S3-006).
  const row = inviterPage.getByTestId(`invite-contact-row-${inviteeHex}`);
  await expect(row).toBeAttached({ timeout: 30_000 });
  await row.click();
  await inviterPage.getByTestId('invite-submit-btn').click();
}

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

  // Step 6: Open the group detail and invite Bob — seeded as a contact via
  // the production add-contact path, then invited through the picker
  // (epic: invite-group-member-from-contacts, S3).
  await alicePage.locator('[data-testid^="group-card-"]', { hasText: groupName }).click();
  await expect(alicePage.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

  await inviteContactViaPicker(alicePage, inviteeNpub);

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
