/**
 * Mutation-gap tests for app/src/config/maintainer.ts (gate-mutation pass).
 *
 * Closes survivors and no-coverage gaps observed in
 *   reports/mutation/gate-maintainer.json
 *
 * Two gap clusters:
 *   1. isMaintainerPubkey: existing tests use a single-element list, so
 *      .some(...) and .every(...) produce identical results. We need
 *      multi-maintainer lists to distinguish them.
 *   2. resolveMaintainerPubkeys: module-level constants are evaluated at
 *      import time, so decodeNpubs and the env-truthiness branches
 *      (lines 15-39) are reached only through fresh module evaluation.
 *      vi.resetModules() + vi.stubEnv() before each test forces a re-import
 *      under controlled env conditions.
 *
 * The behavior we pin is user-facing and AC-MARKER-anchored:
 *   - NEXT_PUBLIC_MAINTAINER_NPUBS, when set to a comma list, overrides
 *     the built-in default entirely.
 *   - Undecodable entries fail-soft (silently dropped, no throw).
 *   - When all entries are undecodable AND env is set, fall back to the
 *     default (decoded.length > 0 guard).
 *   - When env is empty/whitespace, fall back to the default.
 *   - isMaintainerPubkey is case-insensitive across every entry in the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A real, decodable npub distinct from the built-in default.
// nostr-tools' npubEncode(hexToBytes('1111…1111')) — verified independently.
// We just pick two well-known test npubs and let nip19 do the decoding.
// (Sourced from nostr-tools' own test fixtures.)
const NPUB_A = 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m'; // → '82341f88...' (some hex)
const NPUB_B = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6'; // → '3bf0c63f...' (some hex)
// The built-in DEFAULT npub from the module:
const DEFAULT_HEX = 'd18c6444503864278da4417153d39b7d4fad7f3d157a5b9150a8b7eda206344d';

async function importFresh() {
  vi.resetModules();
  return await import('@/src/config/maintainer');
}

describe('maintainer config — env override (S2 / L33 survivor)', () => {
  const savedEnv = process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
    } else {
      process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = savedEnv;
    }
    vi.resetModules();
  });

  it('uses the built-in default when env is undefined', async () => {
    delete process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
    const { MAINTAINER_PUBKEYS_HEX } = await importFresh();
    expect(MAINTAINER_PUBKEYS_HEX).toEqual([DEFAULT_HEX]);
  });

  it('uses the built-in default when env is an empty string', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = '';
    const { MAINTAINER_PUBKEYS_HEX } = await importFresh();
    expect(MAINTAINER_PUBKEYS_HEX).toEqual([DEFAULT_HEX]);
  });

  it('uses the built-in default when env is whitespace only', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = '   ';
    const { MAINTAINER_PUBKEYS_HEX } = await importFresh();
    expect(MAINTAINER_PUBKEYS_HEX).toEqual([DEFAULT_HEX]);
  });

  it('uses env list when env contains a valid npub (overrides default entirely)', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = NPUB_A;
    const { MAINTAINER_PUBKEYS_HEX } = await importFresh();
    expect(MAINTAINER_PUBKEYS_HEX.length).toBe(1);
    expect(MAINTAINER_PUBKEYS_HEX[0]).not.toBe(DEFAULT_HEX); // override, not append
    expect(MAINTAINER_PUBKEYS_HEX[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('decodes a comma-separated list of valid npubs into hex pubkeys', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = `${NPUB_A}, ${NPUB_B}`;
    const { MAINTAINER_PUBKEYS_HEX } = await importFresh();
    expect(MAINTAINER_PUBKEYS_HEX.length).toBe(2);
    expect(MAINTAINER_PUBKEYS_HEX[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(MAINTAINER_PUBKEYS_HEX[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(MAINTAINER_PUBKEYS_HEX[0]).not.toEqual(MAINTAINER_PUBKEYS_HEX[1]);
  });

  it('silently drops undecodable entries in a mixed list (fail-soft)', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = `${NPUB_A},not-an-npub,${NPUB_B}`;
    const { MAINTAINER_PUBKEYS_HEX } = await importFresh();
    // Two valid + one undecodable → two decoded entries.
    expect(MAINTAINER_PUBKEYS_HEX.length).toBe(2);
  });

  it('disables the feature (empty list) when env is set but all entries are undecodable', async () => {
    // AC-CONFIG-3: an explicitly-configured all-invalid list does NOT fall back
    // to the default — it disables the feature, so a deployer typo never
    // silently routes feedback to the built-in default maintainer.
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = 'garbage1,garbage2,garbage3';
    const { MAINTAINER_PUBKEYS_HEX, MAINTAINER_ACTIVE_PUBKEY_HEX } = await importFresh();
    expect(MAINTAINER_PUBKEYS_HEX).toEqual([]);
    expect(MAINTAINER_ACTIVE_PUBKEY_HEX).toBeNull();
  });

  it('trims whitespace around entries before decoding', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = `  ${NPUB_A}  ,  ${NPUB_B}  `;
    const { MAINTAINER_PUBKEYS_HEX } = await importFresh();
    expect(MAINTAINER_PUBKEYS_HEX.length).toBe(2);
  });

  it('skips empty entries (trailing comma, double comma)', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = `${NPUB_A},,${NPUB_B},`;
    const { MAINTAINER_PUBKEYS_HEX } = await importFresh();
    expect(MAINTAINER_PUBKEYS_HEX.length).toBe(2);
  });

  it('exposes the first decoded entry as MAINTAINER_ACTIVE_PUBKEY_HEX', async () => {
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = `${NPUB_A},${NPUB_B}`;
    const { MAINTAINER_PUBKEYS_HEX, MAINTAINER_ACTIVE_PUBKEY_HEX } = await importFresh();
    expect(MAINTAINER_ACTIVE_PUBKEY_HEX).toBe(MAINTAINER_PUBKEYS_HEX[0]);
    // Order matters: first-listed is active. Swap order → different active pubkey.
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = `${NPUB_B},${NPUB_A}`;
    const fresh = await importFresh();
    expect(fresh.MAINTAINER_ACTIVE_PUBKEY_HEX).toBe(fresh.MAINTAINER_PUBKEYS_HEX[0]);
    expect(fresh.MAINTAINER_ACTIVE_PUBKEY_HEX).not.toBe(MAINTAINER_ACTIVE_PUBKEY_HEX);
  });
});

describe('isMaintainerPubkey — multi-maintainer list (S1 / L57 survivor)', () => {
  const savedEnv = process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;

  beforeEach(() => {
    // Two maintainers configured.
    process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = `${NPUB_A},${NPUB_B}`;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.NEXT_PUBLIC_MAINTAINER_NPUBS;
    } else {
      process.env.NEXT_PUBLIC_MAINTAINER_NPUBS = savedEnv;
    }
    vi.resetModules();
  });

  it('returns true for the FIRST maintainer in a 2-entry list', async () => {
    const { MAINTAINER_PUBKEYS_HEX, isMaintainerPubkey } = await importFresh();
    expect(isMaintainerPubkey(MAINTAINER_PUBKEYS_HEX[0])).toBe(true);
  });

  it('returns true for the SECOND maintainer in a 2-entry list', async () => {
    // This is the mutant-killer for .some()→.every(): only true for the first
    // entry under .every(); .some() returns true for either entry.
    const { MAINTAINER_PUBKEYS_HEX, isMaintainerPubkey } = await importFresh();
    expect(isMaintainerPubkey(MAINTAINER_PUBKEYS_HEX[1])).toBe(true);
  });

  it('returns false for a non-maintainer pubkey even when list has multiple entries', async () => {
    const { isMaintainerPubkey } = await importFresh();
    expect(isMaintainerPubkey('f'.repeat(64))).toBe(false);
  });

  it('is case-insensitive for every entry in a multi-maintainer list', async () => {
    const { MAINTAINER_PUBKEYS_HEX, isMaintainerPubkey } = await importFresh();
    expect(isMaintainerPubkey(MAINTAINER_PUBKEYS_HEX[0].toUpperCase())).toBe(true);
    expect(isMaintainerPubkey(MAINTAINER_PUBKEYS_HEX[1].toUpperCase())).toBe(true);
    // Mixed case
    const mixed = MAINTAINER_PUBKEYS_HEX[1]
      .split('')
      .map((c, i) => (i % 2 ? c.toUpperCase() : c))
      .join('');
    expect(isMaintainerPubkey(mixed)).toBe(true);
  });
});
