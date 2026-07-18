/**
 * Active-view registry — the single source of "what is the user currently
 * looking at?" for the notification bell's two domain invariants.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ INV-1 (off-domain rings): A change event whose target entity is NOT the  │
 * │   entity currently open in a detail view MUST ring the bell (increment    │
 * │   its unread count).                                                      │
 * │                                                                           │
 * │ INV-2 (on-domain updates): A change event whose target entity IS the      │
 * │   entity currently open MUST NOT ring the bell; the open view updates     │
 * │   instead (and the persisted last-read advances so a reload does not      │
 * │   re-surface it).                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Granularity is PER-ENTITY (the viewed target), not per-route: viewing group
 * X suppresses the bell only for X's own messages, join requests and invite
 * expiries; an event for group Y — also a group — still rings. Viewing the DM
 * thread with peer A suppresses only A's messages; a DM from B still rings.
 *
 * Every live bell increment site (chatHandler for group messages, the
 * MarmotContext join-request handler, directMessageNotifications for DMs, and
 * inviteExpirySweep for expiries) consults this registry before incrementing.
 * Because those sites live in non-React modules that cannot read React
 * context, this is a plain module-level store — the same shape as
 * `unreadStore.ts` — that detail views set on mount and clear on unmount.
 *
 * Existing suppression exceptions are unaffected: a DM from a still-pending
 * contact (AC-OBS-1) and pairing/profile-exchange echoes are gated by their
 * own predicates ahead of this one and are out of scope for these invariants.
 */

export type ActiveViewDomain = 'group' | 'dm';

export interface ActiveView {
  domain: ActiveViewDomain;
  /** Group id (as stored) for 'group'; peer pubkey hex for 'dm'. */
  id: string;
}

let activeView: ActiveView | null = null;

/**
 * Normalize an id for comparison. DM peer ids are lowercased to match the
 * `dmKey` convention used throughout unreadStore / directMessageNotifications;
 * group ids are compared as-is (they are not hex pubkeys and are stored with
 * their original casing everywhere else).
 */
function normalizeId(domain: ActiveViewDomain, id: string): string {
  return domain === 'dm' ? id.toLowerCase() : id;
}

/** Record the entity the user has open in a detail view (replaces any prior). */
export function setActiveView(view: ActiveView): void {
  activeView = { domain: view.domain, id: normalizeId(view.domain, view.id) };
}

/** Clear the active view — no detail view is open (list views, other routes). */
export function clearActiveView(): void {
  activeView = null;
}

/**
 * True only when the current active view's (domain, id) equals the arguments.
 * With no active view, always false — so every domain's events ring the bell
 * (INV-1 default).
 */
export function isActiveView(domain: ActiveViewDomain, id: string): boolean {
  if (!activeView) return false;
  return activeView.domain === domain && activeView.id === normalizeId(domain, id);
}

/**
 * The active group id when a group detail view is open, else null. This is the
 * value the dispatcher's `DispatcherContext.getActiveGroupId` seam is wired to,
 * letting the boundary-pure `chatHandler` consult the registry without a direct
 * import. Returns null when a DM thread (or nothing) is the active view.
 */
export function getActiveGroupId(): string | null {
  return activeView && activeView.domain === 'group' ? activeView.id : null;
}
