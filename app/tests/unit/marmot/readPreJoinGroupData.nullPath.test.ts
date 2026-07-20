/**
 * `readPreJoinGroupData` (welcomeSubscription.ts, inline-invitation-cards
 * epic, Story S1 / AC-DATA-2) — the "no local key package matches" null
 * path.
 *
 * Constructing a genuinely non-matching real fixture (a Welcome whose
 * recipient key-package slots the invitee's MarmotClient truly cannot
 * decrypt) is impractical to assemble deterministically as a REAL marmot-ts
 * flow without also faking the underlying MLS secrets, so — following the
 * spec's documented fallback and the same convention already used by
 * `welcomeSubscriptionAutoAccept.test.ts`'s "group name unreadable" case —
 * this targeted test mocks only `getWelcome` / `getWelcomeKeyPackageRefs` /
 * `keyPackages.get` to simulate the exhausted-loop scenario, and asserts the
 * contract: `readPreJoinGroupData` resolves `null`, it never throws or
 * rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetWelcome,
  mockGetWelcomeKeyPackageRefs,
  mockReadWelcomeMarmotGroupData,
} = vi.hoisted(() => ({
  mockGetWelcome: vi.fn((rumor: unknown) => rumor),
  mockGetWelcomeKeyPackageRefs: vi.fn(() => [] as Uint8Array[]),
  mockReadWelcomeMarmotGroupData: vi.fn(async () => null as { name: string; description: string; adminPubkeys: string[] } | null),
}));

vi.mock('@internet-privacy/marmot-ts', () => ({
  getWelcome: (...args: unknown[]) => mockGetWelcome(...args),
  getWelcomeKeyPackageRefs: (...args: unknown[]) => mockGetWelcomeKeyPackageRefs(...args),
  readWelcomeMarmotGroupData: (...args: unknown[]) => mockReadWelcomeMarmotGroupData(...args),
}));

import { readPreJoinGroupData, readPreJoinGroupName } from '@/src/lib/marmot/welcomeSubscription';
import type { UnwrappedRumor } from '@/src/lib/marmot/welcomeSubscription';

function makeRumor(): UnwrappedRumor {
  return {
    id: 'rumor-id',
    pubkey: 'admin-pubkey-hex',
    created_at: Math.floor(Date.now() / 1000),
    kind: 444,
    tags: [],
    content: 'welcome-payload',
    sig: '',
  };
}

function makeMarmotClient(keyPackagesGet: ReturnType<typeof vi.fn>) {
  return {
    keyPackages: { get: keyPackagesGet },
    cryptoProvider: { getCiphersuiteImpl: vi.fn(async () => 'ciphersuite-impl-stub') },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('readPreJoinGroupData — no matching local key package (AC-DATA-2 null path)', () => {
  beforeEach(() => {
    mockGetWelcome.mockClear();
    mockGetWelcomeKeyPackageRefs.mockReset().mockReturnValue([new Uint8Array([7, 7, 7])]);
    mockReadWelcomeMarmotGroupData.mockReset().mockResolvedValue(null);
  });

  it('resolves null (not a thrown/rejected promise) when no local key package matches the Welcome', async () => {
    // A key-package ref exists, but the client has no matching private
    // package for it — the `if (!stored?.privatePackage) continue;` guard
    // skips it, the loop exhausts, and the function returns null.
    const keyPackagesGet = vi.fn(async () => undefined);
    const client = makeMarmotClient(keyPackagesGet);

    await expect(readPreJoinGroupData(makeRumor(), client)).resolves.toBeNull();
    expect(keyPackagesGet).toHaveBeenCalled();
  });

  it('resolves null when the matched key package fails to decode the Welcome (readWelcomeMarmotGroupData throws)', async () => {
    const keyPackagesGet = vi.fn(async () => ({ privatePackage: {}, publicPackage: { cipherSuite: 'stub' } }));
    mockReadWelcomeMarmotGroupData.mockRejectedValue(new Error('secrets do not match'));
    const client = makeMarmotClient(keyPackagesGet);

    await expect(readPreJoinGroupData(makeRumor(), client)).resolves.toBeNull();
  });

  it('resolves null when getWelcome itself throws (undecodable Welcome)', async () => {
    mockGetWelcome.mockImplementationOnce(() => {
      throw new Error('malformed welcome');
    });
    const client = makeMarmotClient(vi.fn());

    await expect(readPreJoinGroupData(makeRumor(), client)).resolves.toBeNull();
  });

  it('readPreJoinGroupName delegates to readPreJoinGroupData and also resolves null on the same non-matching input', async () => {
    const keyPackagesGet = vi.fn(async () => undefined);
    const client = makeMarmotClient(keyPackagesGet);

    await expect(readPreJoinGroupName(makeRumor(), client)).resolves.toBeNull();
  });
});
