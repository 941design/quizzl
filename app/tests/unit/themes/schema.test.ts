import { describe, expect, it } from 'vitest';
import { ThemeManifestSchema, validateManifest } from '@/src/themes/schema';
import { calmManifestFixture, minecraftManifestFixture } from './fixtures';

describe('themes/schema', () => {
  it('accepts a conforming manifest (calm fixture)', () => {
    expect(() => validateManifest(calmManifestFixture)).not.toThrow();
    const parsed = validateManifest(calmManifestFixture);
    expect(parsed.id).toBe('calm');
    expect(parsed.order).toBe(1);
  });

  it('accepts a conforming manifest with contentSurface + contentPanel (minecraft fixture)', () => {
    expect(() => validateManifest(minecraftManifestFixture)).not.toThrow();
  });

  it('rejects a manifest missing a required field', () => {
    const { label: _label, ...withoutLabel } = calmManifestFixture;
    expect(() => validateManifest(withoutLabel)).toThrow();
  });

  it('rejects a manifest with a mistyped field (order as string)', () => {
    const malformed = { ...calmManifestFixture, order: '1' as unknown as number };
    expect(() => validateManifest(malformed)).toThrow();
  });

  it('rejects an id that does not match ^[a-z][a-z0-9-]*$', () => {
    const malformed = { ...calmManifestFixture, id: 'Calm-Theme!' };
    expect(() => validateManifest(malformed)).toThrow();
  });

  it('rejects unexpected/extra top-level keys (strict schema, not permissive passthrough)', () => {
    const withExtra = { ...calmManifestFixture, unexpectedField: 'nope' };
    expect(() => validateManifest(withExtra)).toThrow();
  });

  it('rejects an unknown treatments.card value', () => {
    const malformed = {
      ...calmManifestFixture,
      treatments: { ...calmManifestFixture.treatments, card: 'shiny' },
    };
    expect(() => validateManifest(malformed)).toThrow();
  });

  it('safeParse reports failure without throwing, for callers that want it', () => {
    const result = ThemeManifestSchema.safeParse({ ...calmManifestFixture, order: -1 });
    expect(result.success).toBe(false);
  });

  it('does not silently return a partially-valid object on failure', () => {
    let thrown: unknown;
    try {
      validateManifest({ ...calmManifestFixture, colors: undefined });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
  });
});
