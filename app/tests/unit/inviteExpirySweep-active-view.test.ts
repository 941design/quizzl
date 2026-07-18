/**
 * Unit tests for the invite-link expiry sweep's active-view suppression
 * (epic: notification-domain-invariants).
 *
 *   INV-1 (off-domain rings): a link expiry detected for a group NOT currently
 *     open → the expiry bell increments for that group (unchanged behaviour).
 *   INV-2 (on-domain updates): a link expiry detected for the group whose
 *     detail view is currently open → NO bell increment; the link is
 *     acknowledged (notified + acknowledged) so it does not resurface on
 *     reload. The manage-links view is the on-screen surface for it.
 *
 * Mocks idb-keyval with a flat map so the REAL inviteLinkStorage helpers run,
 * and mocks react's useSyncExternalStore to read the store synchronously —
 * mirroring inviteExpirySweep.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InviteLink } from '@/src/lib/marmot/inviteLinkStorage';

const idbStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => 'mock-store'),
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); }),
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
  entries: vi.fn(async () => [...idbStore.entries()]),
  clear: vi.fn(async () => { idbStore.clear(); }),
}));
vi.mock('react', () => ({
  useSyncExternalStore: (_s: any, getSnapshot: any) => getSnapshot(),
}));
vi.mock('@/src/lib/activeViewStore', () => ({
  isActiveView: vi.fn(() => false),
}));

const inviteLinkStorage = await import('@/src/lib/marmot/inviteLinkStorage');
const { DAY_MS, saveInviteLink, getInviteLink } = inviteLinkStorage;
const { runInviteExpirySweep } = await import('@/src/lib/marmot/inviteExpirySweep');
const { useUnreadCounts, clearInviteExpiries } = await import('@/src/lib/unreadStore');
const { isActiveView } = await import('@/src/lib/activeViewStore');

const GROUP = 'group-1';
const EXPIRED_AT = 1_700_000_000_000;
const NOW = EXPIRED_AT + DAY_MS * 2;

function makeLink(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    nonce: 'nonce-1',
    groupId: GROUP,
    createdAt: EXPIRED_AT - DAY_MS,
    expiresAt: EXPIRED_AT,
    usageCount: 0,
    expiryNotified: false,
    expiryAcknowledged: false,
    label: undefined,
    muted: false,
    ...overrides,
  };
}

describe('inviteExpirySweep active-view suppression', () => {
  beforeEach(async () => {
    idbStore.clear();
    clearInviteExpiries(GROUP);
    vi.mocked(isActiveView).mockReset();
    vi.mocked(isActiveView).mockReturnValue(false);
  });

  it('INV-1: an expiry for a group that is NOT the active view rings the bell', async () => {
    await saveInviteLink(makeLink());
    await runInviteExpirySweep(NOW);
    expect(useUnreadCounts().inviteExpiries[GROUP]).toBe(1);
    const link = await getInviteLink('nonce-1');
    expect(link?.expiryNotified).toBe(true);
    expect(link?.expiryAcknowledged).toBe(false);
  });

  it('INV-2: an expiry for the group that IS the active view does NOT ring the bell and is acknowledged', async () => {
    vi.mocked(isActiveView).mockImplementation((domain: string, id: string) => domain === 'group' && id === GROUP);
    await saveInviteLink(makeLink());
    await runInviteExpirySweep(NOW);
    // No badge for the group currently on screen.
    expect(useUnreadCounts().inviteExpiries[GROUP] ?? 0).toBe(0);
    // Acknowledged so a reload's initInviteExpiries derivation stays clear.
    const link = await getInviteLink('nonce-1');
    expect(link?.expiryNotified).toBe(true);
    expect(link?.expiryAcknowledged).toBe(true);
  });

  it('INV-1: an expiry while a DIFFERENT group is the active view still rings the bell', async () => {
    vi.mocked(isActiveView).mockImplementation((domain: string, id: string) => domain === 'group' && id === 'other-group');
    await saveInviteLink(makeLink());
    await runInviteExpirySweep(NOW);
    expect(useUnreadCounts().inviteExpiries[GROUP]).toBe(1);
  });
});
