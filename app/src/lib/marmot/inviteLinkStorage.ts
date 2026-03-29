/**
 * IndexedDB-backed invite link storage using idb-keyval.
 *
 * Each invite link is keyed by its nonce in the 'quizzl-invite-links' database.
 */

import { createStore, get, set, del, entries, clear } from 'idb-keyval';

export interface InviteLink {
  /** Hex nonce — primary key */
  nonce: string;
  /** Group this link belongs to */
  groupId: string;
  /** When the link was created (Unix ms) */
  createdAt: number;
  /** Human-readable label (optional, for admin's own tracking) */
  label?: string;
  /** Whether requests referencing this nonce are silently ignored */
  muted: boolean;
}

// ---------------------------------------------------------------------------
// IDB store
// ---------------------------------------------------------------------------

const inviteLinkStore = createStore('quizzl-invite-links', 'links');

export function createInviteLinkStore() {
  return inviteLinkStore;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function saveInviteLink(link: InviteLink): Promise<void> {
  await set(link.nonce, link, inviteLinkStore);
}

export async function getInviteLink(nonce: string): Promise<InviteLink | undefined> {
  return get<InviteLink>(nonce, inviteLinkStore);
}

export async function loadInviteLinks(groupId: string): Promise<InviteLink[]> {
  const all = await entries<string, InviteLink>(inviteLinkStore);
  return all
    .map(([, link]) => link)
    .filter((link) => link.groupId === groupId);
}

export async function loadAllInviteLinks(): Promise<InviteLink[]> {
  const all = await entries<string, InviteLink>(inviteLinkStore);
  return all.map(([, link]) => link);
}

export async function updateInviteLinkMuted(nonce: string, muted: boolean): Promise<void> {
  const link = await get<InviteLink>(nonce, inviteLinkStore);
  if (!link) return;
  await set(nonce, { ...link, muted }, inviteLinkStore);
}

export async function deleteInviteLink(nonce: string): Promise<void> {
  await del(nonce, inviteLinkStore);
}

export async function clearAllInviteLinks(): Promise<void> {
  await clear(inviteLinkStore);
}
