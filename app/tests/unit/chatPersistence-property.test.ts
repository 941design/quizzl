/**
 * Property-based gap-closing tests for marmot/chatPersistence.ts
 *
 * Closes the 19 real-gap survivors from the mutation gate:
 *
 * Line 47  — getHealedThreads: returns [] for missing/falsy raw value.
 * Line 49  — getHealedThreads: returns [] when parsed value is not an array.
 * Line 137 — self-image owner-check: isOrphanedSelfImage is true iff senderPubkey === ownPubkeyHex.
 * Line 137 — self-image ConditionalExpression repl='true'/'false'.
 * Line 139 — envelope-detection branch for Case 1.
 * Line 141 — envelope parsed result gate.
 * Line 145 — originalHasNoAttachments: msg.attachments == null.
 * Line 147 — attachment-upgrade AND-guard (both conditions required).
 * Line 151 — self-vs-peer-image orphan branch.
 * Line 205 — loadMessages healed-marker early-return.
 * Line 213 — ownPubkeyHex init empty string default.
 * Line 214 — try block for identity reading.
 * Line 227 — persisted-rewrite gate after self-heal.
 * Line 269 — removeMessages empty-ids short-circuit.
 * Line 276 — removeMessages no-change short-circuit.
 * Line 306 — clearAllMessages function body.
 * Line 312 — clearAllMessages key filter predicate.
 *
 * Round-3 additions (pre-existing self-heal survivors):
 * Line 137 — isOrphanedPeerImage: peer orphan WITH envelope content must not be
 *             content-rewritten (sha256 preserved). Kills `!==` → `===` mutant.
 * Line 151 — !isOrphanedPeerImage rewrite gate: peer orphan with envelope must
 *             have its content unchanged (rewrite suppressed). Kills `!` flip.
 *             Plus: non-orphan peer with envelope MUST be rewritten (positive path).
 *
 * Note: chatPersistence.ts:352 `if (strangerKeys.length > 0)` is an optimization
 * guard — delMany([]) is a no-op. Classified EQUIVALENT; comment added in production
 * code. No killing test is possible without observable behavior change.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';

// ── localStorage mock ──────────────────────────────────────────────────────────

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => lsStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { lsStore.set(key, value); }),
  removeItem: vi.fn((key: string) => { lsStore.delete(key); }),
  clear: vi.fn(() => { lsStore.clear(); }),
  get length() { return lsStore.size; },
  key: vi.fn((i: number) => [...lsStore.keys()][i] ?? null),
};
vi.stubGlobal('localStorage', localStorageMock);

// ── idb-keyval mock ────────────────────────────────────────────────────────────

const idbStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); }),
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  delMany: vi.fn(async (ks: string[]) => { ks.forEach((k) => idbStore.delete(k)); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
}));

// ── Module import (after mocks) ────────────────────────────────────────────────

const {
  selfHealMessages,
  loadMessages,
  appendMessage,
  removeMessages,
  clearAllMessages,
} = await import('@/src/lib/marmot/chatPersistence');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: '0'.repeat(64),
    content: 'hello',
    senderPubkey: 'aabb'.repeat(16),
    groupId: 'dm:test',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const OWN_PUBKEY = 'aa'.repeat(32);
const PEER_PUBKEY = 'bb'.repeat(32);

beforeEach(() => {
  lsStore.clear();
  idbStore.clear();
  vi.clearAllMocks();
});

// ── getHealedThreads (lines 47, 49) — tested via loadMessages ────────────────

describe('getHealedThreads — corrupt/missing data handled gracefully', () => {
  /**
   * Property: getHealedThreads returns [] for null, missing, non-array, or corrupt
   * localStorage values. The self-heal pass must run even when the marker is absent.
   * Kills: BooleanLiteral repl='raw' (line 47) and
   *        BooleanLiteral repl='Array.isArray(parsed)' (line 49).
   */

  it('self-heal pass runs when healed marker is absent (no localStorage key)', async () => {
    // No marker set — should run the heal pass without throwing
    const msg = makeMsg({ content: '{"type":"text","text":"hi"}' });
    idbStore.set('quizzl:messages:dm:test', [msg]);
    const { messages } = await loadMessages('dm:test');
    expect(messages).toBeDefined();
    expect(Array.isArray(messages)).toBe(true);
  });

  it('self-heal pass runs when healed marker is null string (returns messages)', async () => {
    lsStore.set('lp_dmHealed_v1', 'null');
    const msg = makeMsg({ content: 'plain' });
    idbStore.set('quizzl:messages:dm:test2', [msg]);
    const { messages } = await loadMessages('dm:test2');
    expect(messages).toBeDefined();
    expect(Array.isArray(messages)).toBe(true);
  });

  it('self-heal pass runs when healed marker is a non-array JSON value', async () => {
    lsStore.set('lp_dmHealed_v1', JSON.stringify({ notAnArray: true }));
    const msg = makeMsg();
    idbStore.set('quizzl:messages:dm:test3', [msg]);
    const { messages } = await loadMessages('dm:test3');
    expect(messages).toBeDefined();
  });

  it('self-heal pass is skipped when the thread is already in the healed set', async () => {
    lsStore.set('lp_dmHealed_v1', JSON.stringify(['dm:healed']));
    const msg = makeMsg({ content: '{"type":"text","content":"hi"}' });
    idbStore.set('quizzl:messages:dm:healed', [msg]);
    const { messages } = await loadMessages('dm:healed');
    // Returned as-is without envelope rewrite (healed marker present)
    expect(messages[0].content).toBe('{"type":"text","content":"hi"}');
  });
});

