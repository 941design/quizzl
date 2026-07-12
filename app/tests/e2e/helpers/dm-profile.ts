/**
 * Shared helpers for the direct-contact-profile-exchange epic's relay-bucket
 * e2e specs (dm-profile-*.spec.ts). Epic: direct-contact-profile-exchange,
 * story S08.
 *
 * Every helper here either (a) reads state the app itself already writes
 * (`lp_contactCache_v1` / `lp_contacts_v1` localStorage, both plain JSON
 * maps — `contactCache.ts` / `contacts.ts`), or (b) seeds a SENDER's OWN
 * local state so the app's real internal machinery (`ProfileHealWatcher`'s
 * due-sweep, `profile.tsx`'s `broadcastProfile` fan-out) constructs, signs,
 * and gift-wrap-publishes a genuine wire event — never a hand-forged byte,
 * never a raw WebSocket publish. This mirrors `helpers/pairing.ts`'s
 * established idb/localStorage-seed convention.
 *
 * `seedLocalContact` is the one helper that seeds a *sender's* belief about
 * a contact without going through real pairing — used only by the stranger-
 * gate specs to make the STRANGER's own app decide to send something for
 * real, never to touch the TARGET's state (the whole point of testing that
 * the target's own gate rejects a sender it never actually added).
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const CONTACT_CACHE_KEY = 'lp_contactCache_v1';
const CONTACTS_KEY = 'lp_contacts_v1';

export type CachedContactEntry = {
  nickname: string;
  avatar: { imageUrl: string } | null;
  updatedAt: string;
};

/** Read one peer's `contactCache.ts` entry (`lp_contactCache_v1`) directly from localStorage. `null` if absent. */
export async function readContactCacheEntry(page: Page, peerPubkeyHex: string): Promise<CachedContactEntry | null> {
  return page.evaluate((peer) => {
    try {
      const raw = localStorage.getItem('lp_contactCache_v1');
      if (!raw) return null;
      const cache = JSON.parse(raw) as Record<string, CachedContactEntry>;
      return cache[peer.toLowerCase()] ?? null;
    } catch {
      return null;
    }
  }, peerPubkeyHex);
}

/**
 * Delete a single peer's `contactCache.ts` entry, simulating "the profile
 * was never received / the cache was lost" WITHOUT touching `lp_contacts_v1`
 * — the contact record itself (mutual, active, non-archived) is untouched,
 * only the cached name/avatar is cleared. Used by the self-heal anchor
 * (AC-PROF-7) to set up a genuine "avatar absent" precondition on top of a
 * real pairing, rather than relying on a re-add/re-scan (which AC-PROF-7
 * explicitly forbids).
 */
export async function clearContactCacheEntry(page: Page, peerPubkeyHex: string): Promise<void> {
  await page.evaluate((peer) => {
    try {
      const raw = localStorage.getItem('lp_contactCache_v1');
      if (!raw) return;
      const cache = JSON.parse(raw) as Record<string, unknown>;
      delete cache[peer.toLowerCase()];
      localStorage.setItem('lp_contactCache_v1', JSON.stringify(cache));
    } catch {
      // no-op — nothing cached yet is an already-cleared state
    }
  }, peerPubkeyHex);
}

/**
 * Seed a one-directional local contact belief — `lp_contacts_v1`'s
 * `StoredContact` shape (`contacts.ts`), active/non-archived — directly into
 * THIS page's own localStorage, without any real pairing/admission having
 * happened.
 *
 * Used ONLY by the stranger-gate specs, and ONLY on the sender/stranger's own
 * page — never on the target's. It makes the sender's own app genuinely
 * believe it has a contact to heal/announce to, so `ProfileHealWatcher`'s due
 * -sweep or `profile.tsx`'s `broadcastProfile` fan-out constructs and
 * publishes a REAL wire event addressed to the target. The target's own
 * `isAllowedDmSender` / `lp_contacts_v1` gate is never touched by this
 * function, so it genuinely (not by any target-side test tamper) has no
 * record of the sender — the exact "stranger" precondition AC-PROF-3/4
 * require.
 */
export async function seedLocalContact(page: Page, peerPubkeyHex: string): Promise<void> {
  await page.evaluate((peer) => {
    const key = peer.toLowerCase();
    let contacts: Record<string, unknown> = {};
    try {
      const raw = localStorage.getItem('lp_contacts_v1');
      contacts = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      contacts = {};
    }
    const now = new Date().toISOString();
    contacts[key] = {
      pubkeyHex: key,
      firstSeenAt: now,
      lastSeenAt: now,
      archivedAt: null,
    };
    localStorage.setItem('lp_contacts_v1', JSON.stringify(contacts));
  }, peerPubkeyHex);
}

/** Read the raw `lp_contacts_v1` pubkey set (mirrors `helpers/pairing.ts#readContactPubkeys`, kept local so this module has no cross-helper coupling beyond Playwright's own `Page` type). */
export async function readContactsListPubkeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('lp_contacts_v1');
      return raw ? Object.keys(JSON.parse(raw) as Record<string, unknown>) : [];
    } catch {
      return [];
    }
  });
}

/**
 * Poll the RAW `contactCache.ts` state (never the rendered DOM — a
 * contactCache write from the announce-receive path does not itself bump
 * `contacts.tsx`'s `contactsRevision`, so a mounted contacts-list page does
 * not re-render on its own; polling the backing store directly is the
 * genuinely live-updating signal, mirroring `helpers/pairing.ts
 * #waitForAdmission`'s precedent) until `peerPubkeyHex`'s cached nickname
 * equals `expectedName` and its avatar is non-null, or `timeoutMs` elapses.
 */
export async function waitForCompleteProfile(
  page: Page,
  peerPubkeyHex: string,
  expectedName: string,
  timeoutMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = await readContactCacheEntry(page, peerPubkeyHex);
    if (entry && entry.nickname === expectedName && entry.avatar != null) {
      return true;
    }
    await page.waitForTimeout(1_000);
  }
  return false;
}

/**
 * Combined convergence check for the self-heal / push-trigger specs:
 * waits for the raw `contactCache.ts` state to converge (see
 * {@link waitForCompleteProfile}), then navigates to `/contacts` (a fresh
 * mount, since the page does not re-render live on a contactCache write) and
 * asserts the RENDERED contact card actually shows the name and a real
 * avatar image — a rendered-readiness assertion, never a fixed
 * `waitForTimeout` in place of a real signal.
 */
export async function assertContactConverged(
  page: Page,
  peerPubkeyHex: string,
  expectedName: string,
  timeoutMs = 60_000,
): Promise<void> {
  const converged = await waitForCompleteProfile(page, peerPubkeyHex, expectedName, timeoutMs);
  expect(converged, `contactCache never converged to {name: ${expectedName}, avatar} for ${peerPubkeyHex}`).toBe(true);

  await page.goto('/contacts');
  const card = page.getByTestId(`contact-card-${peerPubkeyHex}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId('profile-display-name')).toHaveText(expectedName, { timeout: 15_000 });
  await expect(card.getByTestId('profile-avatar-thumb').locator('img')).toBeVisible({ timeout: 15_000 });
}
