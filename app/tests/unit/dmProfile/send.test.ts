/**
 * send.test.ts — unit tests for app/src/lib/dmProfile/send.ts (epic:
 * direct-contact-profile-exchange, story 03, send). Covers AC-PROF-2,
 * AC-PROF-8 (privacy — SECURITY-CRITICAL), AC-PROF-12.
 *
 * Conventions mirrored from precedent in this repo (pairingAck.test.ts):
 *   - crypto.subtle polyfill + REAL nostr-tools crypto — sealAndWrap and
 *     unwrapAndOpen are exercised for real, never mocked, so a test would
 *     fail if send.ts accidentally signed the rumor, used the wrong kind,
 *     or wrapped for more than one recipient.
 *   - `vi.spyOn(NDKEvent.prototype, 'publish')` to intercept the outbound
 *     relay call without touching NDK itself.
 *   - `vi.spyOn(directMessagesModule, 'sealAndWrap')` (call-through, not
 *     mocked) to inspect the EXACT rumor object handed to sealAndWrap,
 *     per the project-memory mocking-discipline rule: never mock the
 *     helper at the SUT call site in a way that would hide real behavior.
 *   - ensureAvatar / hasShareableName / encodeProfileAnnounce /
 *     encodeProfileRequest are exercised for REAL (never mocked) — only the
 *     NDK publish boundary is mocked.
 */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { NDKEvent } from '@nostr-dev-kit/ndk';

import * as directMessagesModule from '@/src/lib/directMessages';
const { unwrapAndOpen } = directMessagesModule;

import {
  DM_PROFILE_REQUEST_KIND,
  DM_PROFILE_ANNOUNCE_KIND,
  parseProfileRequest,
  parseProfileAnnounce,
} from '@/src/lib/dmProfile/kinds';

import {
  sendProfileRequest,
  sendProfileAnnounce,
  type SendProfileRequestResult,
  type SendProfileAnnounceResult,
} from '@/src/lib/dmProfile/send';

import type { UserProfile } from '@/src/types';

// ── Key helpers ──────────────────────────────────────────────────────────

function makeIdentity() {
  const priv = generateSecretKey();
  const privHex = bytesToHex(priv);
  const pubHex = getPublicKey(priv);
  return { privHex, pubHex };
}

/** Capture the single NDKEvent published during a test, via publish() spy. */
function captureNextPublish(): { get: () => NDKEvent | undefined } {
  let published: NDKEvent | undefined;
  vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
    published = this;
    return new Set() as never;
  });
  return { get: () => published };
}

