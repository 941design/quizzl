/**
 * E2E: DM third-party bare-plaintext inbound (story-01, AC-12)
 *
 * Publishes a kind-4 NIP-04 event with BARE PLAINTEXT content (no JSON envelope)
 * from Bob to Alice, encrypted with their shared NIP-04 key. Asserts:
 *   1. Alice's bell badge becomes 1.
 *   2. Opening the DM chat with Bob renders the message bubble with the plaintext.
 *
 * This exercises the full relay → NDK subscription → bell watcher → bell badge
 * → ContactChat ingest → IDB → chat bubble pipeline without injecting via
 * __quizzlUnread (which is what notification-bell.spec.ts does).
 *
 * Uses deterministic alice/bob keypairs from helpers/auth-helpers.ts.
 */

import { test, expect, type Page } from '@playwright/test';
import { USER_A, USER_B, injectIdentity, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';

// Shared between test and publish helper — must stay in sync with USER_A/USER_B.
const RELAY_URL = process.env.E2E_RELAY_URL ?? 'ws://localhost:7777';

test.beforeAll(async () => {
  await computeTestKeypairs();
});

test.afterEach(async ({ page }) => {
  await clearAppState(page);
});

/**
 * Encrypt a plaintext string using NIP-04 (shared symmetric key derived from both keys).
 * Returns the encrypted hex string suitable for a kind-4 event's content field.
 */
async function nip04Encrypt(
  plaintext: string,
  senderPrivHex: string,
  recipientPubHex: string,
): Promise<string> {
  const { getPublicKey } = await import('nostr-tools/pure');
  const { nip04 } = await import('nostr-tools');
  const senderPubHex = getPublicKey(new Uint8Array(Buffer.from(senderPrivHex, 'hex')));
  return nip04.encrypt(senderPrivHex, recipientPubHex, plaintext);
}

/**
 * Compute the kind-4 event id from its fields (same algorithm as NIP-01).
 */
async function computeKind4Id(
  pubkey: string,
  createdAt: number,
  kind: number,
  tags: string[][],
  content: string,
): Promise<string> {
  const { getEventHash } = await import('nostr-tools/pure');
  return getEventHash({ pubkey, created_at: createdAt, kind, tags, content });
}

/**
 * Publish a hand-crafted kind-4 NIP-04 event directly to the relay WebSocket.
 * Returns the event id.
 */
async function publishKind4ToRelay(
  page: Page,
  senderPrivHex: string,
  senderPubHex: string,
  recipientPubHex: string,
  plaintext: string,
): Promise<{ eventId: string; content: string }> {
  const encrypted = await nip04Encrypt(plaintext, senderPrivHex, recipientPubHex);
  const createdAt = Math.floor(Date.now() / 1000);
  const eventId = await computeKind4Id(senderPubHex, createdAt, 4, [['p', recipientPubHex]], encrypted);

  // Sign the event — for NIP-04 kind-4, sig is a schnorr signature over the event id.
  // We use nostr-tools to sign it properly.
  const { getSignature } = await import('nostr-tools/pure');
  const sig = getSignature({ pubkey: senderPubHex, created_at: createdAt, kind: 4, tags: [['p', recipientPubHex]], content: encrypted }, new Uint8Array(Buffer.from(senderPrivHex, 'hex')));

  const event = {
    id: eventId,
    pubkey: senderPubHex,
    created_at: createdAt,
    kind: 4,
    tags: [['p', recipientPubHex]],
    content: encrypted,
    sig,
  };

  // Publish to relay via WebSocket
  await page.evaluate(
    ({ relayUrl, eventJson }) =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(relayUrl);
        ws.onopen = () => {
          ws.send(JSON.stringify(['EVENT', eventJson]));
          // Wait briefly for relay to process, then close
          setTimeout(() => { ws.close(); resolve(); }, 500);
        };
        ws.onerror = () => reject(new Error('WebSocket error publishing kind-4 event'));
      }),
    { relayUrl: RELAY_URL, eventJson: event },
  );

  return { eventId, content: plaintext };
}

test('alice receives a bare-plaintext kind-4 from bob; bell rings and chat bubble renders plaintext (AC-12)', async ({ browser }) => {
  const alicePage = await browser.newPage();
  const alicePriv = USER_A.privateKeyHex;
  const alicePub = USER_A.pubkeyHex;
  const bobPriv = USER_B.privateKeyHex;
  const bobPub = USER_B.pubkeyHex;

  try {
    // 1. Alice signs in
    await alicePage.goto('/');
    await injectIdentity(alicePage, USER_A);
    await alicePage.reload();

    // 2. Alice opens /contacts so the bell watcher is mounted
    await alicePage.goto('/contacts');
    await alicePage.waitForLoadState('networkidle');

    // 3. Bob publishes a bare-plaintext kind-4 to Alice
    const plaintext = 'hello from third-party client';
    await publishKind4ToRelay(alicePage, bobPriv, bobPub, alicePub, plaintext);

    // 4. Wait for bell badge to become 1
    await alicePage.waitForFunction(
      () => {
        // Bell badge lives in the notification bell element — check the DOM.
        const badge = document.querySelector('[data-testid="dm-bell-badge"], .dm-badge, [aria-label*="message"]');
        if (!badge) return false;
        const count = parseInt(badge.textContent ?? badge.getAttribute('data-count') ?? '0', 10);
        return count >= 1;
      },
      { timeout: 10_000 },
    );

    // 5. Click the bell to open the DM dropdown, find Bob, click into the chat
    // The bell button lives at the top of the contacts page.
    const bellButton = alicePage.getByRole('button', { name: /messages?|direct/i }).first();
    await bellButton.click();
    // Wait for the unread DM list to appear
    const dmList = alicePage.getByRole('list', { name: /unread/i }).first();

    // Click Bob's row
    const bobRow = dmList.getByText(/bob/i, { exact: false }).first();
    await bobRow.click();

    // 6. Assert the message bubble renders the plaintext
    await alicePage.waitForLoadState('networkidle');
    const bubbles = alicePage.locator('[data-testid="message-bubble"], .message-bubble').first();
    await expect(bubbles).toBeVisible();
    await expect(bubbles).toContainText(plaintext);
  } finally {
    await alicePage.close();
  }
});
