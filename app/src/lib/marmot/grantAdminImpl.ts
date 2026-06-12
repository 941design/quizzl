/**
 * Pure implementation of the grantAdmin operation.
 * Extracted from MarmotContext to enable unit testing without rendering React.
 *
 * Mirrors cancelInvitationImpl.ts: uses the Deps-injection pattern; has zero
 * imports from app/src/context/ (AC-BOUND-1); never imports marmot-ts directly
 * (Proposals is injected via Deps from the MarmotContext boundary).
 */

// Use `any` (not `unknown`) for marmot-ts opaque types so the impl can accept
// strongly-typed callables from the boundary without contravariance fights.
// The decoupling intent is preserved: the impl never reaches into these shapes.
type MarmotGroupLike = {
  state: any;
  groupData?: { adminPubkeys?: string[] } | null;
  commit: (opts: { extraProposals: any[] }) => Promise<unknown>;
};

type Deps = {
  getGroup: (groupId: string) => Promise<MarmotGroupLike | null>;
  Proposals: {
    proposeUpdateMetadata: (opts: { adminPubkeys: string[] }) => unknown;
  };
  reloadGroups: () => Promise<void>;
  markBackupDirty: (dirty: boolean) => void;
};

/**
 * Returns true when every element of `live` appears in `next` (case-insensitive).
 *
 * A real superset check (not inlined as `true`) so a FUTURE refactor that changes
 * how the new admin set is constructed — building it from a stale snapshot, or from
 * a caller-supplied set — is caught before any demotion reaches the commit (AC-GRANT-5).
 * On the current grant path `next = currentAdmins ∪ {target}` by construction, so this
 * never fires today. Exported for direct unit testing of the guard.
 */
export function isSuperset(live: string[], next: string[]): boolean {
  const nextLower = next.map((pk) => pk.toLowerCase());
  return live.every((pk) => nextLower.includes(pk.toLowerCase()));
}

/**
 * Grant admin status to `targetPubkey` in the group identified by `groupId`.
 *
 * Contracts:
 *  - Idempotent: if target is already an admin, returns { ok: true } without committing.
 *  - Superset guard: if the computed new set would not be a superset of live adminPubkeys
 *    (structurally impossible on the grant path, but guards against logic errors), returns
 *    { ok: false, error: 'demotion_rejected' } without committing (AC-GRANT-5).
 *  - Live-set re-read (AC-GRANT-7, amended 2026-06-11): every attempt re-reads the
 *    LIVE adminPubkeys from the group and merges the target into THAT set — never a
 *    stale UI snapshot. This prevents clobber whenever the live read already reflects
 *    a concurrent grant.
 *  - Catch-based retry: on a SYNCHRONOUS commit() throw (e.g. local unapplied
 *    proposals, an epoch error surfaced at call time), re-reads live adminPubkeys,
 *    re-merges, re-evaluates the superset guard, and retries once (max two attempts).
 *    NOTE: this does NOT cover the common concurrent-grant case — marmot-ts commit()
 *    has no relay awareness and does NOT throw when another admin commits at the same
 *    epoch; both succeed locally and the fork is resolved asynchronously on the
 *    receiving side (see spec ## Amendments 2026-06-11). Concurrent same-epoch grants
 *    are therefore last-writer-wins; a superseded grant is re-issued by the admin.
 *    No protocol-level no-clobber is claimed.
 *  - Single commit per attempt: exactly one mlsGroup.commit() call on success.
 *  - Zero context imports (AC-BOUND-1).
 */
export async function grantAdminImpl(
  deps: Deps,
  groupId: string,
  targetPubkey: string,
): Promise<{ ok: boolean; error?: string }> {
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Always re-read the LIVE group on every attempt so we pick up concurrent
    // grants that landed between our last read and this retry (AC-GRANT-7).
    const mlsGroup = await deps.getGroup(groupId);
    if (!mlsGroup) return { ok: false, error: 'group_not_found' };

    const currentAdmins = mlsGroup.groupData?.adminPubkeys ?? [];

    // Idempotent no-op: target is already an admin.
    // Prevents re-emitting an UpdateMetadata that could overwrite a concurrently
    // added admin that our stale snapshot does not know about (VQ-S3-011).
    if (currentAdmins.some((pk) => pk.toLowerCase() === targetPubkey.toLowerCase())) {
      return { ok: true };
    }

    const newSet = [...currentAdmins, targetPubkey];

    // Superset guard (AC-GRANT-5): newSet must contain every member of currentAdmins.
    // On the happy path this is always true (newSet = currentAdmins ∪ {target}).
    // The check is a real isSuperset call — not inlined as a tautology — so any
    // future refactor that accidentally drops an existing admin is caught here.
    if (!isSuperset(currentAdmins, newSet)) {
      return { ok: false, error: 'demotion_rejected' };
    }

    try {
      await mlsGroup.commit({
        extraProposals: [deps.Proposals.proposeUpdateMetadata({ adminPubkeys: newSet })],
      });
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        // First attempt failed (e.g. epoch conflict from a concurrent grant).
        // The loop will re-read live adminPubkeys on the next iteration and
        // re-merge the target into whatever set landed (AC-GRANT-7).
        continue;
      }
      // All attempts exhausted.
      return { ok: false, error: err instanceof Error ? err.message : 'commit_failed' };
    }

    // Success on this attempt.
    await deps.reloadGroups();
    deps.markBackupDirty(true);
    return { ok: true };
  }

  // Unreachable: the loop always returns inside the try/catch on final attempt.
  return { ok: false, error: 'commit_failed' };
}
