/**
 * Unit tests for keyPackages.ts — MLS KeyPackage publication / replenishment.
 *
 * Protocol-critical (kind-443 KeyPackages gate every group invite) but pure
 * dependency-injection: every function takes a KeyPackageManager, so the real
 * behaviour is exercised with a stub manager — no IDB, no network, no marmot-ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  publishKeyPackages,
  countAvailableKeyPackages,
  replenishKeyPackagesIfNeeded,
  KEY_PACKAGE_COUNT,
  KEY_PACKAGE_REPLENISH_THRESHOLD,
} from '@/src/lib/keyPackages';
import { DEFAULT_RELAYS } from '@/src/types';

type Pkg = { used: boolean };

function makeManager(opts: { listResult?: Pkg[]; listRejects?: boolean; createRejectAt?: number[] } = {}) {
  let createCall = -1;
  return {
    create: vi.fn(async () => {
      createCall += 1;
      if (opts.createRejectAt?.includes(createCall)) throw new Error('relay down');
    }),
    list: vi.fn(async () => {
      if (opts.listRejects) throw new Error('idb error');
      return opts.listResult ?? [];
    }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('publishKeyPackages', () => {
  it('publishes `count` packages and returns the success count', async () => {
    const mgr = makeManager();
    const published = await publishKeyPackages(mgr, 3, ['wss://r']);
    expect(published).toBe(3);
    expect((mgr as unknown as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledTimes(3);
  });

  it('defaults to KEY_PACKAGE_COUNT packages when count is omitted', async () => {
    const mgr = makeManager();
    const published = await publishKeyPackages(mgr);
    expect(published).toBe(KEY_PACKAGE_COUNT);
    expect((mgr as unknown as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledTimes(KEY_PACKAGE_COUNT);
  });

  it('marks ONLY the last package as last-resort', async () => {
    const mgr = makeManager();
    await publishKeyPackages(mgr, 3, ['wss://r']);
    const create = (mgr as unknown as { create: ReturnType<typeof vi.fn> }).create;
    expect(create.mock.calls[0][0].isLastResort).toBe(false);
    expect(create.mock.calls[1][0].isLastResort).toBe(false);
    expect(create.mock.calls[2][0].isLastResort).toBe(true);
  });

  it('passes the provided relays and the nostling client tag through', async () => {
    const mgr = makeManager();
    await publishKeyPackages(mgr, 1, ['wss://a', 'wss://b']);
    const arg = (mgr as unknown as { create: ReturnType<typeof vi.fn> }).create.mock.calls[0][0];
    expect(arg.relays).toEqual(['wss://a', 'wss://b']);
    expect(arg.client).toBe('nostling');
  });

  it('defaults to DEFAULT_RELAYS when relays are omitted', async () => {
    const mgr = makeManager();
    await publishKeyPackages(mgr, 1);
    const arg = (mgr as unknown as { create: ReturnType<typeof vi.fn> }).create.mock.calls[0][0];
    expect(arg.relays).toEqual([...DEFAULT_RELAYS]);
  });

  it('tolerates partial failure: a rejected create is skipped, the rest still count', async () => {
    // Reject the 2nd of 3 creates (index 1). Expect 2 successes, all 3 attempted.
    const mgr = makeManager({ createRejectAt: [1] });
    const published = await publishKeyPackages(mgr, 3, ['wss://r']);
    expect(published).toBe(2);
    expect((mgr as unknown as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledTimes(3);
  });

  it('returns 0 and never calls create when count is 0', async () => {
    const mgr = makeManager();
    const published = await publishKeyPackages(mgr, 0, ['wss://r']);
    expect(published).toBe(0);
    expect((mgr as unknown as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });
});

describe('countAvailableKeyPackages', () => {
  it('counts only unused packages', async () => {
    const mgr = makeManager({ listResult: [{ used: false }, { used: true }, { used: false }] });
    expect(await countAvailableKeyPackages(mgr)).toBe(2);
  });

  it('returns 0 for an empty list', async () => {
    const mgr = makeManager({ listResult: [] });
    expect(await countAvailableKeyPackages(mgr)).toBe(0);
  });

  it('returns 0 (not a throw) when list() rejects', async () => {
    const mgr = makeManager({ listRejects: true });
    await expect(countAvailableKeyPackages(mgr)).resolves.toBe(0);
  });
});

describe('replenishKeyPackagesIfNeeded', () => {
  it('does nothing when availability is AT the threshold (boundary: not < threshold)', async () => {
    const at = Array.from({ length: KEY_PACKAGE_REPLENISH_THRESHOLD }, () => ({ used: false }));
    const mgr = makeManager({ listResult: at });
    await replenishKeyPackagesIfNeeded(mgr, ['wss://r']);
    expect((mgr as unknown as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });

  it('does nothing when availability is above the threshold', async () => {
    const above = Array.from({ length: KEY_PACKAGE_COUNT }, () => ({ used: false }));
    const mgr = makeManager({ listResult: above });
    await replenishKeyPackagesIfNeeded(mgr, ['wss://r']);
    expect((mgr as unknown as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });

  it('publishes COUNT-available packages when below threshold (1 available -> 4 published)', async () => {
    const mgr = makeManager({ listResult: [{ used: false }] });
    await replenishKeyPackagesIfNeeded(mgr, ['wss://r']);
    expect((mgr as unknown as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledTimes(
      KEY_PACKAGE_COUNT - 1,
    );
  });

  it('publishes a full batch when none are available (0 available -> COUNT published)', async () => {
    const mgr = makeManager({ listResult: [] });
    await replenishKeyPackagesIfNeeded(mgr, ['wss://r']);
    expect((mgr as unknown as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledTimes(KEY_PACKAGE_COUNT);
  });

  it('forwards relays to the publish call', async () => {
    const mgr = makeManager({ listResult: [] });
    await replenishKeyPackagesIfNeeded(mgr, ['wss://custom']);
    const arg = (mgr as unknown as { create: ReturnType<typeof vi.fn> }).create.mock.calls[0][0];
    expect(arg.relays).toEqual(['wss://custom']);
  });
});
