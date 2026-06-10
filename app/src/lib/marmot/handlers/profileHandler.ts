/**
 * profileHandler.ts
 *
 * RumorHandler for PROFILE_RUMOR_KIND (kind 0).
 *
 * Mirrors the PROFILE_RUMOR_KIND branch of MarmotContext.onApplicationMessage
 * exactly. All side-effect dependencies are injected — zero imports from
 * app/src/context/.
 *
 * Boundary rules (architecture.md):
 *   - Zero imports from app/src/context/
 *   - All IDB and state-setter deps received via injection
 */

import { PROFILE_RUMOR_KIND, parseProfilePayload, payloadToMemberProfile } from '@/src/lib/marmot/profileSync';
import type { MemberProfile, ProfileAvatar } from '@/src/types';
import type { ApplicationRumor, DispatcherContext, RumorHandler } from '@/src/lib/marmot/applicationRumorDispatcher';

export interface ProfileHandlerDeps {
  mergeMemberProfile: (groupId: string, profile: MemberProfile) => Promise<boolean>;
  notifyProfileObserved: (args: { groupId: string; targetPubkey: string; observedUpdatedAt: string }) => void;
  recordRequestAnswered: (groupId: string, authorPubkey: string, timestamp: number) => Promise<void>;
  writeContactEntry: (pubkey: string, entry: { nickname: string; avatar: ProfileAvatar | null; updatedAt: string }) => void;
  setProfileVersion: (updater: (v: number) => number) => void;
}

async function handle(rumor: ApplicationRumor, ctx: DispatcherContext, deps: ProfileHandlerDeps): Promise<void> {
  const profilePayload = parseProfilePayload(rumor.content);
  if (!profilePayload) return;

  // sig verified by parseProfilePayload. For relay-on-behalf the MLS sender is
  // the relayer, not the author — signedEvent.pubkey is authoritative.
  const authorPubkey = profilePayload.signedEvent?.pubkey ?? rumor.pubkey;
  const memberProfile = payloadToMemberProfile(rumor.pubkey, profilePayload);

  // Write to IDB first, THEN bump profileVersion so GroupDetailView re-reads
  // after the write has landed (avoids stale-read race).
  const merged = await deps.mergeMemberProfile(ctx.groupId, memberProfile);
  deps.setProfileVersion((v) => v + 1);

  if (merged) {
    await deps.recordRequestAnswered(ctx.groupId, authorPubkey, Date.now());
  }

  // AC-036: cancel any pending relay timer for this profile's author.
  if (profilePayload.signedEvent) {
    deps.notifyProfileObserved({
      groupId: ctx.groupId,
      targetPubkey: authorPubkey,
      observedUpdatedAt: memberProfile.updatedAt,
    });
  }

  // Cache in global contact cache for cross-group availability.
  deps.writeContactEntry(authorPubkey, {
    nickname: memberProfile.nickname,
    avatar: memberProfile.avatar ?? null,
    updatedAt: memberProfile.updatedAt,
  });
}

export function createProfileHandler(deps: ProfileHandlerDeps): RumorHandler {
  return {
    kind: PROFILE_RUMOR_KIND,
    handle: (rumor: ApplicationRumor, ctx: DispatcherContext) => handle(rumor, ctx, deps),
  };
}