function rawEventOf(event: NDKEvent): { kind: number; pubkey: string; tags: string[][]; content: string } {
  return (event as unknown as { rawEvent: () => { kind: number; pubkey: string; tags: string[][]; content: string } }).rawEvent();
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── sendProfileRequest (AC-PROF-2 request half, AC-PROF-12 request half) ──

describe('sendProfileRequest', () => {
  it('sends exactly one gift-wrapped kind=DM_PROFILE_REQUEST_KIND rumor addressed to the recipient, with no `since`', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    const capture = captureNextPublish();

    const result: SendProfileRequestResult = await sendProfileRequest({
      ndk: {} as never,
      recipientPubkeyHex: owner.pubHex,
      keys: { ownPubkeyHex: requester.pubHex, ownPrivateKeyHex: requester.privHex },
    });

    expect(result).toEqual({ recipientPubkeyHex: owner.pubHex, result: 'sent' });
    expect(NDKEvent.prototype.publish).toHaveBeenCalledTimes(1);
    const published = capture.get();
    expect(published).toBeDefined();

    const rawWrap = rawEventOf(published!);
    expect(rawWrap.kind).toBe(1059);
    // Addressed to exactly ONE recipient pubkey — never a broadcast, never a list.
    const pTags = rawWrap.tags.filter((t) => t[0] === 'p');
    expect(pTags).toEqual([['p', owner.pubHex]]);

    // Decode through the REAL codec/unwrap, never a hand-rolled shortcut.
    const recoveredRumor = await unwrapAndOpen(rawWrap as never, owner.privHex);
    expect(recoveredRumor.kind).toBe(DM_PROFILE_REQUEST_KIND);
    expect(recoveredRumor.pubkey).toBe(requester.pubHex);
    expect((recoveredRumor as { sig?: string }).sig).toBeUndefined();

    const parsed = parseProfileRequest(recoveredRumor.content);
    expect(parsed).toEqual({ ok: true, value: { type: 'profile-request' } });
  });

  it('passes `since` through to the codec when provided', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    captureNextPublish();
    const since = '2026-01-01T00:00:00.000Z';

    await sendProfileRequest({
      ndk: {} as never,
      recipientPubkeyHex: owner.pubHex,
      keys: { ownPubkeyHex: requester.pubHex, ownPrivateKeyHex: requester.privHex },
      since,
    });

    const spy = vi.mocked(NDKEvent.prototype.publish);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('requires no local nickname/avatar of any kind — succeeds with none set at all (AC-PROF-12 request half)', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    captureNextPublish();

    // sendProfileRequest's signature has no localProfile param whatsoever —
    // this call is the entire proof: it type-checks and succeeds without
    // ever mentioning a nickname or avatar.
    const result = await sendProfileRequest({
      ndk: {} as never,
      recipientPubkeyHex: owner.pubHex,
      keys: { ownPubkeyHex: requester.pubHex, ownPrivateKeyHex: requester.privHex },
    });

    expect(result.result).toBe('sent');
  });

  it('throws (does not return "queued-for-retry") on a malformed recipientPubkeyHex — a caller bug, not a transient condition', async () => {
    const requester = makeIdentity();
    await expect(
      sendProfileRequest({
        ndk: {} as never,
        recipientPubkeyHex: 'not-hex',
        keys: { ownPubkeyHex: requester.pubHex, ownPrivateKeyHex: requester.privHex },
      }),
    ).rejects.toThrow();
  });

  it('returns "queued-for-retry" (never throws) when the relay publish fails', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    vi.spyOn(NDKEvent.prototype, 'publish').mockRejectedValue(new Error('offline'));

    const result = await sendProfileRequest({
      ndk: {} as never,
      recipientPubkeyHex: owner.pubHex,
      keys: { ownPubkeyHex: requester.pubHex, ownPrivateKeyHex: requester.privHex },
    });

    expect(result).toEqual({ recipientPubkeyHex: owner.pubHex, result: 'queued-for-retry' });
  });

  // ── Gate-remediation (Stage-1 review, sev 4): defensive case-folding ────

  it('a mixed/upper-case recipientPubkeyHex is defensively lowercased in the wrap\'s "p" tag (case-fold, sev 4)', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    const capture = captureNextPublish();
    const mixedCaseRecipient = owner.pubHex.slice(0, 32).toUpperCase() + owner.pubHex.slice(32);
    // Sanity: the mixed-case variant is genuinely different from, but still
    // case-insensitively equal to, the real recipient — otherwise this test
    // would not distinguish "lowercased" from "passed through verbatim".
    expect(mixedCaseRecipient).not.toBe(owner.pubHex);
    expect(mixedCaseRecipient.toLowerCase()).toBe(owner.pubHex);

    const result = await sendProfileRequest({
      ndk: {} as never,
      recipientPubkeyHex: mixedCaseRecipient,
      keys: { ownPubkeyHex: requester.pubHex, ownPrivateKeyHex: requester.privHex },
    });

    expect(result.result).toBe('sent');
    const rawWrap = rawEventOf(capture.get()!);
    const pTags = rawWrap.tags.filter((t) => t[0] === 'p');
    // The published wrap's 'p' tag must be lowercase, matching the
    // recipient's lowercased '#p' subscription filter (story 05) — an
    // un-folded tag would be silently undeliverable.
    expect(pTags).toEqual([['p', owner.pubHex]]);
    expect(pTags[0][1]).toBe(pTags[0][1].toLowerCase());
  });

  // ── Gate-remediation (Stage-1 review, sev 2): own-key hex validated pre-try ──

  it('throws (does not return "queued-for-retry") on a malformed keys.ownPrivateKeyHex — a caller bug, not a transient condition', async () => {
    const owner = makeIdentity();
    await expect(
      sendProfileRequest({
        ndk: {} as never,
        recipientPubkeyHex: owner.pubHex,
        keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: 'not-hex' },
      }),
    ).rejects.toThrow();
  });

  it('throws (does not return "queued-for-retry") on a malformed keys.ownPubkeyHex — a caller bug, not a transient condition', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    await expect(
      sendProfileRequest({
        ndk: {} as never,
        recipientPubkeyHex: owner.pubHex,
        keys: { ownPubkeyHex: 'not-hex', ownPrivateKeyHex: requester.privHex },
      }),
    ).rejects.toThrow();
  });
});

