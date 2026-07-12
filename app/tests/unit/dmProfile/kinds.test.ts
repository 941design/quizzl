/**
 * kinds.test.ts — unit tests for app/src/lib/dmProfile/kinds.ts (Story 01, codec).
 *
 * Covers: AC-STRUCT-1 (kind constants + sentinel list), AC-STRUCT-2 (naming /
 * distinctness from marmot/profileRequestSync.ts's PROFILE_REQUEST_KIND), and
 * AC-PROF-6a (malformed-announce classification, both encoder and parser
 * halves).
 *
 * Repo convention (exploration.json "testing"): Vitest, no jsdom, no
 * fast-check. "Property tests" = hand-rolled parametric sweeps in it()
 * blocks, each annotated with the mutant it kills. The module-load
 * throw-on-collision assertion itself is not unit-tested by precedent
 * (mirrors pairingAck.ts — untestable except by source mutation + re-import);
 * this file instead asserts the two literal constant values and their
 * absence from an independently-typed sentinel list (VQ-01-007's spirit,
 * without re-importing the module under a mutated value).
 */
import { describe, it, expect } from 'vitest';
import {
  DM_PROFILE_REQUEST_KIND,
  DM_PROFILE_ANNOUNCE_KIND,
  encodeProfileRequest,
  parseProfileRequest,
  encodeProfileAnnounce,
  parseProfileAnnounce,
  type ProfileRequestPayload,
  type ProfileAnnouncePayload,
  type ProfileParseReason,
} from '@/src/lib/dmProfile/kinds';

// A batch of shape-valid-looking but semantically bogus timestamp strings
// used to sweep both parsers' updatedAt/since validation (gate-remediation
// sev 5). "zzzz" in particular is the attack case: it sorts lexicographically
// AFTER any real "2026-…" ISO string, so a loosely-validated parser would let
// a gate-passing sender win every future LWW compare in contactCache.ts
// (AC-PROF-10) and permanently pin a stale/empty avatar.
const MALFORMED_TIMESTAMPS: ReadonlyArray<[label: string, value: string]> = [
  ['non-ISO junk that sorts after real timestamps', 'zzzz'],
  ['non-date string', 'not-a-date'],
  ['out-of-range month/day/hour/minute/second', '2026-13-99T25:99:99.000Z'],
  ['epoch-seconds-as-string', '1751234567'],
  ['empty string', ''],
  ['date-only, no time component', '2026-07-12'],
  ['missing Z / offset', '2026-07-12T14:39:18.123'],
  ['calendar-invalid but shape-valid (Feb 30, renormalizes on parse)', '2026-02-30T00:00:00.000Z'],
];

// Independently-typed copy of the mandatory pre-land sentinel list (spec.md
// §4 / AC-STRUCT-1) — deliberately NOT imported from kinds.ts, so this test
// can never pass merely because it shares the same array reference as the
// source's internal (unexported) DM_PROFILE_SENTINEL_KINDS.
const INDEPENDENT_SENTINEL_KINDS = [
  444, 5, 7, 9, 13, 14, 21059, 21060, 20602,
  25050, 25051, 25052, 25053, 25054, 25055,
  10, 11, 12, 30078, 30051, 30, 0,
];

