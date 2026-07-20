/**
 * Shared helpers for the contact-pairing-code epic's relay-bucket e2e specs
 * (dm-pairing-*.spec.ts). Epic: contact-pairing-code, story S6.
 *
 * Everything here either (a) reads state the app itself already writes
 * (localStorage/IDB), or (b) reads a fixed-offset field off a PUBLIC wire
 * format the app's own share/scan UI already produced for real (never bytes
 * this module signs or forges) — no file in this module ever imports an
 * app/src/** production module. That boundary is deliberate: every real app
 * behavior in these specs is driven through actual page navigation and UI
 * actions (getShareCardLink, /add#c=… navigation, chat-input/chat-send-btn),
 * matching every other e2e helper in this repo. The one place this epic's
 * specs step outside "drive the app" is the sender-binding attack, isolated
 * in the separate, explicitly-labeled helpers/forgedPairingAck.ts.
 */
import type { Page } from '@playwright/test';
import { writeIdbRecord } from './idb-record';

// ── Public wire-format field extraction (no crypto, no decode/verify) ──────

/**
 * Pure byte-offset read of a v2 pairing card's `nonce`(16 bytes)/
 * `expires_at`(4 bytes BE) fields directly off its base64url payload —
 * contactCard.ts's documented, stable wire layout:
 *   header(1) + pubkey(32) + created_at(4) + expires_at(4) + nonce(16) + …
 * so expires_at sits at byte offset 37..41 and nonce at 41..57.
 *
 * This is NOT a reimplementation of decodeCard's decision logic (no
 * signature verification, no strict-parser rejection rules) — it exists
 * only so a test can learn a real issuer's live nonce/expiry from a card the
 * app itself genuinely produced (via getShareCardLink), without crossing
 * the test/production import boundary. Returns null for a payload whose
 * header version bits aren't v2 (`01`) or that's too short to hold the
 * fixed v2 header.
 */
export function extractV2PairingFields(cardB64Url: string): { nonceHex: string; expiresAt: number } | null {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(cardB64Url, 'base64url');
  } catch {
    return null;
  }
  if (bytes.length < 57) return null;
  const header = bytes[0];
  const version = (header >> 6) & 0x03;
  if (version !== 1) return null; // not a v2 (pairing) card
  const expiresAt = bytes.readUInt32BE(37);
  const nonceHex = bytes.subarray(41, 57).toString('hex');
  return { nonceHex, expiresAt };
}

// ── Admission-state reads (pure localStorage, matches knownPeers.ts/contacts.ts) ──

/**
 * Read the app's admitted-peer set — `lp_knownPeers_v1`, a pure
 * localStorage JSON array of lowercase hex pubkeys (knownPeers.ts). This is
 * the precise, storage-level "was X admitted" signal: `MarmotContext`'s
 * `onPairingAckReceived` callback updates this storage for real on
 * admission but does NOT bump the contacts-list UI's own re-render trigger
 * — so a passing DOM assertion on the contacts list is not a reliable
 * admission signal without an explicit reload, while this read is.
 */
export async function readKnownPeers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('lp_knownPeers_v1');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
}

/** Read the app's persisted contacts map keys — `lp_contacts_v1` (contacts.ts / STORAGE_KEYS.contacts). */
export async function readContactPubkeys(page: Page): Promise<string[]> {
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
 * Poll `readKnownPeers`/`readContactPubkeys` until `peerHex` (lowercase)
 * appears or `timeoutMs` elapses. Thin wrapper so specs don't hand-roll their
 * own polling loop for the single most common assertion in this file.
 */
export async function waitForAdmission(page: Page, peerHex: string, timeoutMs = 60_000): Promise<boolean> {
  const target = peerHex.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [knownPeers, contacts] = await Promise.all([readKnownPeers(page), readContactPubkeys(page)]);
    if (knownPeers.includes(target) && contacts.map((h) => h.toLowerCase()).includes(target)) {
      return true;
    }
    await page.waitForTimeout(1_000);
  }
  return false;
}

// ── Direct-IDB-write state injection (never a forged relay publish) ────────

/**
 * Seed a pending pairing intent directly into the scanner-side
 * `few-pairing-intents`/`intents` idb-keyval store (pendingIntent.ts's
 * `PendingPairingIntent` shape, keyed by `issuerPubkey`). Mirrors
 * dm-self-heal.spec.ts's `seedMalformedRow` precedent: this tampers local
 * state only — the app's OWN real `drainPendingIntents` code then reads this
 * record and, if a name is set, genuinely signs and gift-wrap-sends a real
 * pairing-ack for it. No event is ever forged or hand-published here.
 */
export async function seedPendingIntent(
  page: Page,
  intent: { issuerPubkey: string; nonce: string; expiresAt: number },
): Promise<void> {
  await writeIdbRecord(page, 'few-pairing-intents', 'intents', intent.issuerPubkey, intent);
}

/**
 * Overwrite an issuer's own persisted nonce record directly in the
 * `few-pairing-nonces`/`nonces` idb-keyval store (nonceStore.ts's
 * `StoredNonce` shape, keyed by the nonce's own hex value). Used to
 * simulate "this nonce has aged out of the 2h grace window" without waiting
 * 2.5 real hours — the app's own real `isNonceAdmissible` then reads this
 * tampered record when a genuine (unmodified) echo for that nonce arrives.
 */
export async function seedIssuerNonce(page: Page, record: { nonce: string; expiresAt: number }): Promise<void> {
  await writeIdbRecord(page, 'few-pairing-nonces', 'nonces', record.nonce, record);
}

/** Dispatch a synthetic `online` event so PendingPairingIntentWatcher's already-registered listener re-drains without a full page reload. */
export async function dispatchOnlineEvent(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}