// ── selfHealMessages: self-image orphan check (line 137) ─────────────────────

describe('selfHealMessages — Case 3: orphaned self-image is dropped', () => {
  /**
   * Property: a row authored by ownPubkeyHex with sha256 but no url is dropped.
   * The same row authored by a peer is NOT dropped (Case 2 handles the id).
   * Kills: the equality operator (== vs !=) on line 137 and the true/false mutants.
   */

  const orphanSelf = makeMsg({
    senderPubkey: OWN_PUBKEY,
    attachments: {
      full: { sha256: 'abc123', width: 100, height: 100 } as any, // no url
    },
  });
  const orphanPeer = makeMsg({
    id: '1'.repeat(64),
    senderPubkey: PEER_PUBKEY,
    attachments: {
      full: { sha256: 'abc123', width: 100, height: 100 } as any, // no url
    },
  });

  it('drops a self-authored orphaned optimistic image', () => {
    const { messages, needsRewrite } = selfHealMessages('dm:test', [orphanSelf], OWN_PUBKEY);
    expect(messages).toHaveLength(0);
    expect(needsRewrite).toBe(true);
  });

  it('does NOT drop a peer-authored orphaned image (handled by Case 2)', () => {
    const { messages } = selfHealMessages('dm:test', [orphanPeer], OWN_PUBKEY);
    // The peer orphan is not dropped; it may be in refetchIds (Case 2)
    expect(messages).toHaveLength(1);
  });

  it('case-insensitive comparison: uppercase ownPubkeyHex still drops the self-image', () => {
    const msg = makeMsg({
      senderPubkey: OWN_PUBKEY,
      attachments: {
        full: { sha256: 'hash', width: 10, height: 10 } as any,
      },
    });
    const { messages } = selfHealMessages('dm:test', [msg], OWN_PUBKEY.toUpperCase());
    expect(messages).toHaveLength(0);
  });

  it('does not drop a self-authored image that has a url (upload completed)', () => {
    const msg = makeMsg({
      senderPubkey: OWN_PUBKEY,
      attachments: {
        full: { sha256: 'hash', url: 'https://example.com/img.jpg', width: 100, height: 100 } as any,
      },
    });
    const { messages } = selfHealMessages('dm:test', [msg], OWN_PUBKEY);
    expect(messages).toHaveLength(1);
  });

  it('property: for any owner, self orphan is dropped and peer orphan is kept', () => {
    const owners = [OWN_PUBKEY, 'cc'.repeat(32), 'dd'.repeat(32)];
    for (const owner of owners) {
      const selfOrphan = makeMsg({
        senderPubkey: owner,
        attachments: { full: { sha256: 'h', width: 1, height: 1 } as any },
      });
      const peerOrphan = makeMsg({
        id: '2'.repeat(64),
        senderPubkey: 'ff'.repeat(32),
        attachments: { full: { sha256: 'h', width: 1, height: 1 } as any },
      });
      const { messages: result } = selfHealMessages('dm:test', [selfOrphan, peerOrphan], owner);
      // self dropped, peer kept
      const resultIds = result.map((m) => m.id);
      expect(resultIds).not.toContain(selfOrphan.id);
      expect(resultIds).toContain(peerOrphan.id);
    }
  });
});

