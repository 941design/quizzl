/**
 * Unit tests for directMessageNotifications' active-view suppression
 * (epic: notification-domain-invariants).
 *
 *   INV-1 (off-domain rings): a DM from a peer whose thread is NOT open →
 *     incrementDirectMessage(peer).
 *   INV-2 (on-domain updates): a DM from the peer whose ContactChat thread is
 *     currently open → NO incrementDirectMessage. ContactChat renders it live
 *     and marks the thread read on its own, so the bell must not also ring.
 *
 * The pending-contact suppression (AC-OBS-1) is orthogonal and stays ahead of
 * this check — covered by the existing directMessageNotifications.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeSub = {
  filter: object;
  handlers: Array<(ev: object) => void>;
  stop: () => void;
  on: (event: string, handler: (ev: object) => void) => void;
};
function makeFakeNdk() {
  const subs: FakeSub[] = [];
  return {
    subs,
    subscribe: (filter: object) => {
      const sub: FakeSub = {
        filter,
        handlers: [],
        stop: vi.fn(),
        on(event: string, handler: (ev: object) => void) {
          this.handlers.push(handler);
        },
      };
      subs.push(sub);
      return sub;
    },
  } as { subs: FakeSub[]; subscribe: (f: object) => FakeSub };
}
async function emitEvent(sub: FakeSub, event: object) {
  await Promise.all(sub.handlers.map(async (h) => {
    const r = h(event);
    if (r instanceof Promise) await r;
  }));
}

const OWN_PRIV = 'bceef655b5a034911f1c3718ce056531b45ef03b4c7b1f15629e867294011a7d';
const OWN_PUB = 'a'.repeat(64);
const PEER_PUB = 'b'.repeat(64);

vi.mock('@/src/lib/directMessages', async () => {
  const mod = await vi.importActual<typeof import('@/src/lib/directMessages')>('@/src/lib/directMessages');
  return { ...mod, unwrapAndOpen: vi.fn<() => Promise<import('@/src/lib/directMessages').UnsignedRumor>>() };
});
vi.mock('@/src/lib/unreadStore', () => ({
  getDirectMessageLastReadAt: vi.fn(() => 0),
  incrementDirectMessage: vi.fn(),
}));
vi.mock('@/src/lib/contacts', () => ({
  rememberContact: vi.fn(),
  isPendingConfirmation: vi.fn(() => false),
}));
vi.mock('@/src/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
// Active-view registry — the SUT consults isActiveView('dm', peer).
vi.mock('@/src/lib/activeViewStore', () => ({
  isActiveView: vi.fn(() => false),
}));

const { unwrapAndOpen } = await import('@/src/lib/directMessages');
const { incrementDirectMessage } = await import('@/src/lib/unreadStore');
const { rememberContact } = await import('@/src/lib/contacts');
const { isActiveView } = await import('@/src/lib/activeViewStore');
const { subscribeDirectMessageNotifications } = await import('@/src/lib/directMessageNotifications');

const allowAll = () => true;
function kind1059(ndk: ReturnType<typeof makeFakeNdk>) {
  return ndk.subs.find((s) => JSON.stringify(s.filter).includes('"kinds":[1059]'))!;
}
function kind4(ndk: ReturnType<typeof makeFakeNdk>) {
  return ndk.subs.find((s) => JSON.stringify(s.filter).includes('"kinds":[4]'))!;
}

describe('directMessageNotifications active-view suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isActiveView).mockReturnValue(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it('INV-1: a DM from a peer whose thread is NOT open rings the bell (kind-1059)', async () => {
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r1', pubkey: PEER_PUB, kind: 14, content: 'hi', tags: [['p', OWN_PUB]], created_at: 1_700_000_000,
    });
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind1059(ndk), { id: 'w1', kind: 1059, pubkey: 'eph' });
    expect(incrementDirectMessage).toHaveBeenCalledWith(PEER_PUB);
  });

  it('INV-2: a DM from the peer whose thread IS open does NOT ring the bell (kind-1059)', async () => {
    vi.mocked(isActiveView).mockImplementation(
      (domain: string, id: string) => domain === 'dm' && id === PEER_PUB.toLowerCase(),
    );
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r2', pubkey: PEER_PUB, kind: 14, content: 'hi', tags: [['p', OWN_PUB]], created_at: 1_700_000_000,
    });
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind1059(ndk), { id: 'w2', kind: 1059, pubkey: 'eph' });
    // rememberContact still fires; only the bell is suppressed.
    expect(rememberContact).toHaveBeenCalledWith(PEER_PUB);
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('INV-2: a DM from the peer whose thread IS open does NOT ring the bell (kind-4)', async () => {
    vi.mocked(isActiveView).mockImplementation(
      (domain: string, id: string) => domain === 'dm' && id === PEER_PUB.toLowerCase(),
    );
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind4(ndk), { id: 'e4', pubkey: PEER_PUB, created_at: 1_700_000_000 });
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('INV-1: while a DIFFERENT peer thread is open, the DM still rings the bell (kind-4)', async () => {
    vi.mocked(isActiveView).mockImplementation(
      (domain: string, id: string) => domain === 'dm' && id === 'f'.repeat(64),
    );
    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV, isAllowedSender: allowAll });
    await emitEvent(kind4(ndk), { id: 'e5', pubkey: PEER_PUB, created_at: 1_700_000_000 });
    expect(incrementDirectMessage).toHaveBeenCalledWith(PEER_PUB.toLowerCase());
  });
});