// ── sendProfileAnnounce (AC-PROF-2 answer half) ──────────────────────────

describe('sendProfileAnnounce', () => {
  it('sends exactly one gift-wrapped kind=DM_PROFILE_ANNOUNCE_KIND rumor with {nickname, avatar, updatedAt}', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    const capture = captureNextPublish();

    const localProfile: UserProfile = { nickname: 'Alice', avatar: { imageUrl: 'https://cdn.example/alice.png' } };

    const result: SendProfileAnnounceResult = await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: requester.pubHex,
      keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
      localProfile,
    });

    expect(result).toEqual({ recipientPubkeyHex: requester.pubHex, result: 'sent' });
    expect(NDKEvent.prototype.publish).toHaveBeenCalledTimes(1);
    const published = capture.get();
    const rawWrap = rawEventOf(published!);
    expect(rawWrap.kind).toBe(1059);
    const pTags = rawWrap.tags.filter((t) => t[0] === 'p');
    expect(pTags).toEqual([['p', requester.pubHex]]);

    const recoveredRumor = await unwrapAndOpen(rawWrap as never, requester.privHex);
    expect(recoveredRumor.kind).toBe(DM_PROFILE_ANNOUNCE_KIND);
    expect(recoveredRumor.pubkey).toBe(owner.pubHex);

    const parsed = parseProfileAnnounce(recoveredRumor.content);
    if (!parsed.ok) throw new Error(`announce failed to parse: ${parsed.reason}`);
    expect(parsed.value.nickname).toBe('Alice');
    expect(parsed.value.avatar.imageUrl).toBe('https://cdn.example/alice.png');
  });

  // ── (b) ensureAvatar is genuinely run — never a no-op stub ─────────────

  it('AC-PROF-2: runs ensureAvatar on a profile with NO avatar set — the announce NEVER carries avatar:null', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    captureNextPublish();

    const localProfile: UserProfile = { nickname: 'Bob', avatar: null };

    const result = await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: requester.pubHex,
      keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
      localProfile,
    });
    expect(result.result).toBe('sent');

    const spy = vi.mocked(NDKEvent.prototype.publish);
    const published = (spy.mock.instances[0] as unknown) as NDKEvent;
    const rawWrap = rawEventOf(published);
    const recoveredRumor = await unwrapAndOpen(rawWrap as never, requester.privHex);
    const parsed = parseProfileAnnounce(recoveredRumor.content);

    if (!parsed.ok) throw new Error(`announce failed to parse: ${parsed.reason}`);
    // A genuinely backfilled avatar — non-null, non-empty, real scheme —
    // never the input's null.
    expect(parsed.value.avatar).toBeDefined();
    expect(parsed.value.avatar.imageUrl).toEqual(expect.any(String));
    expect(parsed.value.avatar.imageUrl.length).toBeGreaterThan(0);
    expect(parsed.value.avatar.imageUrl).toMatch(/^(?:https:\/\/|\/\/)/);
  });

  // ── (c) updatedAt is answer-time, never a stale profile-edit time ─────

  it('AC-PROF-2: updatedAt is stamped at call (answer) time, never a stale prior moment', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    captureNextPublish();

    vi.useFakeTimers();
    // Simulate: the local profile was conceptually "last edited" long ago —
    // there is no updatedAt field on UserProfile itself (this module never
    // reads or threads one through), so this is modeled as the ambient
    // clock being far in the past when the profile came into being, then
    // advancing to the actual moment this function is called.
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    const localProfile: UserProfile = { nickname: 'Carol', avatar: { imageUrl: 'https://cdn.example/carol.png' } };

    const answerTime = new Date('2026-07-12T15:30:00.000Z');
    vi.setSystemTime(answerTime);

    await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: requester.pubHex,
      keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
      localProfile,
    });

    vi.useRealTimers();

    const spy = vi.mocked(NDKEvent.prototype.publish);
    const published = (spy.mock.instances[0] as unknown) as NDKEvent;
    const rawWrap = rawEventOf(published);
    const recoveredRumor = await unwrapAndOpen(rawWrap as never, requester.privHex);
    const parsed = parseProfileAnnounce(recoveredRumor.content);

    if (!parsed.ok) throw new Error(`announce failed to parse: ${parsed.reason}`);
    expect(parsed.value.updatedAt).toBe(answerTime.toISOString());
    expect(parsed.value.updatedAt).not.toBe(new Date('2020-01-01T00:00:00.000Z').toISOString());
  });

  // Future-proofing regression (VQ-S03-011/VQ-S03-014): UserProfile has no
  // updatedAt field TODAY, but nothing stops a future edit from adding one
  // (for an unrelated feature) or from carelessly spreading `...localProfile`
  // into the encode call instead of the current explicit `{nickname, avatar}`
  // literal. DOUBLE DEFENSE: (a) send.ts passes only an explicit
  // `{nickname, avatar}` literal to encodeProfileAnnounce — never a spread of
  // the caller's profile object, so an extra field on localProfile has no
  // path into the payload at all; (b) even if it did, kinds.ts#encodeProfileAnnounce
  // unconditionally overrides `updatedAt` with `new Date().toISOString()` at
  // serialization, ignoring any caller-supplied value. This test proves both
  // layers hold by feeding a localProfile that carries a hypothetical stale
  // `updatedAt`/`lastEdited`-shaped field and asserting the wrapped announce
  // still carries answer-time, not that stale value. A future edit that
  // reintroduces `...params.localProfile` (or otherwise threads a stored
  // timestamp through) would make this test fail.
  it('AC-PROF-2/VQ-S03-011: a localProfile carrying a hypothetical stale updatedAt field is STILL ignored — double defense (no spread + codec override)', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    captureNextPublish();

    vi.useFakeTimers();
    const answerTime = new Date('2026-07-12T15:30:00.000Z');
    vi.setSystemTime(answerTime);

    // Simulates a hypothetical FUTURE UserProfile shape that carries its own
    // last-edit timestamp — not part of today's real UserProfile type, hence
    // the cast. If send.ts ever regressed to spreading `...localProfile` into
    // the encode call, this stale value would leak into the wire payload.
    const localProfileWithStaleTimestamp = {
      nickname: 'Mona',
      avatar: { imageUrl: 'https://cdn.example/mona.png' },
      updatedAt: '2020-01-01T00:00:00.000Z',
    } as UserProfile & { updatedAt: string };

    await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: requester.pubHex,
      keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
      localProfile: localProfileWithStaleTimestamp,
    });

    vi.useRealTimers();

    const spy = vi.mocked(NDKEvent.prototype.publish);
    const published = (spy.mock.instances[0] as unknown) as NDKEvent;
    const rawWrap = rawEventOf(published);
    const recoveredRumor = await unwrapAndOpen(rawWrap as never, requester.privHex);
    const parsed = parseProfileAnnounce(recoveredRumor.content);

    if (!parsed.ok) throw new Error(`announce failed to parse: ${parsed.reason}`);
    expect(parsed.value.updatedAt).toBe(answerTime.toISOString());
    expect(parsed.value.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  // ── (d) nameless owner defers (AC-PROF-12) ─────────────────────────────

  it('AC-PROF-12: hasShareableName===false -> "deferred-nameless", NOTHING published (zero I/O)', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    vi.spyOn(NDKEvent.prototype, 'publish');
    const sealAndWrapSpy = vi.spyOn(directMessagesModule, 'sealAndWrap');

    const localProfile: UserProfile = { nickname: '   ', avatar: null }; // whitespace-only == unset

    const result = await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: requester.pubHex,
      keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
      localProfile,
    });

    expect(result).toEqual({ recipientPubkeyHex: requester.pubHex, result: 'deferred-nameless' });
    expect(NDKEvent.prototype.publish).not.toHaveBeenCalled();
    // Not merely "published nothing" — sealAndWrap itself was never reached,
    // proving the gate runs before ensureAvatar/encode/wrap, not just before
    // the final publish call (VQ-S03-005/009).
    expect(sealAndWrapSpy).not.toHaveBeenCalled();
  });

  it('an EMPTY nickname (never set) also defers — not just whitespace', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    vi.spyOn(NDKEvent.prototype, 'publish');

    const result = await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: requester.pubHex,
      keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
      localProfile: { nickname: '', avatar: null },
    });

    expect(result.result).toBe('deferred-nameless');
    expect(NDKEvent.prototype.publish).not.toHaveBeenCalled();
  });

  // ── (e) privacy — unsigned, single-recipient, not a publishable kind-0 ─

  describe('AC-PROF-8 (privacy — SECURITY-CRITICAL)', () => {
    it('the published event is a kind-1059 gift wrap, never a kind-0, addressed to exactly one recipient', async () => {
      const owner = makeIdentity();
      const requester = makeIdentity();
      const capture = captureNextPublish();

      await sendProfileAnnounce({
        ndk: {} as never,
        recipientPubkeyHex: requester.pubHex,
        keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
        localProfile: { nickname: 'Dave', avatar: { imageUrl: 'https://cdn.example/dave.png' } },
      });

      const rawWrap = rawEventOf(capture.get()!);
      expect(rawWrap.kind).toBe(1059);
      expect(rawWrap.kind).not.toBe(0);
      const pTags = rawWrap.tags.filter((t) => t[0] === 'p');
      expect(pTags).toHaveLength(1);
      expect(pTags[0][1]).toBe(requester.pubHex);
    });

    it('the inner announce rumor is UNSIGNED — no `sig`, not a valid standalone kind-0 event', async () => {
      const owner = makeIdentity();
      const requester = makeIdentity();
      const capture = captureNextPublish();
      const sealAndWrapSpy = vi.spyOn(directMessagesModule, 'sealAndWrap');

      await sendProfileAnnounce({
        ndk: {} as never,
        recipientPubkeyHex: requester.pubHex,
        keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
        localProfile: { nickname: 'Erin', avatar: { imageUrl: 'https://cdn.example/erin.png' } },
      });

      // Inspect the EXACT rumor object handed to sealAndWrap (never a mocked
      // stand-in) — it must carry no `sig` field at all.
      expect(sealAndWrapSpy).toHaveBeenCalledTimes(1);
      const rumorArg = sealAndWrapSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(rumorArg.kind).toBe(DM_PROFILE_ANNOUNCE_KIND);
      expect(rumorArg.sig).toBeUndefined();
      // Not a well-formed signed nostr event (a real kind-0 needs an id+sig
      // pair that verifies) — no signature was ever computed for this rumor.
      expect('sig' in rumorArg).toBe(false);

      // Confirm via the round-tripped, authenticated rumor too.
      const rawWrap = rawEventOf(capture.get()!);
      const recoveredRumor = await unwrapAndOpen(rawWrap as never, requester.privHex);
      expect((recoveredRumor as { sig?: string }).sig).toBeUndefined();
    });

    it('sendProfileAnnounce never publishes a kind-0 event under any circumstance', async () => {
      const owner = makeIdentity();
      const requester = makeIdentity();
      const publishedKinds: number[] = [];
      vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
        publishedKinds.push(rawEventOf(this).kind);
        return new Set() as never;
      });

      await sendProfileAnnounce({
        ndk: {} as never,
        recipientPubkeyHex: requester.pubHex,
        keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
        localProfile: { nickname: 'Fay', avatar: { imageUrl: 'https://cdn.example/fay.png' } },
      });

      expect(publishedKinds).not.toContain(0);
      expect(publishedKinds).toEqual([1059]);
    });

    it('sendProfileRequest never publishes a kind-0 event under any circumstance', async () => {
      const owner = makeIdentity();
      const requester = makeIdentity();
      const publishedKinds: number[] = [];
      vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
        publishedKinds.push(rawEventOf(this).kind);
        return new Set() as never;
      });

      await sendProfileRequest({
        ndk: {} as never,
        recipientPubkeyHex: owner.pubHex,
        keys: { ownPubkeyHex: requester.pubHex, ownPrivateKeyHex: requester.privHex },
      });

      expect(publishedKinds).not.toContain(0);
      expect(publishedKinds).toEqual([1059]);
    });
  });

  // ── (f) publish-failure error posture ──────────────────────────────────

  it('returns "queued-for-retry" (never throws) when the relay publish fails', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    vi.spyOn(NDKEvent.prototype, 'publish').mockRejectedValue(new Error('offline'));

    const result = await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: requester.pubHex,
      keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
      localProfile: { nickname: 'Gina', avatar: { imageUrl: 'https://cdn.example/gina.png' } },
    });

    expect(result).toEqual({ recipientPubkeyHex: requester.pubHex, result: 'queued-for-retry' });
  });

  it('throws (does not return "queued-for-retry") on a malformed recipientPubkeyHex — a caller bug, not a transient condition', async () => {
    const owner = makeIdentity();
    await expect(
      sendProfileAnnounce({
        ndk: {} as never,
        recipientPubkeyHex: 'not-hex',
        keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
        localProfile: { nickname: 'Hank', avatar: { imageUrl: 'https://cdn.example/hank.png' } },
      }),
    ).rejects.toThrow();
  });

  // Mutation-gap closure (mirrors pairingAck.test.ts precedent): the hex
  // guard is ANCHORED (/^…$/). A 64-hex prefix followed by a trailing
  // character must still be rejected.
  it('throws on an over-length recipientPubkeyHex (valid 64-hex prefix + trailing char) — anchor is load-bearing', async () => {
    const owner = makeIdentity();
    await expect(
      sendProfileAnnounce({
        ndk: {} as never,
        recipientPubkeyHex: 'a'.repeat(64) + '0',
        keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
        localProfile: { nickname: 'Ivy', avatar: { imageUrl: 'https://cdn.example/ivy.png' } },
      }),
    ).rejects.toThrow();
  });

  // ── Gate-remediation (Stage-1 review, sev 4): defensive case-folding ────

  it('a mixed/upper-case recipientPubkeyHex is defensively lowercased in the wrap\'s "p" tag (case-fold, sev 4)', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    const capture = captureNextPublish();
    const mixedCaseRecipient = requester.pubHex.slice(0, 32).toUpperCase() + requester.pubHex.slice(32);
    expect(mixedCaseRecipient).not.toBe(requester.pubHex);
    expect(mixedCaseRecipient.toLowerCase()).toBe(requester.pubHex);

    const result = await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: mixedCaseRecipient,
      keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: owner.privHex },
      localProfile: { nickname: 'Jill', avatar: { imageUrl: 'https://cdn.example/jill.png' } },
    });

    expect(result.result).toBe('sent');
    const rawWrap = rawEventOf(capture.get()!);
    const pTags = rawWrap.tags.filter((t) => t[0] === 'p');
    // The published wrap's 'p' tag must be lowercase, matching the
    // recipient's lowercased '#p' subscription filter (story 05) — an
    // un-folded tag would be silently undeliverable and self-heal
    // (AC-PROF-7) would never converge for that contact.
    expect(pTags).toEqual([['p', requester.pubHex]]);
    expect(pTags[0][1]).toBe(pTags[0][1].toLowerCase());
  });

  // ── Gate-remediation (Stage-1 review, sev 2): own-key hex validated pre-try ──

  it('throws (does not return "queued-for-retry") on a malformed keys.ownPrivateKeyHex — a caller bug, not a transient condition', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    await expect(
      sendProfileAnnounce({
        ndk: {} as never,
        recipientPubkeyHex: requester.pubHex,
        keys: { ownPubkeyHex: owner.pubHex, ownPrivateKeyHex: 'not-hex' },
        localProfile: { nickname: 'Kara', avatar: { imageUrl: 'https://cdn.example/kara.png' } },
      }),
    ).rejects.toThrow();
  });

  it('throws (does not return "queued-for-retry") on a malformed keys.ownPubkeyHex — a caller bug, not a transient condition', async () => {
    const owner = makeIdentity();
    const requester = makeIdentity();
    await expect(
      sendProfileAnnounce({
        ndk: {} as never,
        recipientPubkeyHex: requester.pubHex,
        keys: { ownPubkeyHex: 'not-hex', ownPrivateKeyHex: owner.privHex },
        localProfile: { nickname: 'Liam', avatar: { imageUrl: 'https://cdn.example/liam.png' } },
      }),
    ).rejects.toThrow();
  });
});
