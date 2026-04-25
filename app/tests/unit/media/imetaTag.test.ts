import { describe, it, expect } from 'vitest';
import type { MediaAttachment } from '@internet-privacy/marmot-ts';
import { parseMediaImetaTag } from '@internet-privacy/marmot-ts';
import { buildImetaTag } from '@/src/lib/media/imetaTag';

function makeAttachment(overrides: Partial<MediaAttachment> = {}): MediaAttachment {
  return {
    url: 'https://blossom.band/aabbcc',
    type: 'image/webp',
    sha256: 'a'.repeat(64),
    size: 102400,
    dimensions: '800x600',
    blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    filename: 'photo.webp',
    nonce: 'b'.repeat(24),
    version: 'mip04-v2',
    ...overrides,
  };
}

describe('buildImetaTag', () => {
  it('first element is "imeta"', () => {
    const tag = buildImetaTag(makeAttachment(), 'full');
    expect(tag[0]).toBe('imeta');
  });

  it('includes url, m, x, size, dim, blurhash, filename, n, v entries', () => {
    const a = makeAttachment();
    const tag = buildImetaTag(a, 'full');
    expect(tag).toContain(`url ${a.url}`);
    expect(tag).toContain(`m ${a.type}`);
    expect(tag).toContain(`x ${a.sha256}`);
    expect(tag).toContain(`size ${a.size}`);
    expect(tag).toContain(`dim ${a.dimensions}`);
    expect(tag).toContain(`blurhash ${a.blurhash}`);
    expect(tag).toContain(`filename ${a.filename}`);
    expect(tag).toContain(`n ${a.nonce}`);
    expect(tag).toContain(`v ${a.version}`);
  });

  it('includes "role full" for role full', () => {
    const tag = buildImetaTag(makeAttachment(), 'full');
    expect(tag).toContain('role full');
  });

  it('includes "role thumb" for role thumb', () => {
    const tag = buildImetaTag(makeAttachment(), 'thumb');
    expect(tag).toContain('role thumb');
  });

  it('does not include size when undefined', () => {
    const a = makeAttachment({ size: undefined });
    const tag = buildImetaTag(a, 'full');
    expect(tag.some((e) => e.startsWith('size '))).toBe(false);
  });

  it('round-trips through parseMediaImetaTag for role full', () => {
    const a = makeAttachment();
    const tag = buildImetaTag(a, 'full');
    const parsed = parseMediaImetaTag(tag);
    expect(parsed).not.toBeNull();
    expect(parsed!.url).toBe(a.url);
    expect(parsed!.sha256).toBe(a.sha256);
    expect(parsed!.type).toBe(a.type);
    expect(parsed!.filename).toBe(a.filename);
    expect(parsed!.nonce).toBe(a.nonce);
    expect(parsed!.version).toBe(a.version);
  });

  it('round-trips through parseMediaImetaTag for role thumb', () => {
    const a = makeAttachment({
      url: 'https://blossom.band/thumb',
      sha256: 'c'.repeat(64),
      filename: 'photo.webp.thumb',
      nonce: 'd'.repeat(24),
    });
    const tag = buildImetaTag(a, 'thumb');
    const parsed = parseMediaImetaTag(tag);
    expect(parsed).not.toBeNull();
    expect(parsed!.url).toBe(a.url);
    expect(parsed!.sha256).toBe(a.sha256);
    expect(parsed!.filename).toBe(a.filename);
  });

  it('role field is preserved after round-trip (role full tag entry present)', () => {
    const tag = buildImetaTag(makeAttachment(), 'full');
    expect(tag).toContain('role full');
    // parseMediaImetaTag ignores role (unknown field) — that is expected per spec
    const parsed = parseMediaImetaTag(tag);
    expect(parsed).not.toBeNull();
  });
});
