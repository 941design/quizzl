/**
 * outboundJoinRequests.ts — Outbound join-request record store (S4,
 * epic: group-invite-link-onboarding).
 *
 * IndexedDB-backed record of join requests THIS device has sent, keyed by
 * nonce, using idb-keyval — mirrors joinRequestStorage.ts / inviteLinkStorage.ts
 * conventions.
 *
 * Written only on a SUCCESSFUL `sendJoinRequest` (joinRequestSender.ts) — a
 * failed send writes nothing (AC-AUTO-1). Consulted by welcomeSubscription.ts
 * to correlate an inbound Welcome's AUTHENTICATED sender against an admin
 * this device requested to join, for auto-accept.
 *
 * Correlation is by `adminPubkeyHex` ONLY. The `nonce` never reaches the
 * Welcome (it lives solely in the join-request rumor, a separate message —
 * see DD-3 / AC-AUTO-4) and MUST NOT be used as a Welcome-side correlation
 * key; it remains the record's storage key purely for identity/lookup
 * purposes on the sender's own device.
 */

import { createStore, set, del, entries, clear } from 'idb-keyval';

export interface OutboundJoinRequestRecord {
  /** Hex nonce from the invite link — primary key (idb-keyval key), never
   *  read back from an inbound Welcome. */
  nonce: string;
  /** The admin's pubkey (hex) this device sent the join request to. The
   *  ONLY field correlation reads (against the Welcome's authenticated
   *  sender pubkey). */
  adminPubkeyHex: string;
  /** The group name from the invite link, used to disambiguate when this
   *  admin has more than one unexpired record (AC-AUTO-4a). */
  groupName: string;
  /** Date.now() at send time. */
  sentAt: number;
}

// ---------------------------------------------------------------------------
// IDB store
// ---------------------------------------------------------------------------

const outboundJoinRequestStore = createStore('few-outbound-join-requests', 'requests');

export function createOutboundJoinRequestStore() {
  return outboundJoinRequestStore;
}

// ---------------------------------------------------------------------------
// Bounds (AC-AUTO-6)
// ---------------------------------------------------------------------------

/** Global cap on total stored records, consistent with the existing
 *  pending-invitation cap (epic-walled-garden-v2 AC-INVITE-3). */
export const OUTBOUND_JOIN_REQUEST_CAP = 256;

/** Minimum record lifetime: admin approval can legitimately lag by days, so
 *  the TTL floor is generous (>= 7 days, AC-AUTO-6). */
export const OUTBOUND_JOIN_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isExpired(record: OutboundJoinRequestRecord, now: number): boolean {
  return now - record.sentAt >= OUTBOUND_JOIN_REQUEST_TTL_MS;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Persist an outbound join-request record, keyed by nonce.
 *
 * Enforces the global 256-record bound by dropping the single oldest record
 * (by `sentAt`) on overflow — mirroring pendingInvitations.ts's global-cap
 * eviction policy. Never throws: a storage failure here must not surface as
 * a user-visible error on a send that has ALREADY succeeded at the relay
 * layer (AC-AUTO-1 only governs whether a record is written, not whether
 * `sendJoinRequest` itself succeeds).
 */
export async function saveOutboundJoinRequest(record: OutboundJoinRequestRecord): Promise<void> {
  try {
    const all = await entries<string, OutboundJoinRequestRecord>(outboundJoinRequestStore);
    if (all.length >= OUTBOUND_JOIN_REQUEST_CAP) {
      const [oldestKey] = all.reduce((a, b) => (a[1].sentAt < b[1].sentAt ? a : b));
      await del(oldestKey, outboundJoinRequestStore);
    }
    await set(record.nonce, record, outboundJoinRequestStore);
  } catch {
    // Never throw — see doc comment above.
  }
}

/**
 * Returns all UNEXPIRED outbound records whose `adminPubkeyHex` matches.
 *
 * Expired records are treated as absent for correlation purposes (AC-AUTO-6)
 * but are NOT deleted by this read path — eviction happens opportunistically
 * via the write-time cap in `saveOutboundJoinRequest`, or explicitly via
 * `deleteOutboundJoinRequest` after a correlated auto-accept consumes a
 * record.
 */
export async function loadUnexpiredOutboundJoinRequestsForAdmin(
  adminPubkeyHex: string,
): Promise<OutboundJoinRequestRecord[]> {
  const all = await entries<string, OutboundJoinRequestRecord>(outboundJoinRequestStore);
  const now = Date.now();
  return all
    .map(([, record]) => record)
    .filter((record) => record.adminPubkeyHex === adminPubkeyHex && !isExpired(record, now));
}

/**
 * Removes a single outbound record by nonce — the record consumed after a
 * correlated auto-accept (AC-AUTO-5). Other records (including siblings for
 * the same admin) are untouched. Idempotent; never throws.
 */
export async function deleteOutboundJoinRequest(nonce: string): Promise<void> {
  try {
    await del(nonce, outboundJoinRequestStore);
  } catch {
    // Never throw
  }
}

/** Drop every outbound join-request record (account-wide reset). */
export async function clearAllOutboundJoinRequests(): Promise<void> {
  await clear(outboundJoinRequestStore);
}
