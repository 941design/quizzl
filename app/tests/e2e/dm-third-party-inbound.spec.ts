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

import { test, expect } from '@playwright/test';
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
 * Publish a hand-crafted kind-4 NIP-04 event directly to the relay WebSocket.
 * Returns the event id.
 */
async function publishKind4ToRelay(
  senderPrivHex: string,
  recipientPubHex: string,
  plaintext: string,
): Promise<{ eventId: string; content: string }> {
  const encrypted = await nip04Encrypt(plaintext, senderPrivHex, recipientPubHex);
  const createdAt = Math.floor(Date.now() / 1000);

  const { finalizeEvent } = await import('nostr-tools/pure');
  const signed = finalizeEvent(
    {
      kind: 4,
      created_at: createdAt,
      tags: [['p', recipientPubHex]],
      content: encrypted,
    },
    new Uint8Array(Buffer.from(senderPrivHex, 'hex')),
  );

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error('Timed out publishing kind-4 to relay'));
    }, 10_000);
    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', signed]));
      setTimeout(() => {
        clearTimeout(timeout);
        try { ws.close(); } catch { /* ignore */ }
        resolve();
      }, 500);
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error publishing to ${RELAY_URL}`));
    };
  });

  return { eventId: signed.id, content: plaintext };
}

test('alice receives a bare-plaintext kind-4 from bob; bell rings and chat bubble renders plaintext (AC-12)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const alicePage = await ctx.newPage();
  const bobPriv = USER_B.privateKeyHex;
  const bobPub = USER_B.pubkeyHex;
  const alicePub = USER_A.pubkeyHex;

  try {
    // 1. Alice signs in and gets Bob seeded as a contact so the chat view loads.
    await alicePage.goto('/');
    await injectIdentity(alicePage, USER_A);
    const now = new Date().toISOString();
    await alicePage.evaluate(
      ({ peerPubkeyHex, ts }) => {
        localStorage.setItem('lp_contacts_v1', JSON.stringify({
          [peerPubkeyHex]: { pubkeyHex: peerPubkeyHex, firstSeenAt: ts, lastSeenAt: ts, archivedAt: null },
        }));
      },
      { peerPubkeyHex: bobPub, ts: now },
    );
    await alicePage.reload();

    // 2. Alice opens /contacts so the bell watcher is mounted
    await alicePage.goto('/contacts');
    await alicePage.waitForLoadState('networkidle');

    // 3. Bob publishes a bare-plaintext kind-4 to Alice
    const plaintext = 'hello from third-party client';
    await publishKind4ToRelay(bobPriv, alicePub, plaintext);

    // 4. Wait for the notification badge to appear (>= 1).
    await alicePage.waitForFunction(
      () => {
        const badge = document.querySelector('[data-testid="notification-badge"]');
        if (!badge) return false;
        const count = parseInt((badge.textContent ?? '0').trim(), 10);
        return count >= 1;
      },
      null,
      { timeout: 15_000 },
    );

    // 5. Click the visible bell to open the dropdown, then click Bob's row.
    await alicePage.getByTestId('notification-bell').filter({ visible: true }).first().click();
    await alicePage.getByTestId(`notification-dm-${bobPub}`).filter({ visible: true }).first().click();

    // 6. The chat opens — assert a message bubble renders the plaintext.
    await alicePage.waitForURL(/\/contacts\/?\?id=/, { timeout: 10_000 });
    const bubble = alicePage.locator('[data-testid^="msg-"]').filter({ hasText: plaintext }).first();
    await expect(bubble).toBeVisible({ timeout: 15_000 });
  } finally {
    await ctx.close();
  }
});
