/**
 * profileSync.ts — Utilities for building and processing profile messages.
 *
 * Wire format (epic: member-profile-discovery-and-relay-on-behalf, story 01):
 * the kind-0 application rumor's `content` carries a stringified, fully signed
 * Nostr kind:0 event (SignedProfileEvent). The outer MLS rumor stays unsigned
 * per MIP-03; authentication of the original author lives inside the embedded
 * envelope. The inner event's `content` is the same flat ProfilePayload JSON
 * (nickname/avatar/updatedAt) we have always shipped.
 *
 * Backward compatibility: legacy peers may still emit a flat ProfilePayload
 * with no envelope. parseProfilePayload accepts both shapes; legacy parses
 * yield `signedEvent === undefined` and are non-relayable until the peer
 * upgrades.
 */

import { verifyEvent } from 'nostr-tools/pure';
import type { EventSigner } from 'applesauce-core';
import type { UserProfile, ProfileAvatar, MemberProfile, SignedProfileEvent } from '@/src/types';
import { AVATAR_BROWSER_CONFIG } from '@/src/config/profile';

/** MLS application-message rumor kind for profile updates (kind 0 = metadata). */
export const PROFILE_RUMOR_KIND = 0;

/** Wire format for the profile data section (carried inside SignedProfileEvent.content). */
export type ProfilePayload = {
  nickname: string;
  avatar: { id: string; subject: string; accessories: string[] } | null;
  updatedAt: string;
  /** Present when the rumor carried a verified SignedProfileEvent envelope. */
  signedEvent?: SignedProfileEvent;
};

function buildPayloadJson(profile: UserProfile): string {
  const payload = {
    nickname: profile.nickname,
    avatar: profile.avatar
      ? { id: profile.avatar.id, subject: profile.avatar.subject, accessories: profile.avatar.accessories }
      : null,
    updatedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

/**
 * Sign a UserProfile and return the JSON-stringified SignedProfileEvent
 * suitable for an MLS rumor's `content`. The outer rumor stays unsigned.
 */
export async function serialiseProfileUpdate(
  profile: UserProfile,
  signer: EventSigner,
): Promise<string> {
  const draft = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [] as string[][],
    content: buildPayloadJson(profile),
  };
  const signed = await signer.signEvent(draft);
  if (signed.kind !== 0) {
    throw new Error(`profileSync: signer returned kind ${signed.kind}, expected 0`);
  }
  const envelope: SignedProfileEvent = {
    id: signed.id,
    pubkey: signed.pubkey,
    created_at: signed.created_at,
    kind: 0,
    tags: signed.tags,
    content: signed.content,
    sig: signed.sig,
  };
  return JSON.stringify(envelope);
}

function looksLikeEnvelope(parsed: unknown): parsed is SignedProfileEvent {
  if (!parsed || typeof parsed !== 'object') return false;
  const o = parsed as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.pubkey === 'string' &&
    typeof o.sig === 'string' &&
    typeof o.created_at === 'number' &&
    typeof o.content === 'string' &&
    Array.isArray(o.tags) &&
    o.kind === 0
  );
}

function parseInnerProfile(content: string): {
  nickname: string;
  avatar: ProfilePayload['avatar'];
  updatedAt: string;
} | null {
  try {
    const d = JSON.parse(content) as Partial<ProfilePayload>;
    if (
      typeof d.nickname !== 'string' ||
      typeof d.updatedAt !== 'string'
    ) {
      return null;
    }
    return {
      nickname: d.nickname,
      avatar: d.avatar ?? null,
      updatedAt: d.updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Parse rumor content as a ProfilePayload.
 *
 * - Envelope shape (signed Nostr kind:0): verify the signature; on success,
 *   parse the inner content and return the payload with signedEvent populated.
 *   On verification failure, return null — the rumor is dropped silently.
 * - Legacy flat shape: return the payload with signedEvent undefined.
 * - Anything else: null.
 */
export function parseProfilePayload(content: string): ProfilePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (looksLikeEnvelope(parsed)) {
    let verified = false;
    try {
      verified = verifyEvent(parsed as never);
    } catch {
      verified = false;
    }
    if (!verified) return null;
    const inner = parseInnerProfile(parsed.content);
    if (!inner) return null;
    return { ...inner, signedEvent: parsed };
  }

  if (parsed && typeof parsed === 'object') {
    const inner = parseInnerProfile(content);
    if (!inner) return null;
    return inner;
  }

  return null;
}

/**
 * Reconstruct a full MemberProfile from a parsed payload.
 *
 * Identity binding: when the payload carries a verified SignedProfileEvent,
 * the keying pubkey is the AUTHOR (signedEvent.pubkey), not the caller-supplied
 * `fallbackPubkeyHex`. The fallback is used only for legacy unsigned payloads
 * (signedEvent absent), where the MLS rumor sender is the only available
 * identity. This protects the relay-on-behalf path (story 06): when peer A
 * relays B's signed profile, the result is keyed under B, not A.
 */
export function payloadToMemberProfile(fallbackPubkeyHex: string, payload: ProfilePayload): MemberProfile {
  const authorPubkey = payload.signedEvent?.pubkey ?? fallbackPubkeyHex;
  let avatar: ProfileAvatar | null = null;
  if (payload.avatar) {
    avatar = {
      id: payload.avatar.id,
      subject: payload.avatar.subject,
      accessories: payload.avatar.accessories,
      imageUrl: `${AVATAR_BROWSER_CONFIG.endpointBaseUrl}/${payload.avatar.id}.png`,
    };
  }
  return {
    pubkeyHex: authorPubkey,
    nickname: payload.nickname,
    avatar,
    updatedAt: payload.updatedAt,
    ...(payload.signedEvent ? { signedEvent: payload.signedEvent } : {}),
  };
}