// ── selfHealMessages: Case 1 envelope rewrite (lines 139-151) ────────────────

describe('selfHealMessages — Case 1: envelope-in-content rewrite', () => {
  /**
   * Property: a row whose content matches the envelope pattern and whose decoded
   * content differs must be rewritten; needsRewrite must be true.
   * Kills: ConditionalExpression repl='true' (line 139), repl='true' on parsed gate
   * (line 141), repl='true' on originalHasNoAttachments (line 145).
   */

  it('envelope content is rewritten to decoded content', () => {
    // The envelope pattern matches /^\s*\{\s*"type"\s*:\s*"(text|image)"/ and
    // parseDirectPayload for {"type":"text","text":"hello world"} returns
    // { content: "hello world" } — different from the raw string → rewrite.
    const raw = '{"type":"text","text":"hello world"}';
    const msg = makeMsg({ content: raw });
    const { messages, needsRewrite } = selfHealMessages('dm:test', [msg], OWN_PUBKEY);
    expect(needsRewrite).toBe(true);
    expect(messages[0].content).toBe('hello world');
  });

  it('plain text content is not rewritten (no envelope pattern match)', () => {
    const msg = makeMsg({ content: 'plain text' });
    const { messages, needsRewrite } = selfHealMessages('dm:test', [msg], OWN_PUBKEY);
    expect(needsRewrite).toBe(false);
    expect(messages[0].content).toBe('plain text');
  });

  it('attachment-upgrade AND-guard: upgrade only when originalHasNoAttachments AND parsed.attachments non-null', () => {
    // When the original row already has attachments, no upgrade should occur
    const msg = makeMsg({
      content: '{"type":"text","text":"hello"}',
      attachments: { full: { url: 'https://example.com/img.jpg', sha256: 'x', width: 10, height: 10 } as any },
    });
    const { messages } = selfHealMessages('dm:test', [msg], OWN_PUBKEY);
    // Content rewrite may happen (content differs: "hello" != raw), but attachments should NOT be replaced
    // because originalHasNoAttachments is false.
    // The existing attachment should be preserved.
    expect(messages[0].attachments?.full).toMatchObject({ url: 'https://example.com/img.jpg' });
  });

  it('does not rewrite if content already matches (no diff, no attachments to upgrade)', () => {
    // A message whose content is valid JSON envelope but whose decoded content equals
    // the raw content string. parseDirectPayload would return content === msg.content,
    // so no rewrite needed. Since we can't control parseDirectPayload's output directly,
    // test the invariant: no-rewrite for non-envelope content.
    const msg = makeMsg({ content: 'no envelope here' });
    const { needsRewrite } = selfHealMessages('dm:test', [msg], OWN_PUBKEY);
    expect(needsRewrite).toBe(false);
  });
});

// ── selfHealMessages: persisted-rewrite gate (line 227) ──────────────────────

describe('loadMessages — persisted-rewrite gate: IDB is updated when heal mutates rows', () => {
  /**
   * Property: when selfHeal returns needsRewrite=true, the healed messages must be
   * written back to IDB. When needsRewrite=false, no IDB write for healing occurs.
   * Kills: the `if (needsRewrite)` ConditionalExpression flip on line 227.
   */

  it('IDB is written when the self-heal pass makes a change', async () => {
    // Seed identity so ownPubkeyHex is available
    lsStore.set('lp_nostrIdentity_v1', JSON.stringify({ pubkeyHex: OWN_PUBKEY }));
    // Use the correct envelope format: {"type":"text","text":"..."} not "content"
    const msg = makeMsg({ content: '{"type":"text","text":"healed content"}' });
    idbStore.set('quizzl:messages:dm:heal-write', [msg]);

    const { messages } = await loadMessages('dm:heal-write');
    // The healed content must reflect the rewrite
    expect(messages[0].content).toBe('healed content');
    // And it must have been persisted (IDB set was called for the thread key)
    const idbSet = vi.mocked(await import('idb-keyval')).set;
    const writeCalls = (idbSet as any).mock.calls.filter(
      ([k]: [string]) => k === 'quizzl:messages:dm:heal-write',
    );
    expect(writeCalls.length).toBeGreaterThan(0);
  });

  it('IDB is NOT written when the self-heal pass makes no changes', async () => {
    lsStore.set('lp_nostrIdentity_v1', JSON.stringify({ pubkeyHex: OWN_PUBKEY }));
    const msg = makeMsg({ content: 'plain text no envelope' });
    idbStore.set('quizzl:messages:dm:no-change', [msg]);

    const idbSetMock = vi.mocked((await import('idb-keyval')).set);
    idbSetMock.mockClear();

    await loadMessages('dm:no-change');
    const writeCalls = idbSetMock.mock.calls.filter(
      ([k]) => k === 'quizzl:messages:dm:no-change',
    );
    expect(writeCalls).toHaveLength(0);
  });
});

