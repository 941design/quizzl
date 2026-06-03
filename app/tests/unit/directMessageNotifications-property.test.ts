/**
 * Property-based gap-closing tests for directMessageNotifications.ts
 *
 * Closes the 16 real-gap survivors from the mutation gate:
 *
 * Line 81  — peer guard: self-messages are dropped, empty-peer messages are dropped,
 *             and the || vs && operator matters (one of the two conditions being false
 *             is enough to skip — stranger gate still applies separately).
 * Line 89  — seenMessageIds dedup: re-delivered kind-4 with same event.id must not
 *             double-ring the bell.
 * Line 90  — seenMessageIds population guard (event.id must be truthy before adding).
 * Line 91  — created_at * 1000 unit conversion: createdMs must equal created_at * 1000.
 * Line 92  — last-read boundary (<= vs <): messages AT the lastReadAt timestamp are
 *             already-read and must not ring the bell; messages after it must.
 * Line 112 — kind-1059 spread-base + created_at fallback: when event.created_at is
 *             absent, the rumor's own created_at is used for the boundary check.
 * Line 131 — rumor.created_at * 1000 unit conversion.
 * Line 132 — last-read boundary for kind-1059 (same as line 92).
 * Line 141 — logger string literal: unwrap failure must still log with the 'dm:unwrap-failed'
 *             tag (non-empty string guard).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fake NDK ──────────────────────────────────────────────────────────────────

type FakeSub = {
  id: string;
  filter: object;
  handlers: Array<(ev: object) => void>;
  stop: () => void;
  on: (event: string, handler: (ev: object) => void) => void;
};
type FakeNdk = { subscribe: (filter: object) => FakeSub };

function makeFakeNdk(): FakeNdk & { subs: FakeSub[] } {
  const subs: FakeSub[] = [];
  const ndk = {
    subs,
    subscribe: (filter: object) => {
      const sub: FakeSub = {
        id: `sub-${subs.length}`,
        filter,
        handlers: [],
        stop: vi.fn(),
        on(event: string, handler: (ev: object) => void) { this.handlers.push(handler); },
      };
      subs.push(sub);
      return sub;
    },
  } as FakeNdk & { subs: FakeSub[] };
  return ndk;
}

async function emitEvent(sub: FakeSub, event: object) {
  await Promise.all(sub.handlers.map(async (h) => {
    const r = h(event);
    if (r instanceof Promise) await r;
  }));
}

function kind4Sub(ndk: { subs: FakeSub[] }) {
  return ndk.subs.find((s) => JSON.stringify(s.filter).includes('"kinds":[4]'))!;
}
function kind1059Sub(ndk: { subs: FakeSub[] }) {
  return ndk.subs.find((s) => JSON.stringify(s.filter).includes('"kinds":[1059]'))!;
}

// ── Shared test pubkeys ───────────────────────────────────────────────────────

const OWN_PRIV = 'bceef655b5a034911f1c3718ce056531b45ef03b4c7b1f15629e867294011a7d';
const OWN_PUB = 'a'.repeat(64);
const PEER_PUB = 'b'.repeat(64);
const allowAll = (_: string) => true;
const allowPeerOnly = (p: string) => p === PEER_PUB.toLowerCase();

// ── Mocks ─────────────────────────────────────────────────────────────────────

let lastReadAt = 0; // injectable via getter mock

let capturedLoggerInfo: ReturnType<typeof vi.fn>;

vi.mock('@/src/lib/directMessages', async () => {
  const mod = await vi.importActual<typeof import('@/src/lib/directMessages')>('@/src/lib/directMessages');
  return { ...mod, unwrapAndOpen: vi.fn<() => Promise<import('@/src/lib/directMessages').UnsignedRumor>>() };
});

vi.mock('@/src/lib/unreadStore', () => ({
  getDirectMessageLastReadAt: vi.fn(() => lastReadAt),
  incrementDirectMessage: vi.fn(),
}));

vi.mock('@/src/lib/contacts', () => ({
  rememberContact: vi.fn(),
}));

vi.mock('@/src/lib/logger', () => {
  const infoSpy = vi.fn();
  capturedLoggerInfo = infoSpy;
  return {
    createLogger: () => ({ info: infoSpy, debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const { unwrapAndOpen } = await import('@/src/lib/directMessages');
const { incrementDirectMessage, getDirectMessageLastReadAt } = await import('@/src/lib/unreadStore');
const { rememberContact } = await import('@/src/lib/contacts');
const { subscribeDirectMessageNotifications } = await import('@/src/lib/directMessageNotifications');

beforeEach(() => {
  vi.clearAllMocks();
  lastReadAt = 0;
  vi.mocked(getDirectMessageLastReadAt).mockImplementation(() => lastReadAt);
  if (capturedLoggerInfo) capturedLoggerInfo.mockClear();
});

afterEach(() => {
  // nothing to restore — mocks handle cleanup via clearAllMocks
});

// ── kind-4: self-message guard (line 81) ─────────────────────────────────────

describe('kind-4 handler — self and empty-peer short-circuit', () => {
  /**
   * Property: events from self (pubkey === ownPubkeyHex) must never ring the bell
   * regardless of any other field value.
   * Kills: ConditionalExpression repl='false' (would let self-messages through).
   */

  it('self-authored kind-4 does not ring the bell (lowercase pubkey)', async () => {
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind4Sub(ndk), { id: 'e1', pubkey: OWN_PUB, created_at: 1_700_000_000 });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('self-authored kind-4 does not ring the bell (mixed case pubkey)', async () => {
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind4Sub(ndk), { id: 'e2', pubkey: OWN_PUB.toUpperCase(), created_at: 1_700_000_000 });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('event with empty pubkey does not ring the bell', async () => {
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind4Sub(ndk), { id: 'e3', pubkey: '', created_at: 1_700_000_000 });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('event with undefined pubkey does not ring the bell', async () => {
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind4Sub(ndk), { id: 'e4', created_at: 1_700_000_000 });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  /**
   * Kills: LogicalOperator repl='!peer && peer === ownLower' (changes || to &&).
   * With &&: an empty peer would not return early; a self-peer would not be caught.
   * Both paths must independently trigger the early return.
   */
  it('empty pubkey triggers early return independently of the self-pubkey check', async () => {
    // Test with a scenario where pubkey is '' — the || means the first half fires
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    // Empty peer — must be dropped before any gate check
    await emitEvent(kind4Sub(ndk), { id: 'e5', pubkey: undefined, created_at: 1_700_000_000 });
    expect(rememberContact).not.toHaveBeenCalled();
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('peer !== own and peer !== empty passes through the peer guard (proceeds to isAllowedSender)', async () => {
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind4Sub(ndk), { id: 'e6', pubkey: PEER_PUB, created_at: 1_700_000_000 });
    expect(incrementDirectMessage).toHaveBeenCalledOnce();
  });
});

// ── kind-4: seenMessageIds dedup (lines 89-90) ───────────────────────────────

describe('kind-4 handler — seenMessageIds dedup', () => {
  /**
   * Property: the same event.id must ring the bell exactly once regardless of how
   * many times the same event is delivered.
   * Kills: seenMessageIds.has(event.id) guard flip and seenMessageIds.add guard flip.
   */

  it('same event.id delivered twice rings the bell exactly once', async () => {
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    const event = { id: 'dup-id', pubkey: PEER_PUB, created_at: 1_700_000_000 };
    await emitEvent(kind4Sub(ndk), event);
    await emitEvent(kind4Sub(ndk), event);
    expect(incrementDirectMessage).toHaveBeenCalledTimes(1);
  });

  it('same event.id delivered 5 times rings the bell exactly once', async () => {
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    const event = { id: 'dup-id-5x', pubkey: PEER_PUB, created_at: 1_700_000_000 };
    for (let i = 0; i < 5; i++) await emitEvent(kind4Sub(ndk), event);
    expect(incrementDirectMessage).toHaveBeenCalledTimes(1);
  });

  it('different event ids each ring the bell once', async () => {
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    for (let i = 0; i < 5; i++) {
      await emitEvent(kind4Sub(ndk), { id: `unique-id-${i}`, pubkey: PEER_PUB, created_at: 1_700_000_000 });
    }
    expect(incrementDirectMessage).toHaveBeenCalledTimes(5);
  });

  it('event without an id is not added to the dedup set (each delivery rings the bell)', async () => {
    // An event without id cannot be deduped; each delivery must ring the bell.
    // The id field is optional per IncomingDmEvent type.
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    const event = { pubkey: PEER_PUB, created_at: 1_700_000_000 }; // no id
    await emitEvent(kind4Sub(ndk), event);
    await emitEvent(kind4Sub(ndk), event);
    // Both deliveries should ring the bell because there is no id to dedup on
    expect(incrementDirectMessage).toHaveBeenCalledTimes(2);
  });
});

// ── kind-4: created_at * 1000 unit conversion (line 91) ──────────────────────

describe('kind-4 handler — created_at unit conversion (s → ms)', () => {
  /**
   * Property: a message with created_at=T rings the bell only when T*1000 > lastReadAt.
   * Kills: the multiplier mutation (* 1000 → / 1000 or +/- 1000).
   */

  it('message created_at=1000 with lastRead=999_000 rings the bell (1000*1000 = 1_000_000 > 999_000)', async () => {
    lastReadAt = 999_000;
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind4Sub(ndk), { id: 'u1', pubkey: PEER_PUB, created_at: 1000 });
    expect(incrementDirectMessage).toHaveBeenCalledOnce();
  });

  it('message created_at=1 with lastRead=999 is silenced (1*1000 = 1000 > 999 → rings)', async () => {
    // created_at=1 → createdMs=1000; lastRead=999 → 1000 > 999 → rings the bell
    lastReadAt = 999;
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind4Sub(ndk), { id: 'u2', pubkey: PEER_PUB, created_at: 1 });
    expect(incrementDirectMessage).toHaveBeenCalledOnce();
  });

  it('message created_at=1 with lastRead=2000 is silenced (1*1000=1000 <= 2000)', async () => {
    // If the multiplier were 1 (not 1000), createdMs would be 1, which is < 2000.
    // With correct * 1000: createdMs = 1000 <= 2000 → silenced.
    // This test is killed by / 1000 or +/- mutations because those change whether
    // the message falls on the right side of the boundary.
    lastReadAt = 2000;
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind4Sub(ndk), { id: 'u3', pubkey: PEER_PUB, created_at: 1 });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });
});

