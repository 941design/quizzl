export type LinkifyToken =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string };

const URL_REGEX = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

export function splitLinks(text: string): LinkifyToken[] {
  const tokens: LinkifyToken[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const start = match.index ?? 0;
    let url = match[0];
    let trailing = '';

    const trailingMatch = url.match(TRAILING_PUNCTUATION);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      url = url.slice(0, url.length - trailing.length);
    }

    if (start > cursor) {
      tokens.push({ type: 'text', value: text.slice(cursor, start) });
    }
    tokens.push({ type: 'link', value: url });
    cursor = start + url.length;

    if (trailing) {
      tokens.push({ type: 'text', value: trailing });
      cursor += trailing.length;
    }
  }

  if (cursor < text.length) {
    tokens.push({ type: 'text', value: text.slice(cursor) });
  }

  return tokens;
}