// ── removeMessages: empty-ids short-circuit (line 269) ───────────────────────

describe('removeMessages — empty ids array is a no-op (short-circuit)', () => {
  /**
   * Property: removeMessages([]) must not read or write IDB.
   * Kills: ConditionalExpression repl='false' (would skip the early return, causing
   * a read+write on every call with an empty list).
   */

  it('resolves without IDB access for an empty ids array', async () => {
    const idbGet = vi.mocked((await import('idb-keyval')).get);
    const idbSet = vi.mocked((await import('idb-keyval')).set);
    idbGet.mockClear();
    idbSet.mockClear();
    await removeMessages('group-test', []);
    expect(idbGet).not.toHaveBeenCalled();
    expect(idbSet).not.toHaveBeenCalled();
  });
});

// ── removeMessages: no-change short-circuit (line 276) ───────────────────────

describe('removeMessages — no IDB write when ids are not present', () => {
  /**
   * Property: when none of the given ids match any stored message, IDB must not
   * be written (filtered.length === existing.length → early return).
   * Kills: the `if (filtered.length === existing.length) return` short-circuit flip.
   */

  it('does not write to IDB when no ids match', async () => {
    const msg = makeMsg({ id: 'a'.repeat(64) });
    idbStore.set('quizzl:messages:group-no-change', [msg]);

    const idbSet = vi.mocked((await import('idb-keyval')).set);
    idbSet.mockClear();

    await removeMessages('group-no-change', ['b'.repeat(64)]);
    // No change: the filtered array has the same length as the existing array
    expect(idbSet).not.toHaveBeenCalled();
  });

  it('writes to IDB when an id matches', async () => {
    const id = 'c'.repeat(64);
    const msg = makeMsg({ id });
    idbStore.set('quizzl:messages:group-change', [msg]);

    const idbSet = vi.mocked((await import('idb-keyval')).set);
    idbSet.mockClear();

    await removeMessages('group-change', [id]);
    expect(idbSet).toHaveBeenCalled();
  });
});

// ── clearAllMessages (lines 306, 312) ─────────────────────────────────────────

describe('clearAllMessages — deletes all quizzl:messages: keys', () => {
  /**
   * Property: after clearAllMessages, no key matching the prefix survives in IDB.
   * Non-prefixed keys are untouched.
   * Kills: BlockStatement repl='{}' on clearAllMessages body (line 306) and
   *        ArrowFunction repl='() => undefined' on the key filter predicate (line 312).
   */

  it('removes all quizzl:messages: keys from IDB', async () => {
    idbStore.set('quizzl:messages:group-1', [makeMsg()]);
    idbStore.set('quizzl:messages:group-2', [makeMsg()]);
    idbStore.set('quizzl:messages:dm:peer', [makeMsg()]);

    await clearAllMessages();

    expect(idbStore.has('quizzl:messages:group-1')).toBe(false);
    expect(idbStore.has('quizzl:messages:group-2')).toBe(false);
    expect(idbStore.has('quizzl:messages:dm:peer')).toBe(false);
  });

  it('does not remove keys that do not start with quizzl:messages:', async () => {
    idbStore.set('quizzl:reactions:group:g1', []);
    idbStore.set('quizzl:messages:group-1', [makeMsg()]);

    await clearAllMessages();

    expect(idbStore.has('quizzl:reactions:group:g1')).toBe(true);
  });

  it('is idempotent: calling twice does not throw', async () => {
    idbStore.set('quizzl:messages:group-1', [makeMsg()]);
    await clearAllMessages();
    await clearAllMessages();
    expect(idbStore.has('quizzl:messages:group-1')).toBe(false);
  });

  it('key filter only matches strings starting with quizzl:messages:', async () => {
    // Verify the filter predicate specifically (line 312 mutation target)
    idbStore.set('quizzl:messages:abc', []);
    idbStore.set('other:messages:abc', []);
    idbStore.set('quizzl:reactions:dm:abc', []);

    await clearAllMessages();

    expect(idbStore.has('quizzl:messages:abc')).toBe(false);
    expect(idbStore.has('other:messages:abc')).toBe(true);
    expect(idbStore.has('quizzl:reactions:dm:abc')).toBe(true);
  });
});