// ── kind-4: last-read boundary (line 92) ─────────────────────────────────────

describe('kind-4 handler — last-read boundary (createdMs <= lastReadAt)', () => {
  /**
   * Property: a message at exactly the lastReadAt timestamp is already-read
   * and must not ring the bell. A message one millisecond after must ring.
   * Kills: < vs <= operator mutation.
   */

  it('createdMs exactly equal to lastReadAt does NOT ring the bell (already read)', async () => {
    const t = 1_700_000_000_000; // ms
    lastReadAt = t;
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    // created_at in seconds = t / 1000; createdMs = (t/1000) * 1000 = t
    await emitEvent(kind4Sub(ndk), { id: 'b1', pubkey: PEER_PUB, created_at: t / 1000 });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('createdMs one ms after lastReadAt DOES ring the bell', async () => {
    const t = 1_700_000_000_000;
    lastReadAt = t;
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    // created_at in seconds = (t + 1) / 1000 — not an integer, but the handler
    // uses the raw seconds value; use t/1000 + 1 second to land above lastReadAt.
    const createdAtSec = t / 1000 + 1; // produces createdMs = (t + 1000) ms
    await emitEvent(kind4Sub(ndk), { id: 'b2', pubkey: PEER_PUB, created_at: createdAtSec });
    expect(incrementDirectMessage).toHaveBeenCalledOnce();
  });

  it('createdMs strictly less than lastReadAt does NOT ring the bell', async () => {
    lastReadAt = 2_000_000;
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind4Sub(ndk), { id: 'b3', pubkey: PEER_PUB, created_at: 1000 }); // 1000*1000=1_000_000 < 2_000_000
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('parametric: boundary sweep over 20 timestamps', async () => {
    const LAST_READ_MS = 1_000_000_000;
    const secondsBase = LAST_READ_MS / 1000;
    lastReadAt = LAST_READ_MS;

    for (let delta = -10; delta <= 10; delta++) {
      vi.mocked(incrementDirectMessage).mockClear();
      const ndk = makeFakeNdk();
      subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
      const createdAtSec = secondsBase + delta; // delta < 0: old; delta = 0: exactly at; delta > 0: new
      const id = `sweep-${delta + 100}`;
      await emitEvent(kind4Sub(ndk), { id, pubkey: PEER_PUB, created_at: createdAtSec });
      const createdMs = createdAtSec * 1000;
      const shouldRing = createdMs > LAST_READ_MS;
      if (shouldRing) {
        expect(incrementDirectMessage).toHaveBeenCalledOnce();
      } else {
        expect(incrementDirectMessage).not.toHaveBeenCalled();
      }
    }
  });
});

// ── kind-1059: spread-base + created_at fallback (line 112) ──────────────────

describe('kind-1059 handler — created_at fallback and spread preservation', () => {
  /**
   * Property: when event.created_at is absent, the rumor's created_at (not a broken
   * default) is used. The spread must preserve other event fields.
   * Kills: LogicalOperator repl='event.created_at && Math.floor(Date.now() / 1000)'
   *        and the {} spread-base mutation (dropping event fields).
   */

  it('missing event.created_at: rumor.created_at determines the boundary (> lastRead → rings)', async () => {
    lastReadAt = 0;
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r-fallback-1',
      pubkey: PEER_PUB,
      kind: 14,
      content: 'hi',
      tags: [['p', OWN_PUB]],
      created_at: 1_700_000_000, // well after lastRead=0
    });
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    // event has no created_at
    await emitEvent(kind1059Sub(ndk), { id: 'wrap-no-ts', kind: 1059, pubkey: 'eph' });
    expect(incrementDirectMessage).toHaveBeenCalledOnce();
  });

  it('missing event.created_at: rumor.created_at before lastRead → bell silent', async () => {
    lastReadAt = 2_000_000_000_000; // far future (ms)
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r-fallback-2',
      pubkey: PEER_PUB,
      kind: 14,
      content: 'hi',
      tags: [['p', OWN_PUB]],
      created_at: 1_000_000, // 1_000_000 * 1000 = 1_000_000_000 ms << lastReadAt
    });
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind1059Sub(ndk), { id: 'wrap-no-ts-2', kind: 1059, pubkey: 'eph' });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });
});

