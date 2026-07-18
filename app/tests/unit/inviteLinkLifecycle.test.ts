import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InviteLink } from '@/src/lib/marmot/inviteLinkStorage';

// Mock idb-keyval — in-memory store (mirrors the existing manageInviteLinksModal.test.ts convention).
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

const {
  DAY_MS,
  isExpired,
  buildNewInviteLink,
  saveInviteLink,
  getInviteLink,
  loadAllInviteLinks,
  incrementInviteLinkUsage,
  markInviteLinkExpiryNotified,
  markInviteLinkExpiryAcknowledged,
  migrateInviteLinks,
  deleteInviteLink,
  clearInviteLinksForGroup,
  clearAllInviteLinks,
} = await import('@/src/lib/marmot/inviteLinkStorage');
const { get: idbGet } = await import('idb-keyval');

/** A fully-shaped migrated link, for tests that need every field explicit. */
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

/**
 * A legacy pre-migration record — literally missing the four new fields, not
 * merely holding `undefined` values for them. Constructed by omitting the
 * keys entirely (not by setting them to `undefined`), since a real record
 * saved before this feature existed never had the keys at all.
 */
function makeLegacyLink(overrides: Partial<Pick<InviteLink, 'nonce' | 'groupId' | 'createdAt' | 'label' | 'muted'>> = {}) {
  return {
    nonce: 'legacy-1',
    groupId: 'group-1',
    createdAt: 1_700_000_000_000,
    muted: false,
    ...overrides,
  };
}

async function seed(nonce: string, link: unknown): Promise<void> {
  store.set(nonce, link);
}