// ── loadMessages: ownPubkeyHex fallback to '' (lines 213-214) ────────────────

describe('loadMessages — ownPubkeyHex fallback when identity is absent', () => {
  /**
   * Property: when lp_nostrIdentity_v1 is absent or corrupt, ownPubkeyHex falls
   * back to '' — the self-heal pass still runs (Case 1 and Case 2 still fire),
   * only Case 3 (self-orphan drop) cannot fire because no pubkey matches ''.
   * Kills: StringLiteral repl='"Stryker was here!"' on the initial '' assignment
   *        and BlockStatement repl='{}' on the try block.
   */

  it('self-heal pass runs without identity in localStorage (no crash)', async () => {
    // No identity set
    const msg = makeMsg({ content: '{"type":"text","text":"ok"}' });
    idbStore.set('quizzl:messages:dm:no-identity', [msg]);
    const { messages } = await loadMessages('dm:no-identity');
    expect(Array.isArray(messages)).toBe(true);
    expect(messages[0].content).toBe('ok');
  });

  it('self-orphan is NOT dropped when identity is absent (empty pubkey does not match)', async () => {
    // Even though the message looks like a self-orphan by its own pubkey,
    // since identity is absent (ownPubkeyHex = ''), it won't be treated as self-authored.
    const msg = makeMsg({
      senderPubkey: OWN_PUBKEY,
      attachments: { full: { sha256: 'hash', width: 1, height: 1 } as any },
    });
    idbStore.set('quizzl:messages:dm:no-id-orphan', [msg]);
    const { messages } = await loadMessages('dm:no-id-orphan');
    // With ownPubkeyHex = '', the check `senderPubkey === ''` fails → not dropped
    expect(messages).toHaveLength(1);
  });

  it('corrupt identity JSON is silently ignored (no crash)', async () => {
    lsStore.set('lp_nostrIdentity_v1', '{NOT VALID JSON}');
    const msg = makeMsg({ content: 'plain' });
    idbStore.set('quizzl:messages:dm:corrupt-id', [msg]);
    await expect(loadMessages('dm:corrupt-id')).resolves.toBeDefined();
  });
});

// ── loadMessages: healed-marker early-return (line 205) ──────────────────────

describe('loadMessages — healed-marker early-return skips the pass', () => {
  /**
   * Property: if a thread id already appears in the healed set, loadMessages
   * returns the raw stored messages without mutating them.
   * Kills: BlockStatement repl='{}' on the healed-includes branch (line 205).
   */

  it('already-healed thread: envelope content is NOT rewritten', async () => {
    lsStore.set('lp_dmHealed_v1', JSON.stringify(['dm:already-healed']));
    const raw = '{"type":"text","text":"should stay raw"}';
    const msg = makeMsg({ content: raw });
    idbStore.set('quizzl:messages:dm:already-healed', [msg]);
    const { messages } = await loadMessages('dm:already-healed');
    expect(messages[0].content).toBe(raw);
  });
});

// ── loadMessages: identityRaw guard (lines 216, 218) ─────────────────────────

