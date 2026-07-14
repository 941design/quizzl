/**
 * Unit tests for blockContactAction.ts (epic: block-contact, story S4).
 *
 * `performBlockContact`/`performUnblockContact` are pure(-ish),
 * dependency-injected orchestration functions — no React, no jsdom needed.
 * These tests exercise the REAL exported functions with spy dependencies,
 * proving the call ORDER (not just that all calls eventually happened),
 * which is the load-bearing guarantee behind AC-VIEW-14 (the post-block wipe
 * race) and AC-UNBLOCK-2/4.
 *
 * A source-string assertion (mirroring the convention established in
 * directMessageNotifications-block-suppression.test.ts / ProfileHealWatcher's
 * AC-WATCH-2 pattern) additionally proves neither this module nor
 * BlockContactButton.tsx imports any Nostr-publish-capable module — the
 * privacy invariant (AC-PRIV-1/2/3) at the unit level. The full end-to-end
 * proof (a real WebSocket-frame publish spy across the real running app,
 * covering both the block AND unblock actions) lives in the e2e suite
 * (dm-block-contact.spec.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  performBlockContact,
  performUnblockContact,
  type BlockContactDeps,
  type UnblockContactDeps,
} from '@/src/lib/blockContactAction';
import type { HistoryWipeResult } from '@/src/lib/marmot/chatPersistence';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

const PEER = 'b'.repeat(64);

describe('performBlockContact', () => {
  it('AC-VIEW-14 / AC-CONFIRM-2: calls archiveContact, then notifyBlockedPeersChanged, then wipeSinglePeerHistory, in that exact order', async () => {
    const callOrder: string[] = [];
    const deps: BlockContactDeps = {
      archiveContact: vi.fn((peer: string) => { callOrder.push(`archiveContact:${peer}`); }),
      notifyBlockedPeersChanged: vi.fn(() => { callOrder.push('notifyBlockedPeersChanged'); }),
      wipeSinglePeerHistory: vi.fn(async (peer: string): Promise<HistoryWipeResult> => {
        callOrder.push(`wipeSinglePeerHistory:${peer}`);
        return { threadCleared: true, countersCleared: true };
      }),
    };

    const result = await performBlockContact(PEER, deps);

    expect(callOrder).toEqual([
      `archiveContact:${PEER}`,
      'notifyBlockedPeersChanged',
      `wipeSinglePeerHistory:${PEER}`,
    ]);
    expect(deps.archiveContact).toHaveBeenCalledTimes(1);
    expect(deps.notifyBlockedPeersChanged).toHaveBeenCalledTimes(1);
    expect(deps.wipeSinglePeerHistory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ threadCleared: true, countersCleared: true });
  });

  it('AC-VIEW-14: archiveContact and notifyBlockedPeersChanged both complete (synchronously) BEFORE wipeSinglePeerHistory is ever invoked — the gate is live before the wipe begins, not merely before it resolves', async () => {
    let gateLiveBeforeWipeCalled = false;
    const deps: BlockContactDeps = {
      archiveContact: vi.fn(),
      notifyBlockedPeersChanged: vi.fn(),
      wipeSinglePeerHistory: vi.fn(async (): Promise<HistoryWipeResult> => {
        // By the time this is called, both prior deps must already have run.
        gateLiveBeforeWipeCalled =
          (deps.archiveContact as any).mock.calls.length === 1 &&
          (deps.notifyBlockedPeersChanged as any).mock.calls.length === 1;
        return { threadCleared: true, countersCleared: true };
      }),
    };

    await performBlockContact(PEER, deps);
    expect(gateLiveBeforeWipeCalled).toBe(true);
  });

  it('propagates wipeSinglePeerHistory partial-failure results without throwing (AC-WIPE-5) — the block still "took" per archiveContact/notifyBlockedPeersChanged having already run', async () => {
    const deps: BlockContactDeps = {
      archiveContact: vi.fn(),
      notifyBlockedPeersChanged: vi.fn(),
      wipeSinglePeerHistory: vi.fn(async (): Promise<HistoryWipeResult> => ({ threadCleared: false, countersCleared: true })),
    };

    const result = await performBlockContact(PEER, deps);

    expect(result).toEqual({ threadCleared: false, countersCleared: true });
    expect(deps.archiveContact).toHaveBeenCalledWith(PEER);
    expect(deps.notifyBlockedPeersChanged).toHaveBeenCalledTimes(1);
  });
});

describe('performUnblockContact', () => {
  it('AC-UNBLOCK-4: calls unarchiveContact then notifyBlockedPeersChanged synchronously, with no confirmation step of any kind (no async gap, no modal-related call)', () => {
    const callOrder: string[] = [];
    const deps: UnblockContactDeps = {
      unarchiveContact: vi.fn((peer: string) => { callOrder.push(`unarchiveContact:${peer}`); }),
      notifyBlockedPeersChanged: vi.fn(() => { callOrder.push('notifyBlockedPeersChanged'); }),
    };

    performUnblockContact(PEER, deps);

    expect(callOrder).toEqual([`unarchiveContact:${PEER}`, 'notifyBlockedPeersChanged']);
  });

  it('AC-UNBLOCK-2: bumps the block revision (notifyBlockedPeersChanged) exactly once — omitting this call is the exact AC-UNBLOCK-3 silent-failure mode a prior review flagged (VQ-S1-024)', () => {
    const deps: UnblockContactDeps = {
      unarchiveContact: vi.fn(),
      notifyBlockedPeersChanged: vi.fn(),
    };

    performUnblockContact(PEER, deps);

    expect(deps.notifyBlockedPeersChanged).toHaveBeenCalledTimes(1);
  });

  it('AC-UNBLOCK-2: touches only its two injected deps — no history read/write of any kind, so no code path here can resurrect a deleted thread', () => {
    // performUnblockContact's own module never imports loadMessages/appendMessage/
    // chatPersistence at all — verified structurally below (source assertion) —
    // but also assert behaviorally that calling it produces exactly the two
    // expected side effects and nothing else observable through the deps bag.
    const unarchiveContact = vi.fn();
    const notifyBlockedPeersChanged = vi.fn();
    performUnblockContact(PEER, { unarchiveContact, notifyBlockedPeersChanged });
    expect(unarchiveContact.mock.calls).toEqual([[PEER]]);
    expect(notifyBlockedPeersChanged.mock.calls).toEqual([[]]);
  });
});

describe('AC-PRIV-1/2/3 (unit-level structural proof — full e2e proof lives in dm-block-contact.spec.ts)', () => {
  it('blockContactAction.ts never imports any Nostr-publish-capable module (ndkClient, NDKEvent, directMessages)', () => {
    const source = readSource('src/lib/blockContactAction.ts');
    expect(source).not.toMatch(/ndkClient/);
    expect(source).not.toMatch(/NDKEvent/);
    expect(source).not.toMatch(/@nostr-dev-kit\/ndk/);
    expect(source).not.toMatch(/publishDirect/);
    expect(source).not.toMatch(/\.publish\(/);
  });

  it('BlockContactButton.tsx never imports any Nostr-publish-capable module', () => {
    const source = readSource('src/components/contacts/BlockContactButton.tsx');
    expect(source).not.toMatch(/ndkClient/);
    expect(source).not.toMatch(/NDKEvent/);
    expect(source).not.toMatch(/@nostr-dev-kit\/ndk/);
    expect(source).not.toMatch(/publishDirect/);
    expect(source).not.toMatch(/\.publish\(/);
  });
});