describe('dmProfile/kinds — constants (AC-STRUCT-1, AC-STRUCT-2)', () => {
  it('DM_PROFILE_REQUEST_KIND / DM_PROFILE_ANNOUNCE_KIND are the exact frozen values', () => {
    // Kills a mutant that silently renumbers either constant.
    expect(DM_PROFILE_REQUEST_KIND).toBe(21061);
    expect(DM_PROFILE_ANNOUNCE_KIND).toBe(21062);
  });

  it('neither constant collides with any entry of the independent sentinel-list copy', () => {
    // Kills a mutant that picks a colliding value for either constant —
    // proven against a list this test owns, not the module's internal copy.
    expect(INDEPENDENT_SENTINEL_KINDS).not.toContain(DM_PROFILE_REQUEST_KIND);
    expect(INDEPENDENT_SENTINEL_KINDS).not.toContain(DM_PROFILE_ANNOUNCE_KIND);
  });

  it('the two constants are distinct from each other', () => {
    // Kills a mutant that accidentally sets both constants to the same value.
    expect(DM_PROFILE_REQUEST_KIND).not.toBe(DM_PROFILE_ANNOUNCE_KIND);
  });

  it('DM_PROFILE_REQUEST_KIND is distinct from the marmot PROFILE_REQUEST_KIND=30 (AC-STRUCT-2)', async () => {
    const { PROFILE_REQUEST_KIND } = await import('@/src/lib/marmot/profileRequestSync');
    expect(PROFILE_REQUEST_KIND).toBe(30);
    expect(DM_PROFILE_REQUEST_KIND as number).not.toBe(PROFILE_REQUEST_KIND);
  });

  it('a build importing both kinds.ts and profileRequestSync.ts compiles and exposes both identifiers without collision', async () => {
    // Distinct-identifier proof (VQ-01-008): both modules import cleanly side
    // by side and their same-purpose constants remain independently addressable.
    const kinds = await import('@/src/lib/dmProfile/kinds');
    const marmot = await import('@/src/lib/marmot/profileRequestSync');
    expect(kinds.DM_PROFILE_REQUEST_KIND).toBe(21061);
    expect(marmot.PROFILE_REQUEST_KIND).toBe(30);
  });
});

describe('dmProfile/kinds — profile-request codec', () => {
  it('encode/parse round-trips without since', () => {
    const wire = encodeProfileRequest();
    const result = parseProfileRequest(wire);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const expected: ProfileRequestPayload = { type: 'profile-request' };
      expect(result.value).toEqual(expected);
      // Kills a mutant that always attaches a `since` key.
      expect('since' in result.value).toBe(false);
    }
  });

  it('encode/parse round-trips with since present', () => {
    const wire = encodeProfileRequest({ since: '2026-07-01T00:00:00.000Z' });
    const result = parseProfileRequest(wire);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ type: 'profile-request', since: '2026-07-01T00:00:00.000Z' });
    }
  });

  it('encodeProfileRequest throws on a non-string since (caller bug, not retryable)', () => {
    // Kills a mutant that silently coerces a bad `since` instead of rejecting it.
    expect(() => encodeProfileRequest({ since: 123 as unknown as string })).toThrow();
  });

  it('encodeProfileRequest throws on an empty-string since', () => {
    expect(() => encodeProfileRequest({ since: '' })).toThrow();
  });

  it.each(MALFORMED_TIMESTAMPS)('encodeProfileRequest throws on a since that is %s (%s)', (_label, since) => {
    // gate-remediation sev 5: encodeProfileRequest must not let a caller
    // (even our own send.ts) construct a request carrying a since that would
    // fail the same strict-ISO check the parser applies.
    expect(() => encodeProfileRequest({ since })).toThrow();
  });

  it.each([
    ['not valid json at all', 'invalid-json'],
    ['null', 'not-an-object'],
    ['42', 'not-an-object'],
    ['[]', 'not-an-object'],
    [JSON.stringify({ type: 'profile-announce' }), 'wrong-type'],
    [JSON.stringify({}), 'wrong-type'],
    [JSON.stringify({ type: 'profile-request', since: 123 }), 'invalid-since'],
    [JSON.stringify({ type: 'profile-request', since: '' }), 'invalid-since'],
  ])('parseProfileRequest rejects %s as %s', (content, expectedReason) => {
    // Kills mutants that accept any of these malformed shapes as ok:true, or
    // that report the wrong rejection reason.
    const result = parseProfileRequest(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(expectedReason);
    }
  });

  it.each(MALFORMED_TIMESTAMPS)(
    'parseProfileRequest rejects a since that is %s (%s) as invalid-since',
    (_label, since) => {
      // Central gate-remediation sev-5 assertion for the request side: since
      // feeds the same downstream comparisons updatedAt does, so it must be
      // held to the identical strict-ISO standard.
      const result = parseProfileRequest(JSON.stringify({ type: 'profile-request', since }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('invalid-since');
      }
    },
  );

  it('parseProfileRequest drops unexpected/extra keys (including an own "__proto__" key) rather than propagating them', () => {
    // Kills a mutant that returns the raw parsed object instead of a
    // freshly-constructed literal — would let extra/prototype-polluting
    // keys leak into the caller's payload.
    const forged = JSON.parse('{"type":"profile-request","since":"2026-01-01T00:00:00.000Z","__proto__":{"polluted":true},"extra":"nope"}');
    const result = parseProfileRequest(JSON.stringify(forged));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(['since', 'type']);
      expect((result.value as Record<string, unknown>).extra).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(result.value, 'polluted')).toBe(false);
    }
  });
});

