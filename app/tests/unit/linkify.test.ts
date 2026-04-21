import { describe, it, expect } from 'vitest';
import { splitLinks } from '@/src/lib/linkify';

describe('splitLinks', () => {
  it('returns a single text token for input without URLs', () => {
    expect(splitLinks('just some plain text')).toEqual([
      { type: 'text', value: 'just some plain text' },
    ]);
  });

  it('returns an empty array for an empty string', () => {
    expect(splitLinks('')).toEqual([]);
  });

  it('extracts a single https URL', () => {
    expect(splitLinks('https://example.com')).toEqual([
      { type: 'link', value: 'https://example.com' },
    ]);
  });

  it('extracts http URLs', () => {
    expect(splitLinks('go to http://foo.com now')).toEqual([
      { type: 'text', value: 'go to ' },
      { type: 'link', value: 'http://foo.com' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('strips a trailing period from the URL', () => {
    expect(splitLinks('see https://example.com.')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://example.com' },
      { type: 'text', value: '.' },
    ]);
  });

  it('strips multiple trailing punctuation characters', () => {
    expect(splitLinks('wow https://example.com!?')).toEqual([
      { type: 'text', value: 'wow ' },
      { type: 'link', value: 'https://example.com' },
      { type: 'text', value: '!?' },
    ]);
  });

  it('strips a trailing closing paren', () => {
    expect(splitLinks('(see https://example.com)')).toEqual([
      { type: 'text', value: '(see ' },
      { type: 'link', value: 'https://example.com' },
      { type: 'text', value: ')' },
    ]);
  });

  it('keeps query strings and paths intact', () => {
    expect(splitLinks('https://example.com/path?x=1&y=2#hash')).toEqual([
      { type: 'link', value: 'https://example.com/path?x=1&y=2#hash' },
    ]);
  });

  it('extracts multiple URLs separated by text', () => {
    expect(splitLinks('first https://a.com then http://b.org end')).toEqual([
      { type: 'text', value: 'first ' },
      { type: 'link', value: 'https://a.com' },
      { type: 'text', value: ' then ' },
      { type: 'link', value: 'http://b.org' },
      { type: 'text', value: ' end' },
    ]);
  });

  it('does not match bare domains without a protocol', () => {
    expect(splitLinks('visit example.com for info')).toEqual([
      { type: 'text', value: 'visit example.com for info' },
    ]);
  });

  it('does not match javascript: URIs', () => {
    expect(splitLinks('javascript:alert(1)')).toEqual([
      { type: 'text', value: 'javascript:alert(1)' },
    ]);
  });
});
