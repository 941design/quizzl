import { describe, it, expect } from 'vitest';
import {
  buildImageMessageContent,
  parseImageMessageContent,
  extractAttachmentsByRole,
} from '@/src/lib/media/imageMessage';
import { buildImetaTag } from '@/src/lib/media/imetaTag';
import type { MediaAttachment } from '@internet-privacy/marmot-ts';

function makeAttachment(overrides: Partial<MediaAttachment> = {}): MediaAttachment {
  return {
    url: 'https://blossom.band/full',
    type: 'image/webp',
    sha256: 'a'.repeat(64),
    size: 100000,
    dimensions: '800x600',
    blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    filename: 'photo.webp',
    nonce: 'b'.repeat(24),
    version: 'mip04-v2',
    ...overrides,
  };
}

describe('buildImageMessageContent', () => {
  it('returns JSON string decoding to { type:"image", version:1, caption }', () => {
    const result = buildImageMessageContent('hello world');
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ type: 'image', version: 1, caption: 'hello world' });
  });

  it('empty caption produces caption: ""', () => {
    const result = buildImageMessageContent('');
    const parsed = JSON.parse(result);
    expect(parsed.caption).toBe('');
  });
});

describe('parseImageMessageContent', () => {
  it('round-trips a non-empty caption', () => {
    const content = buildImageMessageContent('test caption');
    const parsed = parseImageMessageContent(content);
    expect(parsed).toEqual({ type: 'image', version: 1, caption: 'test caption' });
  });

  it('round-trips empty caption', () => {
    const content = buildImageMessageContent('');
    const parsed = parseImageMessageContent(content);
    expect(parsed).toEqual({ type: 'image', version: 1, caption: '' });
  });

  it('returns null for non-JSON string', () => {
    expect(parseImageMessageContent('not json')).toBeNull();
  });

  it('returns null for JSON with type !== "image"', () => {
    expect(parseImageMessageContent(JSON.stringify({ type: 'text', version: 1 }))).toBeNull();
  });

  it('returns null for JSON missing version', () => {
    expect(parseImageMessageContent(JSON.stringify({ type: 'image', caption: 'hi' }))).toBeNull();
  });

  it('returns null for unknown numeric version (forward-compat: v2 must fail closed)', () => {
    // A future sender stamping `version: 2` must not be silently coerced to v1
    // on older clients — that would mis-render a payload whose semantics we
    // do not yet understand. Strict equality on the version field is the
    // wire-format rule.
    expect(parseImageMessageContent(JSON.stringify({ type: 'image', version: 2 }))).toBeNull();
  });

  it('returns null for version: 0', () => {
    expect(parseImageMessageContent(JSON.stringify({ type: 'image', version: 0 }))).toBeNull();
  });

  it('returns null for non-numeric version (string "1")', () => {
    expect(parseImageMessageContent(JSON.stringify({ type: 'image', version: '1' }))).toBeNull();
  });

  it('returns null for poll_open discriminator (coexistence)', () => {
    const pollContent = JSON.stringify({ type: 'poll_open', pollId: 'abc' });
    expect(parseImageMessageContent(pollContent)).toBeNull();
  });

  it('returns null for poll_close discriminator (coexistence)', () => {
    const pollContent = JSON.stringify({ type: 'poll_close', pollId: 'abc' });
    expect(parseImageMessageContent(pollContent)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseImageMessageContent('')).toBeNull();
  });

  it('returns null for null JSON value', () => {
    expect(parseImageMessageContent('null')).toBeNull();
  });
});

describe('extractAttachmentsByRole', () => {
  const fullAttachment = makeAttachment();
  const thumbAttachment = makeAttachment({
    url: 'https://blossom.band/thumb',
    sha256: 'c'.repeat(64),
    filename: 'photo.webp.thumb',
    nonce: 'd'.repeat(24),
    dimensions: '320x240',
  });

  it('extracts full and thumb attachments from two imeta tags', () => {
    const tags = [buildImetaTag(fullAttachment, 'full'), buildImetaTag(thumbAttachment, 'thumb')];
    const result = extractAttachmentsByRole(tags);
    expect(result.full).not.toBeNull();
    expect(result.thumb).not.toBeNull();
    expect(result.full!.url).toBe(fullAttachment.url);
    expect(result.thumb!.url).toBe(thumbAttachment.url);
  });

  it('returns full=attachment, thumb=null when only one tag with role full', () => {
    const tags = [buildImetaTag(fullAttachment, 'full')];
    const result = extractAttachmentsByRole(tags);
    expect(result.full).not.toBeNull();
    expect(result.thumb).toBeNull();
  });

  it('treats missing role as full per spec', () => {
    // Build a tag without the role entry
    const tag = buildImetaTag(fullAttachment, 'full').filter((e) => !e.startsWith('role '));
    const result = extractAttachmentsByRole([tag]);
    expect(result.full).not.toBeNull();
    expect(result.thumb).toBeNull();
  });

  it('returns null for both when tags array is empty', () => {
    const result = extractAttachmentsByRole([]);
    expect(result.full).toBeNull();
    expect(result.thumb).toBeNull();
  });

  it('ignores non-imeta tags', () => {
    const tags = [['p', 'somepubkey'], buildImetaTag(fullAttachment, 'full')];
    const result = extractAttachmentsByRole(tags);
    expect(result.full).not.toBeNull();
    expect(result.thumb).toBeNull();
  });

  it('preserves role even when sender uses non-Quizzl filename convention', () => {
    // A foreign sender that explicitly tags `role thumb` but does not use
    // the `.thumb.` filename suffix must still be classified as a thumb.
    // The previous filename/index heuristic mis-classified these.
    const foreignFull = makeAttachment({
      url: 'https://other.example/full',
      sha256: 'e'.repeat(64),
      filename: 'image_large.png',
      dimensions: '1024x768',
    });
    const foreignThumb = makeAttachment({
      url: 'https://other.example/thumb',
      sha256: 'f'.repeat(64),
      filename: 'image_small.png',
      dimensions: '160x120',
    });
    // Tag order intentionally reversed to also rule out array-position
    // fallback: thumb comes before full.
    const tags = [
      buildImetaTag(foreignThumb, 'thumb'),
      buildImetaTag(foreignFull, 'full'),
    ];
    const result = extractAttachmentsByRole(tags);
    expect(result.full!.url).toBe(foreignFull.url);
    expect(result.thumb!.url).toBe(foreignThumb.url);
  });
});