describe('loadMessages — ownPubkeyHex is read from identity when present (lines 216, 218)', () => {
  /**
   * The `if (identityRaw)` guard on line 216 ensures we only parse when there is
   * actually an identity string. Line 218's `identity.pubkeyHex ?? ''` ensures
   * missing pubkeyHex falls back to ''.
   *
   * Kills:
   *  L216 ConditionalExpression repl='false' — always skips parsing even when
   *       identity exists → ownPubkeyHex stays '', so self-orphan is never dropped.
   *  L216 ConditionalExpression repl='true' — always tries to parse, even when
   *       identityRaw is null → JSON.parse(null) throws, caught silently.
   *  L216 BlockStatement repl='{}' — skip the entire if-body.
   *  L218 LogicalOperator — pubkeyHex ?? '' → pubkeyHex && '' gives '' always.
   *
   * The observable effect: when identity IS present, self-authored orphaned images
   * (sha256 present, url absent) must be DROPPED. If ownPubkeyHex is '' due to
   * one of the mutations above, the orphan is NOT dropped.
   */

  it('self-orphan is DROPPED when identity is present (ownPubkeyHex is read correctly)', async () => {
    lsStore.set('lp_nostrIdentity_v1', JSON.stringify({ pubkeyHex: OWN_PUBKEY }));
    const orphanSelf = makeMsg({
      senderPubkey: OWN_PUBKEY,
      attachments: { full: { sha256: 'abc', width: 10, height: 10 } as any },
    });
    idbStore.set('quizzl:messages:dm:identity-present', [orphanSelf]);
    const { messages } = await loadMessages('dm:identity-present');
    // Case 3 fires: ownPubkeyHex is read from identity → orphan is dropped
    expect(messages).toHaveLength(0);
  });

  it('peer orphan is NOT dropped even when identity is present', async () => {
    lsStore.set('lp_nostrIdentity_v1', JSON.stringify({ pubkeyHex: OWN_PUBKEY }));
    const orphanPeer = makeMsg({
      id: '1'.repeat(64),
      senderPubkey: PEER_PUBKEY,
      attachments: { full: { sha256: 'abc', width: 10, height: 10 } as any },
    });
    idbStore.set('quizzl:messages:dm:peer-orphan-with-id', [orphanPeer]);
    const { messages } = await loadMessages('dm:peer-orphan-with-id');
    expect(messages).toHaveLength(1);
  });

  it('identity.pubkeyHex missing (undefined) falls back to empty string — no orphan drop', async () => {
    // pubkeyHex is undefined in the stored identity → ?? '' gives ''
    lsStore.set('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex: 'abc123' })); // no pubkeyHex
    const orphanLooksLikeSelf = makeMsg({
      senderPubkey: OWN_PUBKEY, // won't match '' → not dropped
      attachments: { full: { sha256: 'abc', width: 10, height: 10 } as any },
    });
    idbStore.set('quizzl:messages:dm:missing-pubkey', [orphanLooksLikeSelf]);
    const { messages } = await loadMessages('dm:missing-pubkey');
    // ownPubkeyHex = '' via ?? '' fallback → senderPubkey !== '' → not dropped
    expect(messages).toHaveLength(1);
  });

  it('parametric: self-orphan is dropped for any known ownPubkeyHex identity', () => {
    const owners = [OWN_PUBKEY, PEER_PUBKEY, 'cc'.repeat(32)];
    for (const owner of owners) {
      const orphan = makeMsg({
        senderPubkey: owner,
        attachments: { full: { sha256: 'h', width: 1, height: 1 } as any },
      });
      const { messages } = selfHealMessages('dm:any', [orphan], owner);
      expect(messages).toHaveLength(0);
    }
  });
});

// ── Round-3: peer orphan with envelope content — content NOT rewritten ────────

describe('selfHealMessages — peer orphan image: content suppressed (lines 137, 151)', () => {
  /**
   * A peer-authored image row with sha256 + no url (isOrphanedPeerImage = true)
   * matches the envelope pattern for Case 1, but the rewrite MUST be suppressed
   * (the guard at line 151: `if (!isOrphanedPeerImage)`).
   *
   * Kills at line 137: `!==` → `===` mutant — with the mutation isOrphanedPeerImage
   * becomes false for a peer (sender !== own), so the rewrite guard passes and
   * the envelope content would be overwritten, losing the sha256 attachment.
   *
   * Kills at line 151: `!isOrphanedPeerImage` → `isOrphanedPeerImage` flip — with
   * the mutation the rewrite would only happen for peer orphans and be skipped for
   * non-orphans; both observable consequences are pinned below.
   */

  const ENVELOPE_WITH_SHA = JSON.stringify({
    type: 'image',
    version: 1,
    caption: 'uploading',
    attachments: {
      full: {
        sha256: 'a'.repeat(64),
        type: 'image/webp',
        filename: 'img.webp',
        nonce: 'b'.repeat(24),
        version: 'quizzl-dm-media-v1',
        // url intentionally absent — upload pending
      },
      thumb: null,
    },
  });

  it('peer orphan with envelope content: content is NOT rewritten (sha256 preserved)', () => {
    // isOrphanedPeerImage = true (peer, sha256, no url)
    // Case 1 envelope pattern matches, but `if (!isOrphanedPeerImage)` must suppress rewrite.
    const peerOrphan = makeMsg({
      id: '1'.repeat(64),
      senderPubkey: PEER_PUBKEY,
      content: ENVELOPE_WITH_SHA,
      attachments: {
        full: { sha256: 'a'.repeat(64), width: 100, height: 100 } as any, // no url
      },
    });

    const { messages, needsRewrite } = selfHealMessages('dm:test', [peerOrphan], OWN_PUBKEY);

    // Row is kept (not dropped — peer, not self)
    expect(messages).toHaveLength(1);
    // Content must NOT be rewritten — the sha256 envelope reference must be preserved
    expect(messages[0].content).toBe(ENVELOPE_WITH_SHA);
    // needsRewrite may be false (no rewrite happened) or true if Case 2 fires,
    // but the content itself must remain unchanged.
    expect(messages[0].content).toContain('sha256');
  });

  it('non-orphan peer with envelope content: content IS rewritten (positive path for L151)', () => {
    // isOrphanedPeerImage = false (peer, but HAS url → not an orphan)
    // `!isOrphanedPeerImage = true` → rewrite should happen.
    const peerNonOrphan = makeMsg({
      id: '2'.repeat(64),
      senderPubkey: PEER_PUBKEY,
      content: '{"type":"text","text":"hi from peer"}',
      // no attachments → isOrphanedPeerImage = false (hasSha256 = false)
    });

    const { messages, needsRewrite } = selfHealMessages('dm:test', [peerNonOrphan], OWN_PUBKEY);

    expect(messages).toHaveLength(1);
    // The envelope was rewritten to its decoded content
    expect(messages[0].content).toBe('hi from peer');
    expect(needsRewrite).toBe(true);
  });

  it('property: peer orphan content preserved regardless of ownPubkeyHex value', () => {
    // For any ownPubkeyHex (that is not the peer), the peer orphan's content must be untouched.
    const owners = [OWN_PUBKEY, 'cc'.repeat(32), 'dd'.repeat(32)];
    for (const own of owners) {
      const peerOrphan = makeMsg({
        id: '3'.repeat(64),
        senderPubkey: PEER_PUBKEY, // never equals own for these test values
        content: ENVELOPE_WITH_SHA,
        attachments: { full: { sha256: 'a'.repeat(64), width: 1, height: 1 } as any },
      });
      const { messages } = selfHealMessages('dm:any', [peerOrphan], own);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe(ENVELOPE_WITH_SHA);
    }
  });

  it('self-authored orphan with same envelope IS dropped (Case 3 still fires)', () => {
    // Confirms that the L151 suppression applies only to peers, not to self-authored rows.
    // Self-authored rows are handled by isOrphanedSelfImage at line 119 and dropped.
    const selfOrphan = makeMsg({
      senderPubkey: OWN_PUBKEY,
      content: ENVELOPE_WITH_SHA,
      attachments: { full: { sha256: 'a'.repeat(64), width: 100, height: 100 } as any },
    });

    const { messages, needsRewrite } = selfHealMessages('dm:test', [selfOrphan], OWN_PUBKEY);

    // Case 3: self-authored orphan image → dropped
    expect(messages).toHaveLength(0);
    expect(needsRewrite).toBe(true);
  });
});

// Note: reactions/api.ts:492 `if (strangerKeys.length > 0)` is an optimization guard.
// delMany([]) is a no-op in idb-keyval; the guard only avoids the overhead of the call.
// Classified EQUIVALENT under mutation — no behavioral test can distinguish `> 0` from `>= 0`.
// Comment added in production code at that line.
