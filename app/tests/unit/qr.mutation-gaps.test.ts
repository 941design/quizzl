import { afterEach, describe, expect, it, vi } from 'vitest';
import { normaliseScanPayload, canUseCameraQrScanner } from '@/src/lib/qr';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';

/**
 * Gap-closing tests derived from the contact-card-exchange pre-ship mutation
 * gate (base:mutation-testing) for qr.ts.
 *
 *  1. `normaliseScanPayload` trims its input before parsing, but no test fed it
 *     surrounding whitespace, so dropping the `value.trim()` (returning the raw
 *     value) survived. A scan-mode caller compares the returned string, so a
 *     padded scan would leak the padding downstream.
 *  2. `canUseCameraQrScanner` — the camera-capability probe — had ZERO coverage
 *     (every mutant in its body was reported NoCoverage), because it reads
 *     `window`/`navigator` globals a node test never sets. Stubbing the globals
 *     exercises both the unsupported and supported branches.
 */

const samplePubkey = 'a'.repeat(64);
const sampleNpub = pubkeyToNpub(samplePubkey);

describe('normaliseScanPayload — trims surrounding whitespace (mutation gate)', () => {
  it('returns the trimmed npub when the scan value is padded', () => {
    expect(normaliseScanPayload(`   ${sampleNpub}   `)).toBe(sampleNpub);
  });

  it('trims a padded nostr:-prefixed npub down to the bare npub', () => {
    expect(normaliseScanPayload(`  nostr:${sampleNpub}  `)).toBe(sampleNpub);
  });
});

describe('canUseCameraQrScanner — capability probe branches (mutation gate)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setGlobals(win: unknown, nav: unknown) {
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', nav);
  }

  it('is false when window is absent (SSR/prerender)', () => {
    setGlobals(undefined, { mediaDevices: { getUserMedia: () => {} } });
    expect(canUseCameraQrScanner()).toBe(false);
  });

  it('is false in an insecure context even with a camera API', () => {
    setGlobals({ isSecureContext: false }, { mediaDevices: { getUserMedia: () => {} } });
    expect(canUseCameraQrScanner()).toBe(false);
  });

  it('is false in a secure context with no getUserMedia', () => {
    setGlobals({ isSecureContext: true }, { mediaDevices: {} });
    expect(canUseCameraQrScanner()).toBe(false);
  });

  it('is false (not a throw) in a secure context whose navigator has no mediaDevices at all', () => {
    setGlobals({ isSecureContext: true }, {});
    expect(canUseCameraQrScanner()).toBe(false);
  });

  it('is false (not a throw) when navigator is absent while window is present', () => {
    setGlobals({ isSecureContext: true }, undefined);
    expect(canUseCameraQrScanner()).toBe(false);
  });

  it('is true in a secure context with a getUserMedia-capable camera API', () => {
    setGlobals({ isSecureContext: true }, { mediaDevices: { getUserMedia: () => {} } });
    expect(canUseCameraQrScanner()).toBe(true);
  });
});
