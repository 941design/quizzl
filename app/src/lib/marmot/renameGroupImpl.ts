/**
 * Pure implementation of the group rename operation.
 * Extracted from MarmotContext to enable unit testing without rendering React.
 *
 * Mirrors grantAdminImpl.ts / cancelInvitationImpl.ts: uses the Deps-injection
 * pattern; has zero imports from app/src/context/; never imports marmot-ts
 * directly (Proposals is injected via Deps from the MarmotContext boundary).
 *
 * The group name lives in the shared MLS metadata (MarmotGroupData.name) and is
 * updated with an admin-only UpdateMetadata commit — the exact mechanism the
 * app already uses for adminPubkeys changes. The app-local overlay (Group.name,
 * what the UI renders) is updated separately here so the acting admin sees the
 * new name immediately; remote members pick it up from the authoritative MLS
 * metadata via the commit-ingestion resync in MarmotContext.
 */

// Use `any` (not `unknown`) for marmot-ts opaque types so the impl can accept
// strongly-typed callables from the boundary without contravariance fights.
type MarmotGroupLike = {
  groupData?: { name?: string } | null;
  commit: (opts: { extraProposals: any[] }) => Promise<unknown>;
};

/**
 * The overlay group carries at least { id, name }; the impl is generic over the
 * concrete shape (the boundary passes the real Group) so persistGroup keeps its
 * exact type and the spread `{ ...stored, name }` stays type-checked without the
 * impl importing the app's Group type.
 */
type StoredGroupLike = { id: string; name: string };

type Deps<G extends StoredGroupLike> = {
  getGroup: (groupId: string) => Promise<MarmotGroupLike | null>;
  Proposals: {
    // The real marmot-ts signature is proposeUpdateMetadata(Partial<MarmotGroupData>),
    // which structurally accepts { name }.
    proposeUpdateMetadata: (opts: { name: string }) => unknown;
  };
  getStoredGroup: (groupId: string) => G | undefined;
  persistGroup: (group: G) => Promise<void>;
  reloadGroups: () => Promise<void>;
  markBackupDirty: (dirty: boolean) => void;
};

/** MLS/overlay group name cap. Matches the create-group input (CreateGroupModal maxLength=64). */
export const MAX_GROUP_NAME_LENGTH = 64;

/** Trim leading/trailing whitespace — the same normalisation the create flow applies. */
export function normaliseGroupName(raw: string): string {
  return raw.trim();
}

/** A valid group name is non-empty after trim and within the length cap. */
export function isValidGroupName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_GROUP_NAME_LENGTH;
}

/**
 * Rename the group identified by `groupId` to `rawName`.
 *
 * Contracts:
 *  - Validation: rejects empty/whitespace-only or over-length names with
 *    { ok: false, error: 'invalid_name' } — no commit.
 *  - No-op: if the trimmed name equals the group's LIVE MLS metadata name,
 *    returns { ok: true, changed: false } without committing or updating the
 *    overlay (caller suppresses the in-chat notice on changed === false).
 *  - Single admin-only commit per attempt: exactly one mlsGroup.commit() call on
 *    the happy path, carrying one proposeUpdateMetadata({ name }) proposal. The
 *    commit is rejected at the protocol level for non-admins (MIP-03 policy).
 *  - Catch-based retry: on a SYNCHRONOUS commit() throw (e.g. local unapplied
 *    proposals), re-reads the live group and retries once (max two attempts),
 *    mirroring grantAdminImpl.
 *  - Overlay update: on success, persists Group.name into the local overlay and
 *    reloads so the acting admin's UI reflects the new name immediately.
 *  - Zero context imports.
 */
export async function renameGroupImpl<G extends StoredGroupLike>(
  deps: Deps<G>,
  groupId: string,
  rawName: string,
): Promise<{ ok: boolean; error?: string; changed?: boolean }> {
  const name = normaliseGroupName(rawName);
  if (!isValidGroupName(name)) {
    return { ok: false, error: 'invalid_name' };
  }

  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Always re-read the LIVE group on every attempt so we compare against and
    // commit on top of the current MLS metadata, not a stale snapshot.
    const mlsGroup = await deps.getGroup(groupId);
    if (!mlsGroup) return { ok: false, error: 'group_not_found' };

    // No-op when the live metadata name already matches — avoids a redundant
    // commit and a spurious "renamed" notice.
    if (mlsGroup.groupData?.name === name) {
      return { ok: true, changed: false };
    }

    try {
      await mlsGroup.commit({
        extraProposals: [deps.Proposals.proposeUpdateMetadata({ name })],
      });
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        // First attempt failed (e.g. local unapplied proposals). The loop
        // re-reads the live group and retries the commit on the next iteration.
        continue;
      }
      return { ok: false, error: err instanceof Error ? err.message : 'commit_failed' };
    }

    // Success: reflect the new name into the local overlay for the acting admin.
    const stored = deps.getStoredGroup(groupId);
    if (stored) {
      await deps.persistGroup({ ...stored, name });
      await deps.reloadGroups();
    }
    deps.markBackupDirty(true);
    return { ok: true, changed: true };
  }

  // Unreachable: the loop always returns inside the try/catch on the final attempt.
  return { ok: false, error: 'commit_failed' };
}
