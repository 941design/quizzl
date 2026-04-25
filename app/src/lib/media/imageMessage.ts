import { parseMediaImetaTag, type MediaAttachment } from '@internet-privacy/marmot-ts';

export type ImageMessageContent = {
  type: 'image';
  version: 1;
  caption: string;
};

/**
 * Image-message attachments keyed by role.
 *
 * This is the *persisted* shape: parsed from the original `imeta` tags so the
 * `full` vs `thumb` classification stays explicit. Earlier we stored a flat
 * `MediaAttachment[]` and inferred role from filename or index — that broke
 * for any sender outside Quizzl's exact filename convention.
 */
export type RoledAttachments = {
  full: MediaAttachment | null;
  thumb: MediaAttachment | null;
};

export function buildImageMessageContent(caption: string): string {
  const content: ImageMessageContent = { type: 'image', version: 1, caption };
  return JSON.stringify(content);
}

export function parseImageMessageContent(content: string): ImageMessageContent | null {
  try {
    const parsed = JSON.parse(content);
    // Strict version check: a future sender stamping `version: 2` must fail
    // closed on this older client rather than be silently coerced to v1 and
    // mis-rendered.
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      parsed.type !== 'image' ||
      parsed.version !== 1
    ) {
      return null;
    }
    return {
      type: 'image',
      version: 1,
      caption: typeof parsed.caption === 'string' ? parsed.caption : '',
    };
  } catch {
    return null;
  }
}

export function extractAttachmentsByRole(tags: string[][]): RoledAttachments {
  const result: RoledAttachments = { full: null, thumb: null };

  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;

    let role: string | undefined;
    for (let i = 1; i < tag.length; i++) {
      if (tag[i].startsWith('role ')) {
        role = tag[i].slice(5);
        break;
      }
    }

    const attachment = parseMediaImetaTag(tag);
    if (!attachment) continue;

    if (role === 'thumb') {
      result.thumb = attachment;
    } else {
      // role 'full' or missing (treat as full per spec)
      result.full = attachment;
    }
  }

  return result;
}
