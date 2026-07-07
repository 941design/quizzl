/**
 * Wire builders — Seam S2 producer (DeleteEditRumor).
 *
 * Pure, transport-agnostic builders for the three delete/edit signal shapes
 * exchanged inside a DM gift wrap (NIP-59) or an MLS group application rumor.
 * Mirrors app/src/lib/reactions/rumor.ts's e/k reference-tag pattern and its
 * build-once-canonical-id discipline: getEventHash is computed before return,
 * so the optimistic local id equals the eventual published id.
 *
 * Scope (per architecture.md's Wire builders row and this story's contract):
 *   - buildDeleteRumor            — unmarked kind-5 delete (AC-DEL-8, AC-DEL-7 substrate)
 *   - buildEditReplacementRumor   — kind-14/9 replacement, created_at pinned to the
 *                                   ORIGINAL message across the whole edit chain (AC-EDIT-4, AC-EDIT-6)
 *   - buildEditMarkedCompanionKind5 — marked kind-5 companion for non-Few degradation
 *   - clampRev                    — pure per-slot rev-clamp helper (AC-ORDER-5, D16)
 *
 * Explicitly OUT of scope for this module:
 *   - Sealing / gift-wrapping / publishing the built rumor (S4 DM adapter, S5 group adapter)
 *   - Interpreting a received rumor (S3 reconciliation core)
 *
 * Module boundary: imports only nostr-tools/pure and lib/directMessages.ts (type-only).
 * Never imports app/src/context/, app/src/components/, or any persistence/network module.
 *
 * Deviation from the stories.json#seams shorthand (documented in
 * specs/.../S2-wire-builders/architecture.json#deviations_from_frozen_seam_shorthand):
 *   - Each rumor-returning builder takes a trailing `selfPrivKeyHex` parameter.
 *     UnsignedRumor.pubkey is mandatory and getEventHash's canonical serialization
 *     includes it; no other parameter in the shorthand contract supplies it. This
 *     mirrors buildReactionRumor's own selfPrivKeyHex parameter, which both DM and
 *     group callers already pass to a single shared builder today.
 *   - `targetKind` is typed `9 | 14` (the target CHAT message's kind — 14 DM / 9
 *     group), not `5` — `5` in the seam shorthand referred to the signal's own
 *     kind (already fixed via DELETE_EDIT_RUMOR_KIND), not a legal target kind.
 */

import { getPublicKey, getEventHash } from 'nostr-tools/pure';
import type { UnsignedRumor } from '@/src/lib/directMessages';

/** Kind-5 NIP-09-shaped delete/edit-companion signal kind constant. */
export const DELETE_EDIT_RUMOR_KIND = 5;

/**
 * S4 gate-remediation (round-4, finding 8): canonical edit-marker predicate.
 *
 * Mirrors messageEdits/api.ts's classifySignal marker check EXACTLY —
 * `t[0] === 'e'`, `t[1]` a non-empty string, AND `t[3] === 'edit'`. Before this
 * export existed, ContactChat.tsx's dispatch-routing check only tested
 * `t[0]==='e' && t[3]==='edit'` (no `t[1]` validation), so a kind-14 carrying
 * `['e', '', '', 'edit']` (empty target id) was routed to S3's
 * applyDeleteEditSignal, which itself discards it via classifySignal's
 * `t[1]`-non-empty requirement — silently dropping the message instead of
 * falling through to the plain-original ingest path. One canonical marker
 * predicate, consumed by both the dispatch-routing check (ContactChat.tsx,
 * S4) and messageEdits/api.ts's classifySignal (the authoritative
 * classifier), so the two checks can never drift apart again.
 */
export function hasEditMarkerTag(tags: string[][] | null | undefined): boolean {
  return (tags ?? []).some(
    (t) => Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string' && t[1].length > 0 && t[3] === 'edit',
  );
}

/** Legal kinds for the message being deleted/edited: 14 (DM chat) or 9 (group chat). */
type TargetChatKind = 9 | 14;

/**
 * Plausibility ceiling for a Unix-SECONDS timestamp (comfortably past year
 * 5000 in seconds, but well below any millisecond epoch — e.g. `Date.now()`
 * today is ~1.7e12). Used to reject a caller accidentally passing
 * milliseconds (or an unfloored ChatMessage.createdAt) where Unix seconds
 * are required, per this module's own ms-vs-seconds hazard note above.
 */
const MAX_PLAUSIBLE_UNIX_SECONDS = 100_000_000_000;

// ─── Shared validation helpers ─────────────────────────────────────────────