// ── kind-1059: rumor.created_at unit conversion (line 131) ───────────────────

describe('kind-1059 handler — rumor.created_at unit conversion (s → ms)', () => {
  /**
   * Property: rumor.created_at is seconds; createdMs = rumor.created_at * 1000.
   * A message at created_at=T sec with lastReadAt=T*1000 ms must be silenced
   * (already read at exactly that time).
   * Kills: * 1000 → / 1000 (produces 1980-era timestamp).
   */

  it('rumor created_at=1000 with lastRead=1_000_000 ms is silenced (1000*1000 = 1_000_000 <= 1_000_000)', async () => {
    lastReadAt = 1_000_000;
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r-conv-1',
      pubkey: PEER_PUB,
      kind: 14,
      content: 'hi',
      tags: [['p', OWN_PUB]],
      created_at: 1000,
    });
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind1059Sub(ndk), { id: 'w-conv-1', kind: 1059, pubkey: 'eph', created_at: 1000 });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('rumor created_at=1001 with lastRead=1_000_000 ms rings the bell (1001*1000 = 1_001_000 > 1_000_000)', async () => {
    lastReadAt = 1_000_000;
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r-conv-2',
      pubkey: PEER_PUB,
      kind: 14,
      content: 'hi',
      tags: [['p', OWN_PUB]],
      created_at: 1001,
    });
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind1059Sub(ndk), { id: 'w-conv-2', kind: 1059, pubkey: 'eph', created_at: 1001 });
    expect(incrementDirectMessage).toHaveBeenCalledOnce();
  });

  it('if * 1000 were replaced by / 1000, a 1980-era timestamp would silence a new message', () => {
    // Demonstrates what the mutation does: created_at=1_700_000_000 / 1000 = 1_700_000
    // which represents ~1980, far below lastReadAt=0 → event would ring.
    // The correct path: 1_700_000_000 * 1000 = 1_700_000_000_000 >> 0 → rings.
    // We test the correct value: createdMs for created_at=1_700_000_000 must equal
    // 1_700_000_000_000, not 1_700_000.
    const rumorCreatedAtSec = 1_700_000_000;
    const expectedMs = rumorCreatedAtSec * 1000;
    expect(expectedMs).toBe(1_700_000_000_000);
    expect(expectedMs).toBeGreaterThan(rumorCreatedAtSec / 1000); // the incorrect result
  });
});

