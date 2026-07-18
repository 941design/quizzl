/**
 * Unit tests for the S3 manage-overlay redesign
 * (app/src/components/groups/ManageInviteLinksModal.tsx).
 *
 * Convention (no jsdom/@testing-library in this repo — see
 * tests/unit/attachmentsFeatureToggle.test.ts and
 * tests/unit/memberListAdminUi.test.ts): the row-classification logic
 * (relative-time formatting, usage-count string assembly, expired-vs-live
 * styling, empty-state predicate) is extracted into pure functions exported
 * directly from the .tsx component file (same pattern as MemberList.tsx's
 * `isRowAdmin`/`computeShowMakeAdmin`) and tested here behaviorally, with an
 * injectable `now`. Interactive click-confirm-delete sequencing (AC-UI-5/6)
 * and the periodic-tick wiring (AC-UI-8) cannot be driven through a mounted
 * component without a DOM, so those are proved by source-text assertions
 * against the real production file instead of being faked as green.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InviteLink } from '@/src/lib/marmot/inviteLinkStorage';

// ─── idb-keyval mock (mirrors inviteLinkLifecycle.test.ts / manageInviteLinksModal.test.ts) ───
// The component imports inviteLinkStorage, which calls idb-keyval's
// createStore() at module scope — it must be mocked before either module is
// imported, even though these tests never touch storage directly.
const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => 'mock-store'),
  get: vi.fn(async (key: string) => store.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    store.delete(key);
  }),
  keys: vi.fn(async () => [...store.keys()]),
  entries: vi.fn(async () => [...store.entries()]),
  clear: vi.fn(async () => {
    store.clear();
  }),
}));

// next/router is not imported by this component today, but stub defensively
// in case a future edit adds it (mirrors memberListAdminUi.test.ts).
vi.mock('next/router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

const {
  describeExpiry,
  expiryDescriptorToCopy,
  resolveEffectiveExpiresAt,
  formatCreatedAt,
  rowStyleFor,
  isEmptyLinksList,
} = await import('@/src/components/groups/ManageInviteLinksModal');

const { getCopy } = await import('@/src/lib/i18n');
const { DAY_MS } = await import('@/src/lib/marmot/inviteLinkStorage');

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const __filename_ = fileURLToPath(import.meta.url);
const COMPONENT_PATH = path.resolve(
  path.dirname(__filename_),
  '../../src/components/groups/ManageInviteLinksModal.tsx'
);
const componentSource = fs.readFileSync(COMPONENT_PATH, 'utf8');

function makeLink(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    nonce: 'nonce-1',
    groupId: 'group-1',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000 + DAY_MS,
    usageCount: 0,
    expiryNotified: false,
    expiryAcknowledged: false,
    label: undefined,
    muted: false,
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
});

// ---------------------------------------------------------------------------
// resolveEffectiveExpiresAt — the display-only mirror of isExpired's fallback
// ---------------------------------------------------------------------------

describe('resolveEffectiveExpiresAt', () => {
  it('returns the record expiresAt when present', () => {
    expect(resolveEffectiveExpiresAt({ expiresAt: 5000, createdAt: 1000 })).toBe(5000);
  });

  it('falls back to createdAt + DAY_MS for a legacy record missing expiresAt', () => {
    const legacy = { createdAt: 1000 } as Pick<InviteLink, 'expiresAt' | 'createdAt'>;
    expect(resolveEffectiveExpiresAt(legacy)).toBe(1000 + DAY_MS);
  });
});

// ---------------------------------------------------------------------------
// describeExpiry — AC-UI-1 (time-of-day precision or an equivalent relative form)
// ---------------------------------------------------------------------------

describe('describeExpiry', () => {
  it('classifies a future expiry under 1h as minutes, rounded, min 1', () => {
    const now = 0;
    const expiresAt = 45 * MINUTE_MS;
    expect(describeExpiry(now, expiresAt)).toEqual({ expired: false, unit: 'minutes', amount: 45 });
  });

  it('classifies a future expiry at/over 1h as hours, rounded', () => {
    const now = 0;
    const expiresAt = 3 * HOUR_MS + 10 * MINUTE_MS; // 3h10m -> rounds to 3h
    expect(describeExpiry(now, expiresAt)).toEqual({ expired: false, unit: 'hours', amount: 3 });
  });

  it('never displays 0 for a near-zero future diff (minimum amount is 1)', () => {
    const now = 0;
    const expiresAt = 30_000; // 30s away
    expect(describeExpiry(now, expiresAt)).toEqual({ expired: false, unit: 'minutes', amount: 1 });
  });

  it('is expired exactly at the boundary (now === effectiveExpiresAt), matching isExpired', () => {
    const now = 10_000;
    expect(describeExpiry(now, 10_000).expired).toBe(true);
  });

  it('classifies a past expiry under 1h ago as minutes, rounded, min 1', () => {
    const now = 20 * MINUTE_MS;
    const expiresAt = 0;
    expect(describeExpiry(now, expiresAt)).toEqual({ expired: true, unit: 'minutes', amount: 20 });
  });

  it('classifies a past expiry at/over 1h ago as hours, rounded', () => {
    const now = 2 * HOUR_MS + 5 * MINUTE_MS; // 2h5m ago -> rounds to 2h
    const expiresAt = 0;
    expect(describeExpiry(now, expiresAt)).toEqual({ expired: true, unit: 'hours', amount: 2 });
  });

  it('is symmetric: swapping which side is "now" only flips `expired`, not the magnitude bucketing', () => {
    const a = describeExpiry(0, 90 * MINUTE_MS);
    const b = describeExpiry(90 * MINUTE_MS, 0);
    expect(a.unit).toBe(b.unit);
    expect(a.amount).toBe(b.amount);
    expect(a.expired).toBe(false);
    expect(b.expired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// expiryDescriptorToCopy — routes the 4 branches to the matching Copy fn (both locales)
// ---------------------------------------------------------------------------

describe('expiryDescriptorToCopy', () => {
  it.each(['en', 'de'] as const)('%s: routes each of the 4 (expired x unit) branches to the matching Copy function', (lang) => {
    const groups = getCopy(lang).groups;

    expect(expiryDescriptorToCopy(groups, { expired: false, unit: 'hours', amount: 3 })).toBe(
      groups.manageLinksExpiresInHours(3)
    );
    expect(expiryDescriptorToCopy(groups, { expired: false, unit: 'minutes', amount: 5 })).toBe(
      groups.manageLinksExpiresInMinutes(5)
    );
    expect(expiryDescriptorToCopy(groups, { expired: true, unit: 'hours', amount: 2 })).toBe(
      groups.manageLinksExpiredHoursAgo(2)
    );
    expect(expiryDescriptorToCopy(groups, { expired: true, unit: 'minutes', amount: 7 })).toBe(
      groups.manageLinksExpiredMinutesAgo(7)
    );
  });

  it('AC-UI-1 rendered-string example: a fixed now/createdAt/expiresAt triple in both locales', () => {
    const createdAt = 1_700_000_000_000;
    const expiresAt = createdAt + DAY_MS;
    const now = expiresAt - 3 * HOUR_MS; // 3h before expiry

    const descriptor = describeExpiry(now, resolveEffectiveExpiresAt({ expiresAt, createdAt }));
    expect(descriptor).toEqual({ expired: false, unit: 'hours', amount: 3 });

    const enText = expiryDescriptorToCopy(getCopy('en').groups, descriptor);
    const deText = expiryDescriptorToCopy(getCopy('de').groups, descriptor);
    expect(enText).toBeTruthy();
    expect(deText).toBeTruthy();
    expect(deText).not.toBe(enText);
  });
});

// ---------------------------------------------------------------------------
// formatCreatedAt — AC-UI-1, created-side
// ---------------------------------------------------------------------------

describe('formatCreatedAt', () => {
  it('returns a non-empty string for a valid timestamp', () => {
    expect(formatCreatedAt(1_700_000_000_000).length).toBeGreaterThan(0);
  });

  it('produces different output for different timestamps (not a frozen placeholder)', () => {
    expect(formatCreatedAt(1_700_000_000_000)).not.toBe(formatCreatedAt(1_800_000_000_000));
  });
});

// ---------------------------------------------------------------------------
// rowStyleFor — AC-UI-3, paired fixtures differing only in expiry state
// ---------------------------------------------------------------------------

describe('rowStyleFor', () => {
  it('a live row and an expired row receive different style props', () => {
    const live = rowStyleFor(false);
    const expired = rowStyleFor(true);
    expect(expired).not.toEqual(live);
  });

  it('only the expired row gets the strike-through treatment', () => {
    expect(rowStyleFor(true).textDecoration).toBe('line-through');
    expect(rowStyleFor(false).textDecoration).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isEmptyLinksList — AC-UI-7
// ---------------------------------------------------------------------------

describe('isEmptyLinksList', () => {
  it('true for an empty array', () => {
    expect(isEmptyLinksList([])).toBe(true);
  });

  it('false when at least one link is present', () => {
    expect(isEmptyLinksList([makeLink()])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// i18n completeness for S3's own keys (AC-LOCALE-1 subset owned by this story)
// ---------------------------------------------------------------------------

describe('S3 i18n keys — en/de both present and non-empty', () => {
  it('en', () => {
    const en = getCopy('en').groups;
    expect(en.manageLinksCreatedAt('X')).toBeTruthy();
    expect(en.manageLinksExpiresInHours(1)).toBeTruthy();
    expect(en.manageLinksExpiresInMinutes(1)).toBeTruthy();
    expect(en.manageLinksExpiredHoursAgo(1)).toBeTruthy();
    expect(en.manageLinksExpiredMinutesAgo(1)).toBeTruthy();
    expect(en.manageLinksExpiredMarker).toBeTruthy();
    expect(en.manageLinksUsageCount(1)).toBeTruthy();
    expect(en.manageLinksRemoveButtonLabel).toBeTruthy();
    expect(en.manageLinksRemoveConfirm).toBeTruthy();
    expect(en.manageLinksRemoveConfirmButton).toBeTruthy();
    expect(en.manageLinksEmpty).toBeTruthy();
  });

  it('de', () => {
    const de = getCopy('de').groups;
    expect(de.manageLinksCreatedAt('X')).toBeTruthy();
    expect(de.manageLinksExpiresInHours(1)).toBeTruthy();
    expect(de.manageLinksExpiresInMinutes(1)).toBeTruthy();
    expect(de.manageLinksExpiredHoursAgo(1)).toBeTruthy();
    expect(de.manageLinksExpiredMinutesAgo(1)).toBeTruthy();
    expect(de.manageLinksExpiredMarker).toBeTruthy();
    expect(de.manageLinksUsageCount(1)).toBeTruthy();
    expect(de.manageLinksRemoveButtonLabel).toBeTruthy();
    expect(de.manageLinksRemoveConfirm).toBeTruthy();
    expect(de.manageLinksRemoveConfirmButton).toBeTruthy();
    expect(de.manageLinksEmpty).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC-UI-2 — usage-count string discriminating test (not a fixed-copy string)
// ---------------------------------------------------------------------------

describe('AC-UI-2 — manageLinksUsageCount', () => {
  it('en text for count 3 contains "joined via this link" AND reflects the number 3', () => {
    const text = getCopy('en').groups.manageLinksUsageCount(3);
    expect(text).toContain('joined via this link');
    expect(text).toContain('3');
  });

  it('varies with the count (a hardcoded copy would fail this)', () => {
    const groups = getCopy('en').groups;
    expect(groups.manageLinksUsageCount(1)).not.toBe(groups.manageLinksUsageCount(3));
  });

  it('de counterpart is a real, non-identical translation', () => {
    const three = 3;
    expect(getCopy('de').groups.manageLinksUsageCount(three)).not.toBe(
      getCopy('en').groups.manageLinksUsageCount(three)
    );
  });
});

// ---------------------------------------------------------------------------
// Structural / source-text assertions — the DOM-free substitute for the
// interaction sequencing and wiring guarantees this repo's no-jsdom
// convention cannot otherwise exercise (VQ-S3-002, VQ-S3-003, VQ-S3-006,
// VQ-S3-010, VQ-S3-011, VQ-S3-012, AC-UI-4, AC-UI-5, AC-UI-6, AC-UI-8).
// ---------------------------------------------------------------------------

describe('production source assertions', () => {
  it('AC-UI-4 / VQ-S3-010: contains zero occurrences of "Switch" (the former mute toggle is fully removed, not hidden)', () => {
    expect(componentSource).not.toContain('Switch');
  });

  it('renders a trashcan/delete icon-button per row (structural replacement for the removed toggle)', () => {
    expect(componentSource).toMatch(/invite-link-delete-\$\{link\.nonce\}/);
    expect(componentSource).toContain('IconButton');
  });

  it('VQ-S3-005: no residual muted-flag UI survives (no "muted" reference in the rendered component)', () => {
    // `textMuted` is an unrelated, codebase-wide Chakra color token (see
    // src/themes/schema.ts) legitimately used for secondary text throughout
    // the app — it is not the invite-link `muted` field this check targets.
    // Strip it before the substring check so the assertion still catches any
    // reintroduction of the old `link.muted` field / `updateInviteLinkMuted`
    // handler without false-failing on the color token.
    const withoutThemeToken = componentSource.replace(/textMuted/g, '');
    expect(withoutThemeToken.toLowerCase()).not.toContain('muted');
  });

  it('AC-UI-5 / AC-UI-6 / VQ-S3-006: deleteInviteLink is called from exactly one site, gated inside the confirm-accept handler', () => {
    const callSites = componentSource.match(/deleteInviteLink\(/g) ?? [];
    expect(callSites).toHaveLength(1);

    const handlerMatch = componentSource.match(/handleConfirmDelete[\s\S]*?\{([\s\S]*?)\n\s*\}/);
    expect(handlerMatch).toBeTruthy();
    expect(handlerMatch![1]).toContain('deleteInviteLink(');

    // The icon button that OPENS the confirmation must not itself call delete —
    // it must only flip local confirm state.
    const openIdx = componentSource.indexOf('invite-link-delete-${link.nonce}');
    const nearOpenButton = componentSource.slice(Math.max(0, openIdx - 300), openIdx + 50);
    expect(nearOpenButton).not.toContain('deleteInviteLink(');
    expect(nearOpenButton).toContain('setConfirmingNonce');
  });

  it('AC-UI-5: renders the confirmation prompt copy key before the row is removable', () => {
    expect(componentSource).toContain('manageLinksRemoveConfirm');
    expect(componentSource).toContain('confirmingNonce');
  });

  it('VQ-S3-003: runs no expiry sweep of its own; the only notifications-module touch is the sanctioned initInviteExpiries badge re-derive on delete', () => {
    // The expired-row styling tick (AC-UI-8) is a self-contained local
    // setInterval — the modal must never import or drive the expiry SWEEP.
    expect(componentSource).not.toMatch(/inviteExpirySweep/);
    // Gate-remediation (Codex round 6, Finding 2): deleting an expired+notified
    // link must re-derive the unread badge immediately, else the bell shows a
    // stale expiry until the next periodic cycle. architecture.md's boundary
    // rules sanction touching the inviteExpiries slice ONLY through its exported
    // functions — the modal calls exactly one, initInviteExpiries, and nothing
    // else from unreadStore (no direct slice mutation, no markInviteExpiriesRead).
    const unreadStoreImportBlocks = componentSource.match(
      /import\s*\{([^}]*)\}\s*from\s*'@\/src\/lib\/unreadStore'/g,
    ) ?? [];
    expect(unreadStoreImportBlocks.length).toBe(1);
    expect(unreadStoreImportBlocks[0]).toMatch(/initInviteExpiries/);
    expect(unreadStoreImportBlocks[0]).not.toMatch(/incrementInviteExpiry|markInviteExpiriesRead|useUnreadCounts/);
  });

  it('AC-UI-8: drives its own periodic re-render locally via setInterval', () => {
    expect(componentSource).toMatch(/setInterval\(/);
    expect(componentSource).toMatch(/clearInterval\(/);
  });

  it('VQ-S3-002: does not reimplement expiry logic — imports and calls the real isExpired', () => {
    expect(componentSource).toMatch(/import\s*\{[^}]*\bisExpired\b[^}]*\}\s*from\s*'@\/src\/lib\/marmot\/inviteLinkStorage'/);
    expect(componentSource).toMatch(/isExpired\(link,\s*now\)/);
  });

  it('AC-UI-7: gates on the isEmptyLinksList predicate and renders the translated empty-state key', () => {
    expect(componentSource).toContain('isEmptyLinksList(links)');
    expect(componentSource).toContain('manageLinksEmpty');
  });

  it('VQ-S3-006: defensively defaults a legacy usageCount to 0 rather than rendering undefined/NaN', () => {
    expect(componentSource).toMatch(/usageCount\s*\?\?\s*0/);
  });
});