function assertNonEmptyId(id: string, label: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`messageEdits/rumor: ${label} must be a non-empty string`);
  }
}

function assertPriorReplacementIds(ids: string[], fnName: string): void {
  if (!Array.isArray(ids)) {
    throw new Error(`${fnName}: priorReplacementIds must be an array`);
  }
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`${fnName}: priorReplacementIds must contain only non-empty strings`);
    }
  }
}

/**
 * Dedup an e-tag id chain, keeping originalId first and dropping any
 * duplicate between originalId and priorReplacementIds (or within
 * priorReplacementIds itself). Overlapping ids would otherwise yield
 * duplicate ["e", id] tags and change the canonical id for semantically
 * identical input.
 */
function dedupeIdsKeepFirst(originalId: string, priorReplacementIds: string[]): string[] {
  return Array.from(new Set([originalId, ...priorReplacementIds]));
}

function assertTargetKind(targetKind: number, fnName: string): asserts targetKind is TargetChatKind {
  if (targetKind !== 9 && targetKind !== 14) {
    throw new Error(`${fnName}: targetKind must be 14 (DM) or 9 (group), got ${String(targetKind)}`);
  }
}

/**
 * A real delete/edit signal's rev is always an integer Unix-seconds value >= 1
 * (mirrors the S1 storage clobber-guard's "rev >= 1 means a real signal" rule
 * in chatPersistence.ts — a builder must never be able to emit rev < 1).
 * Integer-only: a fractional rev (e.g. an unfloored Date.now()/1000 bypassing
 * clampRev) would otherwise put a fractional created_at / ["rev", "…5"] tag
 * on the wire, both NIP-01 violations. clampRev itself always returns an
 * integer, so this only tightens the direct-rev bypass path.
 */
function assertRealRev(rev: number, fnName: string): void {
  if (!Number.isInteger(rev) || rev < 1) {
    throw new Error(`${fnName}: rev must be an integer >= 1, got ${String(rev)}`);
  }
}

