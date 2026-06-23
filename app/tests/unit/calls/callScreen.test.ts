/**
 * Unit tests for CallScreen.tsx i18n — Story S7.
 *
 * @testing-library/react is not in this project. Tests verify i18n key
 * completeness and correctness through direct import of getCopy().
 *
 * Tests:
 *   T1. All 7 new i18n keys are present in the 'en' locale and non-empty.
 *   T2. All 7 new i18n keys are present in the 'de' locale and non-empty.
 *   T3. Static string values differ between 'en' and 'de' (sanity check).
 *   T4. participants(1) returns singular form in English.
 *   T5. participants(2) returns plural form in English.
 *   T6. participants(1) returns a non-empty string in German.
 *   T7. participants(2) returns a non-empty string in German.
 */

import { describe, expect, it } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

// ── Helpers ───────────────────────────────────────────────────────────────────

const en = getCopy('en').calls;
const de = getCopy('de').calls;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CallScreen i18n — English locale', () => {
  it('T1: muteAudio key is present and non-empty', () => {
    expect(en.muteAudio).toBeTruthy();
    expect(typeof en.muteAudio).toBe('string');
    expect(en.muteAudio.length).toBeGreaterThan(0);
  });

  it('T1: unmuteAudio key is present and non-empty', () => {
    expect(en.unmuteAudio).toBeTruthy();
    expect(typeof en.unmuteAudio).toBe('string');
    expect(en.unmuteAudio.length).toBeGreaterThan(0);
  });

  it('T1: cameraOff key is present and non-empty', () => {
    expect(en.cameraOff).toBeTruthy();
    expect(typeof en.cameraOff).toBe('string');
    expect(en.cameraOff.length).toBeGreaterThan(0);
  });

  it('T1: cameraOn key is present and non-empty', () => {
    expect(en.cameraOn).toBeTruthy();
    expect(typeof en.cameraOn).toBe('string');
    expect(en.cameraOn.length).toBeGreaterThan(0);
  });

  it('T1: hangUp key is present and non-empty', () => {
    expect(en.hangUp).toBeTruthy();
    expect(typeof en.hangUp).toBe('string');
    expect(en.hangUp.length).toBeGreaterThan(0);
  });

  it('T1: participants key is a function', () => {
    expect(typeof en.participants).toBe('function');
  });

  it('T1: callConnected key is present and non-empty', () => {
    expect(en.callConnected).toBeTruthy();
    expect(typeof en.callConnected).toBe('string');
    expect(en.callConnected.length).toBeGreaterThan(0);
  });
});

describe('CallScreen i18n — German locale', () => {
  it('T2: muteAudio key is present and non-empty', () => {
    expect(de.muteAudio).toBeTruthy();
    expect(typeof de.muteAudio).toBe('string');
    expect(de.muteAudio.length).toBeGreaterThan(0);
  });

  it('T2: unmuteAudio key is present and non-empty', () => {
    expect(de.unmuteAudio).toBeTruthy();
    expect(typeof de.unmuteAudio).toBe('string');
    expect(de.unmuteAudio.length).toBeGreaterThan(0);
  });

  it('T2: cameraOff key is present and non-empty', () => {
    expect(de.cameraOff).toBeTruthy();
    expect(typeof de.cameraOff).toBe('string');
    expect(de.cameraOff.length).toBeGreaterThan(0);
  });

  it('T2: cameraOn key is present and non-empty', () => {
    expect(de.cameraOn).toBeTruthy();
    expect(typeof de.cameraOn).toBe('string');
    expect(de.cameraOn.length).toBeGreaterThan(0);
  });

  it('T2: hangUp key is present and non-empty', () => {
    expect(de.hangUp).toBeTruthy();
    expect(typeof de.hangUp).toBe('string');
    expect(de.hangUp.length).toBeGreaterThan(0);
  });

  it('T2: participants key is a function', () => {
    expect(typeof de.participants).toBe('function');
  });

  it('T2: callConnected key is present and non-empty', () => {
    expect(de.callConnected).toBeTruthy();
    expect(typeof de.callConnected).toBe('string');
    expect(de.callConnected.length).toBeGreaterThan(0);
  });
});

describe('CallScreen i18n — en/de differ for static strings', () => {
  it('T3: muteAudio differs between en and de', () => {
    expect(en.muteAudio).not.toBe(de.muteAudio);
  });

  it('T3: unmuteAudio differs between en and de', () => {
    expect(en.unmuteAudio).not.toBe(de.unmuteAudio);
  });

  it('T3: hangUp differs between en and de', () => {
    expect(en.hangUp).not.toBe(de.hangUp);
  });

  it('T3: callConnected differs between en and de', () => {
    expect(en.callConnected).not.toBe(de.callConnected);
  });
});

describe('CallScreen i18n — participants function', () => {
  it('T4: en participants(1) returns singular (does not end with "participants")', () => {
    const result = en.participants(1);
    expect(result).toContain('1');
    // singular: ends with "participant", not "participants"
    expect(result).not.toMatch(/participants/);
    expect(result).toMatch(/participant/);
  });

  it('T5: en participants(2) returns plural (with trailing "s")', () => {
    const result = en.participants(2);
    expect(result).toContain('2');
    expect(result).toContain('participants');
  });

  it('T6: de participants(1) returns a non-empty string', () => {
    const result = de.participants(1);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('1');
  });

  it('T7: de participants(2) returns a non-empty string', () => {
    const result = de.participants(2);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('2');
  });
});