describe('invite link lifecycle — S1', () => {
  beforeEach(() => {
    store.clear();
  });

  describe('AC-STRUCT-1 — DAY_MS', () => {
    it('equals 86_400_000', () => {
      expect(DAY_MS).toBe(86_400_000);
    });
  });

  describe('AC-MODEL-1 — isExpired boundary, expiresAt-carrying record', () => {
    const link = makeLink({ createdAt: 1000, expiresAt: 2000 });

    it('is true when now === effectiveExpiry', () => {
      expect(isExpired(link, 2000)).toBe(true);
    });

    it('is true when now > effectiveExpiry', () => {
      expect(isExpired(link, 2001)).toBe(true);
    });

    it('is false when now === effectiveExpiry - 1', () => {
      expect(isExpired(link, 1999)).toBe(false);
    });
  });

  describe('AC-MODEL-1 — isExpired boundary, legacy record (no expiresAt field at all)', () => {
    const legacy = { createdAt: 1000 } as Pick<InviteLink, 'expiresAt' | 'createdAt'>;
    const effectiveExpiry = 1000 + DAY_MS;

    it('is true when now === createdAt + DAY_MS', () => {
      expect(isExpired(legacy, effectiveExpiry)).toBe(true);
    });

    it('is true when now > createdAt + DAY_MS', () => {
      expect(isExpired(legacy, effectiveExpiry + 1)).toBe(true);
    });

    it('is false when now === createdAt + DAY_MS - 1', () => {
      expect(isExpired(legacy, effectiveExpiry - 1)).toBe(false);
    });

    it('does not depend on migrateInviteLinks having run first (fresh legacy read)', async () => {
      // No migration call here at all — isExpired must be correct on the
      // very first read of a record straight out of storage.
      await seed('n-fresh-legacy', makeLegacyLink({ nonce: 'n-fresh-legacy', createdAt: 1000 }));
      const raw = (await getInviteLink('n-fresh-legacy')) as unknown as Pick<InviteLink, 'expiresAt' | 'createdAt'>;
      expect(isExpired(raw, 1000 + DAY_MS)).toBe(true);
      expect(isExpired(raw, 1000 + DAY_MS - 1)).toBe(false);
    });
  });

  describe('AC-MODEL-2 — buildNewInviteLink (creation-time defaults)', () => {
    it('sets expiresAt = createdAt + DAY_MS, usageCount = 0, both flags false', () => {
      const link = buildNewInviteLink({ nonce: 'n1', groupId: 'g1', createdAt: 5_000, label: 'Class chat' });
      expect(link.expiresAt).toBe(5_000 + DAY_MS);
      expect(link.usageCount).toBe(0);
      expect(link.expiryNotified).toBe(false);
      expect(link.expiryAcknowledged).toBe(false);
      expect(link.muted).toBe(false);
      expect(link.label).toBe('Class chat');
    });

    it('persists all four fields through saveInviteLink/getInviteLink (production write site)', async () => {
      const link = buildNewInviteLink({ nonce: 'n2', groupId: 'g1', createdAt: 9_000 });
      await saveInviteLink(link);
      const persisted = await getInviteLink('n2');
      expect(persisted).toEqual(
        expect.objectContaining({
          expiresAt: 9_000 + DAY_MS,
          usageCount: 0,
          expiryNotified: false,
          expiryAcknowledged: false,
        })
      );
    });
  });

  describe('AC-MODEL-3 — incrementInviteLinkUsage increases by exactly 1', () => {
    it('4 after seeding usageCount: 3 (not overwritten to 1)', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', usageCount: 3 }));
      await incrementInviteLinkUsage('n1');
      const link = await getInviteLink('n1');
      expect(link?.usageCount).toBe(4);
    });

    it('1 after seeding usageCount: 0', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', usageCount: 0 }));
      await incrementInviteLinkUsage('n1');
      const link = await getInviteLink('n1');
      expect(link?.usageCount).toBe(1);
    });
  });

  describe('AC-MODEL-4 — incrementInviteLinkUsage no-op on unresolved nonce', () => {
    it('resolves without throwing and leaves the record set unchanged', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1' }));
      const before = await loadAllInviteLinks();

      await expect(incrementInviteLinkUsage('unknown-nonce')).resolves.toBeUndefined();

      const after = await loadAllInviteLinks();
      expect(after).toEqual(before);
      expect(await getInviteLink('unknown-nonce')).toBeUndefined();
    });
  });

  describe('AC-MODEL-5 — markInviteLinkExpiryNotified', () => {
    it('sets expiryNotified true, leaves expiryAcknowledged/usageCount/expiresAt untouched', async () => {
      await saveInviteLink(
        makeLink({ nonce: 'n1', expiryAcknowledged: true, usageCount: 5, expiresAt: 123_456, expiryNotified: false })
      );
      await markInviteLinkExpiryNotified('n1');
      const link = await getInviteLink('n1');
      expect(link?.expiryNotified).toBe(true);
      expect(link?.expiryAcknowledged).toBe(true);
      expect(link?.usageCount).toBe(5);
      expect(link?.expiresAt).toBe(123_456);
    });

    // Gate-remediation (Codex round 6, Finding 1): the sweep uses the return
    // value to decide whether to bump the unread badge, so the stamp must
    // report true only when it actually persisted a record.
    it('returns true when it persisted a record, false when the nonce is gone', async () => {
      await saveInviteLink(makeLink({ nonce: 'present' }));
      await expect(markInviteLinkExpiryNotified('present')).resolves.toBe(true);
      await expect(markInviteLinkExpiryNotified('missing-nonce')).resolves.toBe(false);
    });
  });

  describe('AC-MODEL-6 — markInviteLinkExpiryAcknowledged', () => {
    it('sets expiryAcknowledged true, leaves expiryNotified/usageCount/expiresAt untouched', async () => {
      await saveInviteLink(
        makeLink({ nonce: 'n1', expiryNotified: true, usageCount: 7, expiresAt: 654_321, expiryAcknowledged: false })
      );
      await markInviteLinkExpiryAcknowledged('n1');
      const link = await getInviteLink('n1');
      expect(link?.expiryAcknowledged).toBe(true);
      expect(link?.expiryNotified).toBe(true);
      expect(link?.usageCount).toBe(7);
      expect(link?.expiresAt).toBe(654_321);
    });
  });

  describe('concurrency — incrementInviteLinkUsage lock (mechanism-level; full AC-INV-5 property is S2/S5 territory)', () => {
    it('serializes N concurrent increments against the same nonce with no lost update', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', usageCount: 0 }));
      await Promise.all(Array.from({ length: 10 }, () => incrementInviteLinkUsage('n1')));
      const link = await getInviteLink('n1');
      expect(link?.usageCount).toBe(10);
    });
  });

  // ---------------------------------------------------------------------
  // Migration
  // ---------------------------------------------------------------------

  describe('AC-MIGRATE-1 — expiresAt backfill vs preserved', () => {
    it('backfills a legacy record missing expiresAt to createdAt + DAY_MS', async () => {
      await seed('legacy', makeLegacyLink({ nonce: 'legacy', createdAt: 1000 }));
      await migrateInviteLinks(500); // not-yet-expired at migration time
      const link = await getInviteLink('legacy');
      expect(link?.expiresAt).toBe(1000 + DAY_MS);
    });

    it('leaves a non-standard, already-present expiresAt byte-for-byte unchanged', async () => {
      const customExpiresAt = 999_999_999; // deliberately NOT createdAt + DAY_MS
      await saveInviteLink(makeLink({ nonce: 'custom', createdAt: 1000, expiresAt: customExpiresAt }));
      await migrateInviteLinks(500);
      const link = await getInviteLink('custom');
      expect(link?.expiresAt).toBe(customExpiresAt);
    });
  });

  describe('AC-MIGRATE-2 — usageCount/flags default only when missing', () => {
    it('defaults usageCount/expiryNotified/expiryAcknowledged to 0/false/false when missing', async () => {
      await seed('legacy', makeLegacyLink({ nonce: 'legacy', createdAt: 1000 }));
      await migrateInviteLinks(500);
      const link = await getInviteLink('legacy');
      expect(link?.usageCount).toBe(0);
      expect(link?.expiryNotified).toBe(false);
      expect(link?.expiryAcknowledged).toBe(false);
    });

    it('does not overwrite already-present truthy/non-zero values', async () => {
      // Missing only expiresAt, but usageCount/flags already present and non-default.
      await seed('mixed', {
        ...makeLegacyLink({ nonce: 'mixed', createdAt: 1000 }),
        usageCount: 7,
        expiryNotified: true,
        expiryAcknowledged: true,
      });
      await migrateInviteLinks(500);
      const link = await getInviteLink('mixed');
      expect(link?.usageCount).toBe(7);
      expect(link?.expiryNotified).toBe(true);
      expect(link?.expiryAcknowledged).toBe(true);
    });
  });

  describe('AC-MIGRATE-3 — stamps expiryNotified=true for legacy records already expired post-backfill', () => {
    it('stamps true when createdAt + DAY_MS <= now (backfilled value drives it, not a pre-existing expiresAt)', async () => {
      const createdAt = 1000;
      const now = createdAt + DAY_MS; // exactly at the backfilled boundary
      await seed('legacy', makeLegacyLink({ nonce: 'legacy', createdAt }));
      await migrateInviteLinks(now);
      const link = await getInviteLink('legacy');
      expect(link?.expiresAt).toBe(createdAt + DAY_MS);
      expect(link?.expiryNotified).toBe(true);
      // Gate-remediation (Finding 1): suppression means "notified AND
      // dismissed" — a suppressed link must never surface an unread badge.
      expect(link?.expiryAcknowledged).toBe(true);
    });
  });

  describe('AC-MIGRATE-4 — leaves expiryNotified=false for legacy records not yet expired post-backfill', () => {
    it('leaves false when createdAt + DAY_MS > now', async () => {
      const createdAt = 1000;
      const now = createdAt + DAY_MS - 1; // one ms before the boundary
      await seed('legacy', makeLegacyLink({ nonce: 'legacy', createdAt }));
      await migrateInviteLinks(now);
      const link = await getInviteLink('legacy');
      expect(link?.expiryNotified).toBe(false);
    });
  });

  describe('AC-MIGRATE-5 — muted records: forced expiry + clamp regardless of future expiresAt', () => {
    it('clamps expiresAt to now and stamps expiryNotified=true even when the un-clamped expiry is still future', async () => {
      const now = 5000;
      const futureExpiresAt = now + 10_000; // well after `now` — would NOT otherwise be expired
      await saveInviteLink(
        makeLink({ nonce: 'muted-1', createdAt: 1000, expiresAt: futureExpiresAt, muted: true, expiryNotified: false })
      );
      await migrateInviteLinks(now);
      const link = await getInviteLink('muted-1');
      expect(link?.expiresAt).toBe(now);
      expect(link?.expiryNotified).toBe(true);
      // Gate-remediation (Finding 1): suppression means "notified AND
      // dismissed" — a suppressed link must never surface an unread badge.
      expect(link?.expiryAcknowledged).toBe(true);
    });

    it('also applies to a legacy muted record missing expiresAt entirely', async () => {
      const now = 5000;
      await seed('muted-legacy', makeLegacyLink({ nonce: 'muted-legacy', createdAt: 1000, muted: true }));
      await migrateInviteLinks(now);
      const link = await getInviteLink('muted-legacy');
      // effectiveExpiry backfilled = 1000 + DAY_MS, which is >> now, so the clamp must win.
      expect(link?.expiresAt).toBe(now);
      expect(link?.expiryNotified).toBe(true);
      expect(link?.expiryAcknowledged).toBe(true);
    });
  });

  describe('AC-MIGRATE-6 — idempotency of a single (sequential) re-invocation', () => {
    it('a second call over an already-migrated mixed store changes nothing, at the same now', async () => {
      await seed('legacy-expired', makeLegacyLink({ nonce: 'legacy-expired', createdAt: 1000 }));
      await seed('legacy-fresh', makeLegacyLink({ nonce: 'legacy-fresh', createdAt: 9_000_000 }));
      await saveInviteLink(makeLink({ nonce: 'already-migrated', createdAt: 1000, expiresAt: 1000 + DAY_MS }));
      await saveInviteLink(makeLink({ nonce: 'muted', createdAt: 1000, expiresAt: 1000 + DAY_MS, muted: true }));

      const now = 1000 + DAY_MS + 1;
      await migrateInviteLinks(now);
      const afterFirst = (await loadAllInviteLinks()).slice().sort((a, b) => a.nonce.localeCompare(b.nonce));

      await migrateInviteLinks(now);
      const afterSecond = (await loadAllInviteLinks()).slice().sort((a, b) => a.nonce.localeCompare(b.nonce));

      expect(afterSecond).toEqual(afterFirst);
    });

    it('a second call at a LATER now still changes nothing (the sweep-interference guard)', async () => {
      await seed('legacy-expired', makeLegacyLink({ nonce: 'legacy-expired', createdAt: 1000 }));
      await saveInviteLink(makeLink({ nonce: 'muted', createdAt: 1000, expiresAt: 1000 + DAY_MS, muted: true }));
      // A normal, fully-created (non-legacy) link that has NOT yet expired at
      // the first migration call, but WILL have expired by the second call's
      // `now`. Migration must never touch this — only the sweep may stamp
      // expiryNotified for a record that already carried its own expiresAt.
      await saveInviteLink(
        makeLink({ nonce: 'normal-not-yet-expired', createdAt: 1000, expiresAt: 5000, expiryNotified: false })
      );

      await migrateInviteLinks(2000); // before 'normal-not-yet-expired' expires
      const afterFirst = (await loadAllInviteLinks()).slice().sort((a, b) => a.nonce.localeCompare(b.nonce));

      await migrateInviteLinks(10_000); // now well past 5000 — normal link IS expired by now
      const afterSecond = (await loadAllInviteLinks()).slice().sort((a, b) => a.nonce.localeCompare(b.nonce));

      expect(afterSecond).toEqual(afterFirst);
      const normalLink = afterSecond.find((l) => l.nonce === 'normal-not-yet-expired');
      expect(normalLink?.expiryNotified).toBe(false); // still the sweep's job, not migration's
    });

    it('concurrent (same-tick) invocations dedupe onto one pass and produce the same result as one call', async () => {
      await seed('legacy-expired', makeLegacyLink({ nonce: 'legacy-expired', createdAt: 1000 }));
      const now = 1000 + DAY_MS + 1;

      await Promise.all([migrateInviteLinks(now), migrateInviteLinks(now), migrateInviteLinks(now)]);
      const link = await getInviteLink('legacy-expired');
      expect(link?.expiresAt).toBe(1000 + DAY_MS);
      expect(link?.expiryNotified).toBe(true);
      expect(link?.usageCount).toBe(0);
      // Gate-remediation (Finding 1): a legacy record already expired at
      // migration time is suppressed — notified AND acknowledged together —
      // so the derived badge for it is zero, not merely "notified but
      // unread."
      expect(link?.expiryAcknowledged).toBe(true);
    });
  });

  // ── Gate-remediation regression (Finding 2) ─────────────────────────────
  // migrateInviteLinks must not clobber a concurrent incrementInviteLinkUsage
  // on the same legacy record. Prior to the fix, migration bulk-read every
  // record via entries() up front, then wrote each migrated snapshot with a
  // raw set() bypassing the per-nonce lock — so a usageCount increment that
  // landed between the bulk read and migration's write was silently lost
  // (migration's stale snapshot reset usageCount back to 0). The fix
  // serializes migration's per-record write through the same withNonceLock
  // as incrementInviteLinkUsage and re-reads inside the lock, so whichever
  // writer acquires the nonce lock first fully completes before the other
  // starts — no update is ever lost regardless of interleaving.
  describe('AC-INV-6 — migration does not clobber a concurrent incrementInviteLinkUsage', () => {
    it('preserves a usageCount increment that lands while migration is processing the same legacy record', async () => {
      await seed('legacy-race', makeLegacyLink({ nonce: 'legacy-race', createdAt: 1000 }));
      const now = 500; // not yet expired — keeps the assertion below simple

      // Call order matters and is deliberate: incrementInviteLinkUsage FIRST,
      // migrateInviteLinks SECOND, both uninterrupted by an intervening
      // await. incrementInviteLinkUsage registers its per-nonce lock
      // synchronously; migrateInviteLinks's bulk entries() read still
      // captures the pre-increment snapshot synchronously (increment's read-
      // modify-write hasn't executed yet, only been scheduled), reproducing
      // the exact precondition from the finding — migration's bulk read is
      // stale relative to an increment that "lands while migration is still
      // processing that record." (The reverse call order also races the two
      // functions, but happens to let migration's single write land before
      // increment's read in this mock's microtask ordering, which masks the
      // bug without the fix — this ordering reproduces it reliably.)
      const incrementPromise = incrementInviteLinkUsage('legacy-race');
      const migrationPromise = migrateInviteLinks(now);

      await Promise.all([migrationPromise, incrementPromise]);

      const link = await getInviteLink('legacy-race');
      // The increment must be preserved, not clobbered back to 0...
      expect(link?.usageCount).toBe(1);
      // ...and the record must still be fully migrated.
      expect(link?.expiresAt).toBe(1000 + DAY_MS);
      expect(link?.expiryNotified).toBe(false);
      expect(link?.expiryAcknowledged).toBe(false);
    });
  });

  // ── Gate-remediation regression (Finding 2) ─────────────────────────────
  // deleteInviteLink/clearInviteLinksForGroup must not clobber a concurrent
  // incrementInviteLinkUsage on the same nonce. Prior to the fix, both
  // delete paths called the raw idb-keyval `del()` directly, bypassing the
  // per-nonce lock `incrementInviteLinkUsage` (and every other mutator)
  // serializes through. That left a window: if an increment's `get()` had
  // already read the record before an unlocked delete ran, the increment's
  // later `set()` would write the stale (pre-delete) snapshot back —
  // resurrecting a link the admin had just removed or that a group leave
  // had just purged.
  describe('Gate-remediation (Finding 2) — deletes are serialized against incrementInviteLinkUsage', () => {
    it('deleteInviteLink racing a concurrent increment never resurrects a stale record', async () => {
      await saveInviteLink(makeLink({ nonce: 'race-1', usageCount: 0 }));

      let deletePromise: Promise<void> | undefined;
      // Fire the delete exactly after increment's read resolves, before its
      // write — the precise window Finding 2 identified as unguarded when
      // deleteInviteLink bypassed the per-nonce lock. (Artificial but
      // deterministic interleaving, per VQ-S5-011's precedent elsewhere in
      // this epic's tests — a naive Promise.all races by luck otherwise,
      // since idb-keyval's mocked get/set/del resolve immediately.)
      vi.mocked(idbGet).mockImplementationOnce(async (key: string) => {
        const value = store.get(key);
        deletePromise = deleteInviteLink(key);
        return value;
      });

      const incrementPromise = incrementInviteLinkUsage('race-1');
      await incrementPromise;
      await deletePromise;

      const link = await getInviteLink('race-1');
      // The lock guarantees delete cannot execute until increment's
      // get-then-set has fully completed and released the lock — so delete
      // always runs last here and the record ends up cleanly deleted, never
      // resurrected with a stale (pre-delete) snapshot.
      expect(link).toBeUndefined();
    });

    it('clearInviteLinksForGroup racing a concurrent increment never resurrects a stale record', async () => {
      await saveInviteLink(makeLink({ nonce: 'race-2', groupId: 'group-race', usageCount: 0 }));

      let clearPromise: Promise<void> | undefined;
      vi.mocked(idbGet).mockImplementationOnce(async (key: string) => {
        const value = store.get(key);
        clearPromise = clearInviteLinksForGroup('group-race');
        return value;
      });

      const incrementPromise = incrementInviteLinkUsage('race-2');
      await incrementPromise;
      await clearPromise;

      const link = await getInviteLink('race-2');
      expect(link).toBeUndefined();
    });
  });

  // ── Gate-remediation regression (P2 finding) ────────────────────────────
  // clearAllInviteLinks must not resurrect a stale record via a concurrent
  // in-flight per-nonce RMW (e.g. the expiry sweep's
  // markInviteLinkExpiryNotified). Prior to the fix, clearAllInviteLinks
  // called the raw idb-keyval `clear()` directly, participating in NO lock —
  // if a RMW's `get` had already read the record before the unlocked clear
  // ran, the RMW's later `set` would write that stale (pre-clear) snapshot
  // back, leaving a previous identity's invite-link data on disk after an
  // account reset. The fix introduces a `clearInFlight` barrier: the clear
  // drains all in-flight per-nonce locks before it runs, and any RMW that
  // starts while a clear is in flight waits for the clear to finish first —
  // see the doc comments on `withNonceLock`/`clearAllInviteLinks` in
  // inviteLinkStorage.ts for the full ordering-hole walkthrough.
  describe('Gate-remediation (P2 finding) — clearAllInviteLinks is serialized against in-flight RMW', () => {
    it('clearAllInviteLinks racing a concurrent markInviteLinkExpiryNotified never resurrects a stale record', async () => {
      await saveInviteLink(makeLink({ nonce: 'race-clear', expiryNotified: false }));

      let clearPromise: Promise<void> | undefined;
      // Fire the clear exactly after the mark's read resolves, before its
      // write — the precise window the finding identified as unguarded when
      // clearAllInviteLinks bypassed the per-nonce lock entirely (same
      // deterministic-interleaving technique as the delete-race tests above).
      vi.mocked(idbGet).mockImplementationOnce(async (key: string) => {
        const value = store.get(key);
        clearPromise = clearAllInviteLinks();
        return value;
      });

      const markPromise = markInviteLinkExpiryNotified('race-clear');
      await markPromise;
      await clearPromise;

      // The barrier guarantees the clear cannot physically run until the
      // mark's get-then-set has fully completed and released the lock — so
      // the clear always runs last here and the store ends up genuinely
      // empty, never holding a resurrected stale record.
      const all = await loadAllInviteLinks();
      expect(all).toEqual([]);
    });
  });
});