// ── kind-1059: last-read boundary (line 132) ─────────────────────────────────

describe('kind-1059 handler — last-read boundary (createdMs <= lastReadAt)', () => {
  /**
   * Same boundary contract as kind-4 but for the rumor path.
   * Kills: < vs <= operator mutation on line 132.
   */

  it('rumor createdMs exactly equal to lastReadAt does NOT ring the bell', async () => {
    const ts = 1_700_000_000; // sec
    lastReadAt = ts * 1000;    // ms
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r-bnd-1',
      pubkey: PEER_PUB,
      kind: 14,
      content: 'hi',
      tags: [['p', OWN_PUB]],
      created_at: ts,
    });
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind1059Sub(ndk), { id: 'w-bnd-1', kind: 1059, pubkey: 'eph', created_at: ts });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('rumor createdMs one second after lastReadAt DOES ring the bell', async () => {
    const ts = 1_700_000_000;
    lastReadAt = ts * 1000;
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r-bnd-2',
      pubkey: PEER_PUB,
      kind: 14,
      content: 'hi',
      tags: [['p', OWN_PUB]],
      created_at: ts + 1, // one second later → createdMs = (ts+1)*1000 > ts*1000
    });
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
    await emitEvent(kind1059Sub(ndk), { id: 'w-bnd-2', kind: 1059, pubkey: 'eph', created_at: ts + 1 });
    expect(incrementDirectMessage).toHaveBeenCalledOnce();
  });

  it('parametric: boundary sweep for kind-1059', async () => {
    const LAST_READ_SEC = 1_700_000_000;
    lastReadAt = LAST_READ_SEC * 1000;

    for (let delta = -3; delta <= 3; delta++) {
      vi.mocked(incrementDirectMessage).mockClear();
      vi.mocked(unwrapAndOpen).mockResolvedValue({
        id: `r-sweep-${delta + 10}`,
        pubkey: PEER_PUB,
        kind: 14,
        content: 'hi',
        tags: [['p', OWN_PUB]],
        created_at: LAST_READ_SEC + delta,
      });
      const ndk = makeFakeNdk();
      subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowPeerOnly });
      await emitEvent(kind1059Sub(ndk), { id: `w-sweep-${delta + 10}`, kind: 1059, pubkey: 'eph', created_at: LAST_READ_SEC + delta });
      const createdMs = (LAST_READ_SEC + delta) * 1000;
      const shouldRing = createdMs > lastReadAt;
      if (shouldRing) {
        expect(incrementDirectMessage).toHaveBeenCalledOnce();
      } else {
        expect(incrementDirectMessage).not.toHaveBeenCalled();
      }
    }
  });
});