describe('dmProfile/kinds — profile-announce codec (AC-PROF-6a)', () => {
  it('encode/parse round-trips a valid announce, stamping updatedAt at call time', () => {
    const before = Date.now();
    const wire = encodeProfileAnnounce({ nickname: 'Alice', avatar: { imageUrl: 'https://example.com/a.png' } });
    const after = Date.now();
    const result = parseProfileAnnounce(wire);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('profile-announce');
      expect(result.value.nickname).toBe('Alice');
      expect(result.value.avatar).toEqual({ imageUrl: 'https://example.com/a.png' });
      const stampedMs = new Date(result.value.updatedAt).getTime();
      // Kills a mutant that stamps updatedAt from caller input / a fixed
      // constant instead of Date.now() at serialization time.
      expect(stampedMs).toBeGreaterThanOrEqual(before);
      expect(stampedMs).toBeLessThanOrEqual(after);
    }
  });

  it('encodeProfileAnnounce ignores any caller-supplied updatedAt and always stamps its own', () => {
    const wire = encodeProfileAnnounce({
      nickname: 'Bob',
      avatar: { imageUrl: 'https://example.com/b.png' },
      // @ts-expect-error — updatedAt is not part of the encoder's input contract.
      updatedAt: '1999-01-01T00:00:00.000Z',
    });
    const parsed = JSON.parse(wire) as ProfileAnnouncePayload;
    expect(parsed.updatedAt).not.toBe('1999-01-01T00:00:00.000Z');
  });

  it.each([
    ['null avatar', null],
    ['undefined avatar', undefined],
  ])('encodeProfileAnnounce refuses to serialize a %s (never emits avatar:null)', (_label, avatar) => {
    // Kills a mutant that lets a null/absent avatar reach JSON.stringify.
    expect(() => encodeProfileAnnounce({ nickname: 'Carol', avatar })).toThrow();
  });

  it('encodeProfileAnnounce refuses an avatar with a missing imageUrl', () => {
    expect(() =>
      encodeProfileAnnounce({ nickname: 'Dana', avatar: {} as unknown as { imageUrl: string } }),
    ).toThrow();
  });

  it('encodeProfileAnnounce refuses an avatar with a non-string imageUrl', () => {
    expect(() =>
      encodeProfileAnnounce({ nickname: 'Erin', avatar: { imageUrl: 42 as unknown as string } }),
    ).toThrow();
  });

  it.each([
    ['empty nickname', ''],
    ['non-string nickname', 123 as unknown as string],
  ])('encodeProfileAnnounce refuses a %s', (_label, nickname) => {
    expect(() => encodeProfileAnnounce({ nickname, avatar: { imageUrl: 'https://example.com/x.png' } })).toThrow();
  });

  // ── avatar.imageUrl scheme allow-list (security-adjacent: this value flows
  //    to <img src> via contactCache; only https:// and protocol-relative //
  //    are allowed, and the WHOLE string must be a single non-whitespace run
  //    so an embedded space + trailing junk cannot smuggle a payload past a
  //    scheme-prefix check) ──────────────────────────────────────────────
  it.each([
    ['http:// (not https)', 'http://example.com/a.png'],
    ['data: URI', 'data:image/png;base64,AAAA'],
    ['javascript: URI', 'javascript:alert(1)'],
    ['bare relative path', '/assets/a.png'],
    // The embedded-whitespace case is what distinguishes the fully-anchored
    // pattern from a mere scheme-prefix match: `https://ok/a.png` is a valid
    // prefix, but the string as a whole is not a single non-whitespace run.
    ['https:// prefix with embedded whitespace + trailing junk', 'https://ok.example/a.png <script>'],
    ['protocol-relative prefix with a trailing newline payload', '//few.chat/assets/a.png\nX'],
  ])('encodeProfileAnnounce refuses an avatar.imageUrl that is %s', (_label, imageUrl) => {
    expect(() => encodeProfileAnnounce({ nickname: 'Sam', avatar: { imageUrl } })).toThrow();
  });

  it.each([
    ['a valid absolute https URL', 'https://example.com/a.png'],
    ['a valid protocol-relative blossom URL', '//few.chat/assets/a.png'],
  ])('encodeProfileAnnounce accepts %s', (_label, imageUrl) => {
    expect(() => encodeProfileAnnounce({ nickname: 'Sam', avatar: { imageUrl } })).not.toThrow();
  });

  it.each([
    ['http:// scheme', 'http://example.com/a.png'],
    ['data: URI', 'data:image/png;base64,AAAA'],
    ['https:// prefix with embedded whitespace + trailing junk', 'https://ok.example/a.png <script>'],
  ])('parseProfileAnnounce rejects an avatar.imageUrl that is %s as avatar-imageUrl-invalid-scheme', (_label, imageUrl) => {
    const result = parseProfileAnnounce(
      JSON.stringify({
        type: 'profile-announce',
        nickname: 'Alice',
        avatar: { imageUrl },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('avatar-imageUrl-invalid-scheme');
  });

  it.each([
    ['avatar: null', JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: null, updatedAt: '2026-01-01T00:00:00.000Z' }), 'avatar-missing'],
    ['absent avatar key', JSON.stringify({ type: 'profile-announce', nickname: 'Alice', updatedAt: '2026-01-01T00:00:00.000Z' }), 'avatar-missing'],
    ['avatar is an array', JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: [], updatedAt: '2026-01-01T00:00:00.000Z' }), 'avatar-missing'],
    ['absent avatar.imageUrl', JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: {}, updatedAt: '2026-01-01T00:00:00.000Z' }), 'avatar-imageUrl-invalid'],
    ['null avatar.imageUrl', JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: { imageUrl: null }, updatedAt: '2026-01-01T00:00:00.000Z' }), 'avatar-imageUrl-invalid'],
    ['empty-string avatar.imageUrl', JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: { imageUrl: '' }, updatedAt: '2026-01-01T00:00:00.000Z' }), 'avatar-imageUrl-invalid'],
    ['non-string avatar.imageUrl', JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: { imageUrl: 7 }, updatedAt: '2026-01-01T00:00:00.000Z' }), 'avatar-imageUrl-invalid'],
  ])('parseProfileAnnounce classifies %s as malformed (%s), never as a usable "no avatar" value', (_label, content, expectedReason) => {
    // Central AC-PROF-6a assertion: every one of these MUST be ok:false with
    // a distinct reason — none may be treated as a legitimate empty-avatar
    // signal a receive path could confuse with "never announced" (§3.1 G1/G2).
    const result = parseProfileAnnounce(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(expectedReason);
    }
  });

  it.each([
    ['invalid JSON', 'not json{{{', 'invalid-json'],
    ['non-object (null)', 'null', 'not-an-object'],
    ['non-object (array)', '[]', 'not-an-object'],
    ['wrong type literal', JSON.stringify({ type: 'profile-request' }), 'wrong-type'],
    [
      'missing nickname',
      JSON.stringify({ type: 'profile-announce', avatar: { imageUrl: 'https://x/y.png' }, updatedAt: '2026-01-01T00:00:00.000Z' }),
      'invalid-nickname',
    ],
    [
      'empty nickname',
      JSON.stringify({ type: 'profile-announce', nickname: '', avatar: { imageUrl: 'https://x/y.png' }, updatedAt: '2026-01-01T00:00:00.000Z' }),
      'invalid-nickname',
    ],
    [
      'non-string nickname',
      JSON.stringify({ type: 'profile-announce', nickname: 5, avatar: { imageUrl: 'https://x/y.png' }, updatedAt: '2026-01-01T00:00:00.000Z' }),
      'invalid-nickname',
    ],
    [
      'missing updatedAt',
      JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: { imageUrl: 'https://x/y.png' } }),
      'invalid-updatedAt',
    ],
    [
      'empty updatedAt',
      JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: { imageUrl: 'https://x/y.png' }, updatedAt: '' }),
      'invalid-updatedAt',
    ],
    [
      'non-string updatedAt',
      JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: { imageUrl: 'https://x/y.png' }, updatedAt: 12345 }),
      'invalid-updatedAt',
    ],
  ])('parseProfileAnnounce rejects %s as %s', (_label, content, expectedReason) => {
    const result = parseProfileAnnounce(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(expectedReason);
    }
  });

  it.each(MALFORMED_TIMESTAMPS)(
    'parseProfileAnnounce rejects an updatedAt that is %s (%s) as invalid-updatedAt',
    (_label, updatedAt) => {
      // Central gate-remediation sev-5 assertion: none of these strings may
      // ever be accepted as a usable updatedAt, however shape-plausible they
      // look, because AC-PROF-10's LWW compare in contactCache.ts trusts this
      // parser's output to already be a valid, uniformly-formatted ISO-8601
      // UTC timestamp.
      const result = parseProfileAnnounce(
        JSON.stringify({ type: 'profile-announce', nickname: 'Alice', avatar: { imageUrl: 'https://x/y.png' }, updatedAt }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('invalid-updatedAt');
      }
    },
  );

  it('parseProfileAnnounce accepts a genuine encodeProfileAnnounce-produced updatedAt (no false positive from the strict check)', () => {
    // Guards against the strict validator being so aggressive it rejects the
    // exact shape this module's own encoder produces.
    const wire = encodeProfileAnnounce({ nickname: 'Grace', avatar: { imageUrl: 'https://example.com/g.png' } });
    const result = parseProfileAnnounce(wire);
    expect(result.ok).toBe(true);
  });

  it('parseProfileAnnounce drops unexpected/extra keys (including an own "__proto__" key) rather than propagating them', () => {
    const forged = JSON.parse(
      '{"type":"profile-announce","nickname":"Alice","avatar":{"imageUrl":"https://x/y.png","__proto__":{"polluted":true}},"updatedAt":"2026-01-01T00:00:00.000Z","extra":"nope"}',
    );
    const result = parseProfileAnnounce(JSON.stringify(forged));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(['avatar', 'nickname', 'type', 'updatedAt']);
      expect(Object.keys(result.value.avatar).sort()).toEqual(['imageUrl']);
      expect((result.value as Record<string, unknown>).extra).toBeUndefined();
    }
  });

  it('applying parseProfileAnnounce twice to the same content yields deep-equal values (idempotent parse)', () => {
    const wire = encodeProfileAnnounce({ nickname: 'Frank', avatar: { imageUrl: 'https://example.com/f.png' } });
    const first = parseProfileAnnounce(wire);
    const second = parseProfileAnnounce(wire);
    expect(first).toEqual(second);
  });
});

