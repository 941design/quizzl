/**
 * Tests for app/src/config/maintainer.ts (S1) and the publicEnv accessor.
 *
 * The module is evaluated at import time from NEXT_PUBLIC_MAINTAINER_NPUBS, so
 * the default-config assertions explicitly clear that env var and re-import
 * under a controlled state via vi.resetModules(). Without this, a process that
 * has the override set (e.g. the e2e dev server, or a deployer shell) would
 * resolve the configured key instead of the built-in default and the
 * default-value assertions would fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_HEX = 'd18c6444503864278da4417153d39b7d4fad7f3d157a5b9150a8b7eda206344d';

describe('maintainer config (S1) — default (env unset)', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
    delete process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
    vi.resetModules();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
    else process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = savedEnv;
    vi.resetModules();
  });

  it('exports MAINTAINER_PUBKEYS_HEX as a non-empty array', async () => {
    const { MAINTAINER_PUBKEYS_HEX } = await import('@/src/config/maintainer');
    expect(Array.isArray(MAINTAINER_PUBKEYS_HEX)).toBe(true);
    expect(MAINTAINER_PUBKEYS_HEX.length).toBeGreaterThan(0);
  });

  it('default pubkey decodes to the expected hex', async () => {
    const { MAINTAINER_PUBKEYS_HEX } = await import('@/src/config/maintainer');
    // The built-in npub decodes to this hex (verified independently via nip19.decode)
    expect(MAINTAINER_PUBKEYS_HEX[0]).toBe(DEFAULT_HEX);
  });

  it('MAINTAINER_ACTIVE_PUBKEY_HEX equals the first element of MAINTAINER_PUBKEYS_HEX', async () => {
    const { MAINTAINER_PUBKEYS_HEX, MAINTAINER_ACTIVE_PUBKEY_HEX } = await import('@/src/config/maintainer');
    expect(MAINTAINER_ACTIVE_PUBKEY_HEX).toBe(MAINTAINER_PUBKEYS_HEX[0]);
  });

  it('MAINTAINER_DISPLAY_NAME is the expected constant', async () => {
    const { MAINTAINER_DISPLAY_NAME } = await import('@/src/config/maintainer');
    expect(MAINTAINER_DISPLAY_NAME).toBe('Nostling Team');
  });

  it('isMaintainerPubkey returns true for a known maintainer hex', async () => {
    const { MAINTAINER_PUBKEYS_HEX, isMaintainerPubkey } = await import('@/src/config/maintainer');
    expect(isMaintainerPubkey(MAINTAINER_PUBKEYS_HEX[0])).toBe(true);
  });

  it('isMaintainerPubkey is case-insensitive', async () => {
    const { MAINTAINER_PUBKEYS_HEX, isMaintainerPubkey } = await import('@/src/config/maintainer');
    const upperHex = MAINTAINER_PUBKEYS_HEX[0].toUpperCase();
    expect(isMaintainerPubkey(upperHex)).toBe(true);
  });

  it('isMaintainerPubkey returns false for an unknown pubkey', async () => {
    const { isMaintainerPubkey } = await import('@/src/config/maintainer');
    const unknownHex = 'b'.repeat(64);
    expect(isMaintainerPubkey(unknownHex)).toBe(false);
  });
});

describe('getNextPublicMaintainerNpubs (S1 publicEnv accessor)', () => {
  it('returns undefined when the env var is not set', async () => {
    const saved = process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
    delete process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
    const { getNextPublicMaintainerNpubs } = await import('@/src/lib/publicEnv');
    expect(getNextPublicMaintainerNpubs()).toBeUndefined();
    if (saved !== undefined) process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = saved;
  });

  it('returns the env var value when set', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = 'npub1test';
    const { getNextPublicMaintainerNpubs } = await import('@/src/lib/publicEnv');
    expect(getNextPublicMaintainerNpubs()).toBe('npub1test');
    delete process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
  });
});