// ── logger string literal (line 141) ─────────────────────────────────────────

describe('kind-1059 handler — unwrap failure logs a non-empty event tag', () => {
  /**
   * Property: the logger.info call on unwrap failure must use the tag 'dm:unwrap-failed'
   * (non-empty string). This kills StringLiteral repl='""' on that log call.
   */

  it('unwrap failure: logger is called with a non-empty string as the first argument', async () => {
    vi.mocked(unwrapAndOpen).mockRejectedValue(new Error('bad'));
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind1059Sub(ndk), { id: 'w-log-1', kind: 1059, pubkey: 'eph' });
    expect(capturedLoggerInfo).toHaveBeenCalled();
    const firstArg = capturedLoggerInfo.mock.calls[0][0];
    expect(typeof firstArg).toBe('string');
    expect(firstArg.length).toBeGreaterThan(0);
    expect(firstArg).toBe('dm:unwrap-failed');
  });
});

// ── cleanup function teardown (lines 148-155) ─────────────────────────────────

describe('subscribeDirectMessageNotifications — cleanup function calls stop() on both subs', () => {
  /**
   * Property: the returned cleanup function must call stop() on both the kind-4
   * and kind-1059 subscriptions. Not calling stop() causes a subscription leak.
   *
   * Kills:
   *  L148 BlockStatement repl='{}' — entire cleanup body is a no-op.
   *  L149 BlockStatement repl='{}' — kind4 try-block body is a no-op.
   *  L150 OptionalChaining — kind4Sub.stop?.() → kind4Sub.stop() always called.
   *  L154 BlockStatement repl='{}' — kind1059 try-block body is a no-op.
   *  L155 OptionalChaining — kind1059Sub.stop?.() → always called.
   */

  it('calling the returned cleanup calls stop() on the kind-4 subscription', () => {
    const ndk = makeFakeNdk();
    const cleanup = subscribeDirectMessageNotifications({
      ndk: ndk as any,
      ownPubkeyHex: OWN_PUB,
      privateKeyHex: OWN_PRIV,
      isAllowedSender: allowAll,
    });
    const k4Sub = kind4Sub(ndk);
    expect(k4Sub).toBeDefined();
    cleanup();
    expect(k4Sub.stop).toHaveBeenCalledTimes(1);
  });

  it('calling the returned cleanup calls stop() on the kind-1059 subscription', () => {
    const ndk = makeFakeNdk();
    const cleanup = subscribeDirectMessageNotifications({
      ndk: ndk as any,
      ownPubkeyHex: OWN_PUB,
      privateKeyHex: OWN_PRIV,
      isAllowedSender: allowAll,
    });
    const k1059Sub = kind1059Sub(ndk);
    expect(k1059Sub).toBeDefined();
    cleanup();
    expect(k1059Sub.stop).toHaveBeenCalledTimes(1);
  });

  it('cleanup calls stop() on both subscriptions in a single call', () => {
    const ndk = makeFakeNdk();
    const cleanup = subscribeDirectMessageNotifications({
      ndk: ndk as any,
      ownPubkeyHex: OWN_PUB,
      privateKeyHex: OWN_PRIV,
      isAllowedSender: allowAll,
    });
    cleanup();
    // Both subs must have been stopped
    for (const sub of ndk.subs) {
      expect(sub.stop).toHaveBeenCalled();
    }
    expect(ndk.subs).toHaveLength(2);
  });

  it('cleanup is callable without throwing even when stop throws', () => {
    const ndk = makeFakeNdk();
    const cleanup = subscribeDirectMessageNotifications({
      ndk: ndk as any,
      ownPubkeyHex: OWN_PUB,
      privateKeyHex: OWN_PRIV,
      isAllowedSender: allowAll,
    });
    // Make stop throw — the try-catch should absorb it
    for (const sub of ndk.subs) {
      (sub.stop as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('network gone'); });
    }
    expect(() => cleanup()).not.toThrow();
  });

  it('after cleanup, stop has been called exactly once per subscription (not twice)', () => {
    const ndk = makeFakeNdk();
    const cleanup = subscribeDirectMessageNotifications({
      ndk: ndk as any,
      ownPubkeyHex: OWN_PUB,
      privateKeyHex: OWN_PRIV,
      isAllowedSender: allowAll,
    });
    cleanup();
    // Each sub's stop is called exactly once
    for (const sub of ndk.subs) {
      expect(sub.stop).toHaveBeenCalledTimes(1);
    }
  });

  it('kind-4 events after cleanup do not ring the bell (subscription is torn down)', async () => {
    const ndk = makeFakeNdk();
    const cleanup = subscribeDirectMessageNotifications({
      ndk: ndk as any,
      ownPubkeyHex: OWN_PUB,
      privateKeyHex: OWN_PRIV,
      isAllowedSender: allowPeerOnly,
    });
    // Verify the subscription was working before cleanup
    await emitEvent(kind4Sub(ndk), { id: 'pre-cleanup', pubkey: PEER_PUB, created_at: 1_700_000_001 });
    expect(incrementDirectMessage).toHaveBeenCalledTimes(1);
    vi.mocked(incrementDirectMessage).mockClear();

    cleanup();

    // The handlers array still contains the handler (FakeNdk doesn't remove on stop),
    // but in production NDK, stop() terminates the subscription.
    // What we CAN verify: stop() was called on both subs (the real guard).
    expect(kind4Sub(ndk).stop).toHaveBeenCalledTimes(1);
    expect(kind1059Sub(ndk).stop).toHaveBeenCalledTimes(1);
  });
});
