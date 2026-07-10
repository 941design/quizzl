import { describe, expect, it } from 'vitest';
import { ThemeManifestSchema, validateManifest } from '@/src/themes/schema';
import { lightManifestFixture, darkContentSurfaceManifestFixture } from './fixtures';

describe('themes/schema', () => {
  it('accepts a conforming manifest (light fixture)', () => {
    expect(() => validateManifest(lightManifestFixture)).not.toThrow();
    const parsed = validateManifest(lightManifestFixture);
    expect(parsed.id).toBe('lightfixture');
    expect(parsed.order).toBe(1);
  });

  it('accepts a conforming manifest with contentSurface + contentPanel (dark contentSurface fixture)', () => {
    expect(() => validateManifest(darkContentSurfaceManifestFixture)).not.toThrow();
  });

  it('rejects a manifest missing a required field', () => {
    const { label: _label, ...withoutLabel } = lightManifestFixture;
    expect(() => validateManifest(withoutLabel)).toThrow();
  });

  it('rejects a manifest with a mistyped field (order as string)', () => {
    const malformed = { ...lightManifestFixture, order: '1' as unknown as number };
    expect(() => validateManifest(malformed)).toThrow();
  });

  it('rejects an id that does not match ^[a-z][a-z0-9-]*$', () => {
    const malformed = { ...lightManifestFixture, id: 'Calm-Theme!' };
    expect(() => validateManifest(malformed)).toThrow();
  });

  it('rejects unexpected/extra top-level keys (strict schema, not permissive passthrough)', () => {
    const withExtra = { ...lightManifestFixture, unexpectedField: 'nope' };
    expect(() => validateManifest(withExtra)).toThrow();
  });

  it('rejects an unknown treatments.card value', () => {
    const malformed = {
      ...lightManifestFixture,
      treatments: { ...lightManifestFixture.treatments, card: 'shiny' },
    };
    expect(() => validateManifest(malformed)).toThrow();
  });

  it('safeParse reports failure without throwing, for callers that want it', () => {
    const result = ThemeManifestSchema.safeParse({ ...lightManifestFixture, order: -1 });
    expect(result.success).toBe(false);
  });

  it('does not silently return a partially-valid object on failure', () => {
    let thrown: unknown;
    try {
      validateManifest({ ...lightManifestFixture, colors: undefined });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
  });
});
