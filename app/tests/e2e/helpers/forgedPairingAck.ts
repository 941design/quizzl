/**
 * forgedPairingAck.ts — THE ONE documented exception to CLAUDE.md's e2e rule
 * "publish through the app, never raw WebSocket" (epic: contact-pairing-code,
 * story S6). Used by exactly one spec: dm-pairing-sender-binding.spec.ts.
 *
 * WHY this exception is narrow and necessary (mirrors CLAUDE.md's own
 * carve-out: "events the app cannot itself produce ... prefer a fixture
 * loader over inline WebSocket, and call it out"):
 *
 * AC-SEC-1/AC-PAIR-6b (sender binding) can only be proven by constructing a
 * pairing-ack gift wrap whose enclosed `card` field names a DIFFERENT pubkey
 * than the gift wrap's own authenticated sender. The app's real send path
 * (pairingAck.ts#sendPairingAck) ALWAYS signs and encloses the CALLER's own
 * identity card — there is no button, form, or code path that lets a real
 * user ask the app to send someone else's card instead of their own. That
 * makes this exact input structurally unproducible through the UI: the app
 * cannot itself be coerced into sending it.
 *
 * WHAT stays real, and what is spoofed: `sendForgedPairingAck` builds the
 * wire event with nostr-tools/nip59's OWN `createRumor`/`wrapEvent` — the
 * exact library pairingAck.ts#sendPairingAck itself calls — so the output is
 * byte-shape-identical to what a genuine client would produce. `wrapEvent`
 * derives `rumor.pubkey` and the seal's signature from `attackerPrivateKeyHex`
 * for real (real schnorr signature, real key) — the gift wrap's authenticated
 * sender genuinely IS the attacker's own real identity, not spoofed. The ONLY
 * adversarial element is the `card` field's VALUE: the caller supplies a
 * harvested THIRD PARTY's card, itself obtained earlier in the same spec via
 * the app's real Share action (never hand-crafted bytes) — modeling "the
 * attacker got hold of a validly-signed card belonging to someone else" (by
 * any real-world means: a screenshot, a forwarded link, a previous share)
 * and is now trying to replay it while authenticating as themselves.
 *
 * DELIVERY: a single raw WebSocket `["EVENT", …]` publish, executed inside
 * `page.evaluate` on the attacker's own real browser page. This reuses
 * helpers/relay-query.ts's already-established raw-WebSocket-inside-
 * page.evaluate pattern (there for reads/queries; here for one write) rather
 * than inventing a new mechanism — and, per CLAUDE.md's guidance, is
 * encapsulated in this one fixture module rather than inlined in the spec
 * body. No other spec file added by this story ever constructs or publishes
 * a signed event outside the app.
 */
import type { Page } from '@playwright/test';

const RELAY_URL = process.env.E2E_RELAY_URL ?? 'ws://localhost:7777';

/**
 * Fixed, non-zero rumor kind for a pairing-ack (RD-6). Mirrors
 * pairingAck.ts's `PAIRING_ACK_KIND` — duplicated here (not imported, per
 * this story's test/production import boundary) as a plain numeric literal,
 * the same way every other e2e spec/helper in this repo references kind
 * numbers (e.g. relay-query.ts's raw NostrEvent filters) without importing
 * app/src/lib/pairing/pairingAck.ts.
 */
const PAIRING_ACK_KIND = 21060;

export type ForgedPairingAckParams = {
  /** The attacker's own REAL private key hex — the gift wrap is genuinely, validly signed by this identity. */
  attackerPrivateKeyHex: string;
  /** The attacker's own REAL pubkey hex (derived from attackerPrivateKeyHex) — what `rumor.pubkey`/`seal.pubkey` will authenticate as. */
  attackerPubkeyHex: string;
  /** The issuer (victim) the forged ack is addressed to. */
  issuerPubkeyHex: string;
  /** A nonce the issuer actually issued and still admits (so the ONLY thing that can reject this ack is the sender-binding check, isolating exactly what AC-SEC-1 tests). */
  echoedNonceHex: string;
  /** A harvested THIRD PARTY's genuinely-signed card payload (base64url) — obtained via the app's real Share action for a DIFFERENT identity than the attacker's own. */
  harvestedCardB64Url: string;
};

/**
 * Build (in this Node test process, via nostr-tools/nip59 directly — the
 * same library the app bundles) and publish (via the attacker's own real
 * browser page, raw WebSocket) a pairing-ack gift wrap whose authenticated
 * sender is the attacker's real identity but whose enclosed `card` names a
 * different (harvested) pubkey. See file header for the full rationale.
 */
export async function sendForgedPairingAck(page: Page, params: ForgedPairingAckParams): Promise<void> {
  const { createRumor, wrapEvent } = await import('nostr-tools/nip59');

  const attackerPrivBytes = hexToBytes(params.attackerPrivateKeyHex);

  const content = JSON.stringify({
    type: 'pairing-ack',
    nonce: params.echoedNonceHex,
    card: params.harvestedCardB64Url,
  });

  // wrapEvent(event, senderPrivateKey, recipientPublicKey) internally calls
  // createRumor (sets rumor.pubkey from senderPrivateKey, i.e. the
  // attacker's own real key) then createSeal (signs the seal with the SAME
  // real key) then createWrap (fresh ephemeral outer key, addressed to
  // recipientPublicKey) — exactly directMessages.ts#sealAndWrap's own
  // wrapEvent call, just invoked directly here instead of through the app.
  const wrap = wrapEvent(
    {
      kind: PAIRING_ACK_KIND,
      content,
      tags: [['p', params.issuerPubkeyHex]],
      created_at: Math.floor(Date.now() / 1000),
    },
    attackerPrivBytes,
    params.issuerPubkeyHex,
  );

  // Sanity self-check: createRumor must have derived rumor.pubkey from the
  // attacker's OWN key, not accidentally from anything caller-supplied —
  // this fixture must never be able to forge the AUTHENTICATED sender
  // identity, only the enclosed card's claimed identity.
  const { getPublicKey } = await import('nostr-tools/pure');
  const derivedAttackerPubkey = getPublicKey(attackerPrivBytes);
  if (derivedAttackerPubkey.toLowerCase() !== params.attackerPubkeyHex.toLowerCase()) {
    throw new Error(
      '[forgedPairingAck] attackerPubkeyHex does not match the pubkey derived from attackerPrivateKeyHex — refusing to publish a mismatched fixture',
    );
  }

  await page.evaluate(
    ({ relayUrl, event }) => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(relayUrl);
        let settled = false;
        const done = (err?: Error) => {
          if (settled) return;
          settled = true;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          if (err) reject(err);
          else resolve();
        };
        const timeout = setTimeout(() => done(), 8_000); // resolve even without an explicit OK — the relay round trip is verified by the spec's own downstream polling
        ws.onopen = () => {
          ws.send(JSON.stringify(['EVENT', event]));
        };
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data as string);
            if (data[0] === 'OK' && data[1] === event.id) {
              clearTimeout(timeout);
              done();
            }
          } catch {
            /* ignore parse errors */
          }
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          done(new Error('[forgedPairingAck] relay publish WebSocket error'));
        };
      });
    },
    { relayUrl: RELAY_URL, event: wrap },
  );
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