describe('dmProfile/kinds — nickname length cap (gate-remediation sev 2)', () => {
  // 32 UTF-8 bytes — mirrors contactCard.ts#MAX_NAME_BYTES / config/profile.ts
  // #NICKNAME_MAX_BYTES, the same cap already enforced on a LOCAL profile's
  // nickname at save time.
  const AT_CAP = 'a'.repeat(32);
  const OVER_CAP = 'a'.repeat(33);

  it('encodeProfileAnnounce accepts a nickname exactly at the 32-byte cap', () => {
    expect(() => encodeProfileAnnounce({ nickname: AT_CAP, avatar: { imageUrl: 'https://x/y.png' } })).not.toThrow();
  });

  it('encodeProfileAnnounce refuses a nickname one byte over the cap', () => {
    // Kills a mutant that uses a >= / > boundary the wrong way round, or
    // omits the length check entirely.
    expect(() => encodeProfileAnnounce({ nickname: OVER_CAP, avatar: { imageUrl: 'https://x/y.png' } })).toThrow();
  });

  it('encodeProfileAnnounce refuses a nickname over the cap counted in UTF-8 bytes, not JS string length', () => {
    // A multi-byte character (e.g. an emoji, 4 UTF-8 bytes) must count as
    // more than 1 toward the cap — kills a mutant that measures `.length`
    // (UTF-16 code units) instead of encoded byte length.
    const emojiNickname = '\u{1F600}'.repeat(9); // 9 * 4 = 36 bytes > 32
    expect(() => encodeProfileAnnounce({ nickname: emojiNickname, avatar: { imageUrl: 'https://x/y.png' } })).toThrow();
  });

  it('parseProfileAnnounce classifies an over-cap nickname as nickname-too-long, not a usable value', () => {
    const content = JSON.stringify({
      type: 'profile-announce',
      nickname: OVER_CAP,
      avatar: { imageUrl: 'https://x/y.png' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = parseProfileAnnounce(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('nickname-too-long');
    }
  });

  it('parseProfileAnnounce accepts a nickname exactly at the 32-byte cap', () => {
    const content = JSON.stringify({
      type: 'profile-announce',
      nickname: AT_CAP,
      avatar: { imageUrl: 'https://x/y.png' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = parseProfileAnnounce(content);
    expect(result.ok).toBe(true);
  });
});

describe('dmProfile/kinds — avatar.imageUrl length cap (gate-remediation sev 2)', () => {
  const LONG_PATH_OVER_CAP = 'https://example.com/' + 'a'.repeat(500); // > 512 chars total

  it('encodeProfileAnnounce refuses an avatar.imageUrl over the length cap', () => {
    expect(() =>
      encodeProfileAnnounce({ nickname: 'Alice', avatar: { imageUrl: LONG_PATH_OVER_CAP } }),
    ).toThrow();
  });

  it('parseProfileAnnounce classifies an over-cap avatar.imageUrl as avatar-imageUrl-too-long', () => {
    const content = JSON.stringify({
      type: 'profile-announce',
      nickname: 'Alice',
      avatar: { imageUrl: LONG_PATH_OVER_CAP },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = parseProfileAnnounce(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('avatar-imageUrl-too-long');
    }
  });

  it('parseProfileAnnounce accepts an avatar.imageUrl well under the cap', () => {
    const content = JSON.stringify({
      type: 'profile-announce',
      nickname: 'Alice',
      avatar: { imageUrl: 'https://example.com/short.png' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parseProfileAnnounce(content).ok).toBe(true);
  });
});

describe('dmProfile/kinds — avatar.imageUrl scheme allow-list (gate-remediation sev 3)', () => {
  // Decision recorded in kinds.ts: ADD a scheme guard here (no existing
  // sanitizing chokepoint to delegate to — profileSync.ts's imageUrl and its
  // render path do no scheme validation today). Accepts https:// absolute
  // and // protocol-relative (the app's own blossom shape); rejects other
  // schemes.
  it.each([
    ['https absolute URL', 'https://example.com/avatar.png'],
    ['protocol-relative blossom-shaped URL', '//few.chat/assets/1234-uuid.png'],
  ])('accepts a %s (%s)', (_label, imageUrl) => {
    expect(() => encodeProfileAnnounce({ nickname: 'Alice', avatar: { imageUrl } })).not.toThrow();
    const content = JSON.stringify({
      type: 'profile-announce',
      nickname: 'Alice',
      avatar: { imageUrl },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parseProfileAnnounce(content).ok).toBe(true);
  });

  it.each([
    ['data: URI', 'data:image/png;base64,AAAA'],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['plain http (insecure)', 'http://example.com/avatar.png'],
    ['ftp scheme', 'ftp://example.com/avatar.png'],
    ['bare single-slash relative path', '/assets/avatar.png'],
    ['no scheme at all', 'example.com/avatar.png'],
  ])('rejects a %s (%s) at both encode and parse', (_label, imageUrl) => {
    expect(() => encodeProfileAnnounce({ nickname: 'Alice', avatar: { imageUrl } })).toThrow();
    const content = JSON.stringify({
      type: 'profile-announce',
      nickname: 'Alice',
      avatar: { imageUrl },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = parseProfileAnnounce(content);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('avatar-imageUrl-invalid-scheme');
    }
  });
});

describe('dmProfile/kinds — ProfileParseReason seam typing (gate-remediation sev 2)', () => {
  it('every malformed-result reason this module actually returns is assignable to the exported ProfileParseReason union', () => {
    // Compile-time proof (not just a runtime string compare): if kinds.ts
    // ever returns a reason string that ProfileParseReason does not declare,
    // this assignment fails to typecheck. That is the whole point of story
    // 04's seam getting a closed union instead of a bare `string`.
    const observedReasons: ProfileParseReason[] = [];
    const requestResult = parseProfileRequest('not json');
    if (!requestResult.ok) {
      observedReasons.push(requestResult.reason);
    }
    const announceResult = parseProfileAnnounce(
      JSON.stringify({ type: 'profile-announce', nickname: '', avatar: null, updatedAt: '' }),
    );
    if (!announceResult.ok) {
      observedReasons.push(announceResult.reason);
    }
    expect(observedReasons.length).toBeGreaterThan(0);
  });
});