function assertSelfPrivKeyHex(selfPrivKeyHex: string, fnName: string): void {
  if (typeof selfPrivKeyHex !== 'string' || selfPrivKeyHex.length === 0) {
    throw new Error(`${fnName}: selfPrivKeyHex must be a non-empty hex string`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Compute pubkey + canonical NIP-01 id and assemble the final UnsignedRumor.
 * Shared by all three rumor-returning builders below — keeps the
 * build-once-canonical-id discipline (getEventHash before return) in one place.
 */
function finalizeRumor(kind: number, content: string, tags: string[][], created_at: number, selfPrivKeyHex: string): UnsignedRumor {
  const privKeyBytes = hexToBytes(selfPrivKeyHex);
  const pubkey = getPublicKey(privKeyBytes);

  const partial = { kind, content, tags, pubkey, created_at };
  const id = getEventHash(partial);

  return { kind, content, tags, pubkey, created_at, id };
}

// ─── buildDeleteRumor ───────────────────────────────────────────────────────

/**
 * Build an unmarked kind-5 delete rumor.
 *
 * Tags: ["e", originalId], one ["e", priorReplacementId] for every DISTINCT
 * prior replacement id of the slot (AC-DEL-8, so a non-Few NIP-17 client
 * hides all superseded versions), ["k", String(targetKind)]. originalId and
 * priorReplacementIds are deduplicated together (originalId always first) so
 * an overlapping id never produces a duplicate ["e", id] tag or changes the
 * canonical id for semantically identical input.
 *
 * The rumor's own created_at (real Unix seconds) IS its rev — a delete has no
 * separate rev tag, unlike an edit replacement (whose created_at is pinned to
 * the original and therefore cannot double as the clock).
 *
 * MUST NOT carry the ["e", originalId, "", "edit"] marker — a lone unmarked
 * kind-5 is always interpreted as a delete (AC-DEL-7 substrate).
 *
 * @param originalId           Hex id of the slot's original (first) message rumor.
 * @param priorReplacementIds  Ids of every prior edit-replacement rumor for this slot,
 *                              in any order. Empty array when deleting an un-edited message.
 * @param targetKind            Kind of the message being deleted: 14 (DM) or 9 (group).
 * @param rev                   Real Unix-seconds wall-clock value; becomes this rumor's
 *                              created_at directly. Must be an integer >= 1 (see clampRev).
 * @param selfPrivKeyHex        Sender private key hex, used only to derive pubkey and id.
 * @throws When originalId is empty, priorReplacementIds contains a non-string/empty
 *         entry, targetKind is not 9|14, rev is not an integer >= 1, or selfPrivKeyHex is empty.
 */
export function buildDeleteRumor(
  originalId: string,
  priorReplacementIds: string[],
  targetKind: TargetChatKind,
  rev: number,
  selfPrivKeyHex: string,
): UnsignedRumor {
  assertNonEmptyId(originalId, 'originalId');
  assertPriorReplacementIds(priorReplacementIds, 'buildDeleteRumor');
  assertTargetKind(targetKind, 'buildDeleteRumor');
  assertRealRev(rev, 'buildDeleteRumor');
  assertSelfPrivKeyHex(selfPrivKeyHex, 'buildDeleteRumor');

  const tags: string[][] = [
    ...dedupeIdsKeepFirst(originalId, priorReplacementIds).map((id): string[] => ['e', id]),
    ['k', String(targetKind)],
  ];

  return finalizeRumor(DELETE_EDIT_RUMOR_KIND, '', tags, rev, selfPrivKeyHex);
}

// ─── buildEditReplacementRumor ─────────────────────────────────────────────

/**
 * Build an edit-marked replacement chat rumor (kind-14 DM / kind-9 group)
 * carrying the new content.
 *
 * The wire created_at FIELD (Unix seconds) equals the ORIGINAL message's
 * created_at, pinned across the whole edit chain — never the immediately-prior
 * edit's (AC-EDIT-4, AC-EDIT-6: repeated edits always anchor to the FIRST
 * message's id/created_at; the slot anchor never moves). Callers are
 * responsible for always passing the slot's original createdAt, not the most
 * recent replacement's.
 *
 * Because created_at is pinned it cannot double as the rev clock, so rev rides
 * separately as ["rev", String(rev)], plus the anchor tag
 * ["e", originalId, "", "edit"].
 *
 * Note: ChatMessage.createdAt (storage) is milliseconds; this function's
 * originalCreatedAt parameter and the wire created_at field it produces are
 * both Unix SECONDS — callers must convert before calling.
 *
 * @param originalId         Hex id of the slot's original (first) message rumor.
 * @param originalCreatedAt  The ORIGINAL message's created_at as a non-negative
 *                            INTEGER Unix SECONDS value (not milliseconds, and
 *                            not the prior edit's created_at). Must be below
 *                            MAX_PLAUSIBLE_UNIX_SECONDS — a milliseconds value
 *                            (e.g. raw ChatMessage.createdAt, or an unfloored
 *                            `/1000`) throws rather than silently pinning a
 *                            wire created_at ~1000x in the future.
 * @param content             New message text. Must be non-empty (AC-EDIT-5 is
 *                            enforced at the UI layer; this builder also guards
 *                            as defense-in-depth against constructing an empty edit).
 * @param targetKind          14 for a DM replacement, 9 for a group replacement.
 * @param rev                 Real (sender-clamped) Unix-seconds revision value. Must be an
 *                            integer >= 1.
 * @param selfPrivKeyHex      Sender private key hex, used only to derive pubkey and id.
 * @throws When originalId is empty, content is empty, originalCreatedAt is
 *         not a non-negative integer, originalCreatedAt looks like a
 *         milliseconds epoch (>= MAX_PLAUSIBLE_UNIX_SECONDS) rather than Unix
 *         seconds, targetKind is not 9|14, rev is not an integer >= 1, or
 *         selfPrivKeyHex is empty.
 */
export function buildEditReplacementRumor(
  originalId: string,
  originalCreatedAt: number,
  content: string,
  targetKind: TargetChatKind,
  rev: number,
  selfPrivKeyHex: string,
): UnsignedRumor {
  assertNonEmptyId(originalId, 'originalId');
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('buildEditReplacementRumor: content must be a non-empty string');
  }
  if (!Number.isInteger(originalCreatedAt) || originalCreatedAt < 0) {
    throw new Error(`buildEditReplacementRumor: originalCreatedAt must be a non-negative integer (Unix seconds), got ${String(originalCreatedAt)}`);
  }
  if (originalCreatedAt >= MAX_PLAUSIBLE_UNIX_SECONDS) {
    throw new Error(
      `buildEditReplacementRumor: originalCreatedAt (${String(originalCreatedAt)}) looks like milliseconds, expected Unix seconds`,
    );
  }
  assertTargetKind(targetKind, 'buildEditReplacementRumor');
  assertRealRev(rev, 'buildEditReplacementRumor');
  assertSelfPrivKeyHex(selfPrivKeyHex, 'buildEditReplacementRumor');

  const tags: string[][] = [
    ['e', originalId, '', 'edit'],
    ['rev', String(rev)],
  ];

  return finalizeRumor(targetKind, content, tags, originalCreatedAt, selfPrivKeyHex);
}

// ─── buildEditMarkedCompanionKind5 ─────────────────────────────────────────

/**
 * Build an edit-marked companion kind-5, published alongside a replacement for
 * non-Few degradation only (spec §2.4). Carries the SAME e-tag chain as
 * buildDeleteRumor (original id + every DISTINCT prior replacement id,
 * deduplicated together with originalId first) plus the
 * ["k", String(targetKind)] tag, PLUS an appended ["e", originalId, "", "edit"]
 * marker that distinguishes it from a real delete (AC-DEL-7). The original id
 * therefore intentionally appears both bare (as part of the dedup'd hide-chain)
 * and marked (the discriminator) — that duplication is NOT deduplicated away,
 * unlike an accidental overlap between originalId and priorReplacementIds. A
 * Few client ignores this rumor entirely on receipt (S3 reconciliation core).
 *
 * @param originalId           Hex id of the slot's original (first) message rumor.
 * @param priorReplacementIds  Ids of every prior edit-replacement rumor for this
 *                              slot (AC-DEL-8), same semantics as buildDeleteRumor.
 * @param targetKind            Kind of the message being edited: 14 (DM) or 9 (group).
 * @param rev                   Real Unix-seconds wall-clock value; becomes this
 *                              rumor's created_at directly (companion shares the
 *                              same rev as its paired replacement).
 * @param selfPrivKeyHex        Sender private key hex, used only to derive pubkey and id.
 * @throws Same conditions as buildDeleteRumor.
 */
export function buildEditMarkedCompanionKind5(
  originalId: string,
  priorReplacementIds: string[],
  targetKind: TargetChatKind,
  rev: number,
  selfPrivKeyHex: string,
): UnsignedRumor {
  assertNonEmptyId(originalId, 'originalId');
  assertPriorReplacementIds(priorReplacementIds, 'buildEditMarkedCompanionKind5');
  assertTargetKind(targetKind, 'buildEditMarkedCompanionKind5');
  assertRealRev(rev, 'buildEditMarkedCompanionKind5');
  assertSelfPrivKeyHex(selfPrivKeyHex, 'buildEditMarkedCompanionKind5');

  const tags: string[][] = [
    ...dedupeIdsKeepFirst(originalId, priorReplacementIds).map((id): string[] => ['e', id]),
    ['k', String(targetKind)],
    ['e', originalId, '', 'edit'],
  ];

  return finalizeRumor(DELETE_EDIT_RUMOR_KIND, '', tags, rev, selfPrivKeyHex);
}

// ─── clampRev ───────────────────────────────────────────────────────────────

/**
 * Sender-side per-slot rev clamp (D16, AC-ORDER-5).
 *
 * rev = max(wallClockSeconds, lastKnownRevForSlot + 1) — guarantees the
 * resulting rev is always strictly greater than the slot's last-known rev,
 * even if the local wall clock is behind (stale) or another device already
 * published a higher rev for the same slot. When the wall clock is ahead
 * (future-skewed relative to lastKnownRevForSlot), the wall-clock value wins
 * unchanged.
 *
 * Guarded so a real signal's rev is ALWAYS >= 1 and always finite: the S1
 * storage clobber-guard treats rev < 1 (undefined/0) as "not a real signal"
 * (an original message rumor, never an edit/delete), so this helper must
 * never be able to return 0 or a non-finite value regardless of input —
 * malformed/non-finite/negative inputs are substituted with safe floors
 * BEFORE computing the max, rather than propagating NaN/0/negative through.
 *
 * @param wallClockSeconds      Caller's current wall-clock time in Unix seconds.
 *                              Non-finite or < 1 values are treated as 1.
 * @param lastKnownRevForSlot   The slot's highest previously-observed rev, or 0
 *                              if none is known yet. Non-finite or negative
 *                              values are treated as 0.
 * @returns A finite number >= 1, and >= lastKnownRevForSlot + 1 whenever the
 *          (sanitized) wallClockSeconds does not already exceed it.
 */
export function clampRev(wallClockSeconds: number, lastKnownRevForSlot: number): number {
  const safeWall = Number.isFinite(wallClockSeconds) && wallClockSeconds >= 1 ? Math.floor(wallClockSeconds) : 1;
  const safeLast = Number.isFinite(lastKnownRevForSlot) && lastKnownRevForSlot >= 0 ? Math.floor(lastKnownRevForSlot) : 0;
  return Math.max(safeWall, safeLast + 1);
}
