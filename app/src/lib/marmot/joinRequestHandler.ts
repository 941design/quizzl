/**
 * Join request handler — processes unwrapped kind 21059 join request rumors.
 *
 * Validates nonce against invite link storage, checks mute status,
 * checks for existing membership, deduplicates by pubkey+groupId,
 * and persists PendingJoinRequest to IDB.
 */

import { getInviteLink, isExpired } from './inviteLinkStorage';
import { savePendingJoinRequest, loadPendingJoinRequests } from './joinRequestStorage';
import type { PendingJoinRequest } from './joinRequestStorage';
import { truncateUtf8, MAX_NAME_BYTES } from '@/src/lib/contactCard';

export const JOIN_REQUEST_KIND = 21059;

export type JoinRequestReceivedCallback = (request: PendingJoinRequest) => void;

export interface JoinRequestPayload {
  type: 'join_request';
  nonce: string;
  name: string;
  requesterName?: string;
}

/**
 * Parse the content of a kind 21059 rumor.
 * Returns null if the content is not a valid join request.
 */
export function parseJoinRequestContent(content: string): JoinRequestPayload | null {
  try {
    const parsed = JSON.parse(content);
    if (
      parsed &&
      parsed.type === 'join_request' &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.name === 'string'
    ) {
      const trimmedRequesterName =
        typeof parsed.requesterName === 'string' ? parsed.requesterName.trim() : '';
      const requesterName = trimmedRequesterName.length > 0 ? trimmedRequesterName : undefined;
      return {
        type: 'join_request',
        nonce: parsed.nonce,
        name: parsed.name,
        requesterName,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Handle a received join request rumor.
 *
 * Discard conditions:
 * - Content is not a valid join request
 * - Nonce not found in invite link storage
 * - Invite link is muted
 * - Invite link is expired (isExpired(inviteLink, Date.now()))
 * - Requester is already a group member
 * - Duplicate request (same pubkey + groupId already pending)
 *
 * Returns the persisted PendingJoinRequest, or null if discarded.
 */
export async function handleJoinRequest(
  rumor: { pubkey: string; content: string },
  eventId: string,
  groupMemberPubkeys: (groupId: string) => string[],
): Promise<PendingJoinRequest | null> {
  // Parse content
  const payload = parseJoinRequestContent(rumor.content);
  if (!payload) return null;

  // Look up nonce
  const inviteLink = await getInviteLink(payload.nonce);
  if (!inviteLink) return null;

  // Check mute status
  if (inviteLink.muted) return null;

  // Check expiry status (AC-ENFORCE-1/2) — drops the request exactly as the
  // muted check above does. isExpired covers legacy records with no
  // expiresAt via its own createdAt + DAY_MS fallback (Design Decision 2),
  // so this call is correct even before migrateInviteLinks has run.
  if (isExpired(inviteLink, Date.now())) return null;

  const groupId = inviteLink.groupId;

  // Check if requester is already a group member
  const members = groupMemberPubkeys(groupId);
  if (members.includes(rumor.pubkey)) return null;

  // Check for existing pending request (dedup by pubkey + groupId)
  const existingRequests = await loadPendingJoinRequests(groupId);
  if (existingRequests.some((r) => r.pubkeyHex === rumor.pubkey)) return null;

  // Persist the request
  // Cap on receive, independent of any cap the sender may have applied —
  // the sender is untrusted, so this is the actual security control.
  const nickname =
    payload.requesterName !== undefined ? truncateUtf8(payload.requesterName, MAX_NAME_BYTES) : undefined;
  const request: PendingJoinRequest = {
    pubkeyHex: rumor.pubkey,
    nonce: payload.nonce,
    groupId,
    receivedAt: Date.now(),
    nickname,
    eventId,
  };

  await savePendingJoinRequest(request);
  return request;
}
