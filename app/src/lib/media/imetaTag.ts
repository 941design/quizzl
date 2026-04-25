import type { MediaAttachment } from '@internet-privacy/marmot-ts';

export function buildImetaTag(attachment: MediaAttachment, role: 'full' | 'thumb'): string[] {
  const tag: string[] = ['imeta'];

  tag.push(`url ${attachment.url}`);
  tag.push(`m ${attachment.type}`);
  tag.push(`x ${attachment.sha256}`);

  if (attachment.size !== undefined) {
    tag.push(`size ${attachment.size}`);
  }
  if (attachment.dimensions !== undefined) {
    tag.push(`dim ${attachment.dimensions}`);
  }
  if (attachment.blurhash !== undefined) {
    tag.push(`blurhash ${attachment.blurhash}`);
  }

  tag.push(`filename ${attachment.filename}`);
  tag.push(`n ${attachment.nonce}`);
  tag.push(`v ${attachment.version}`);
  tag.push(`role ${role}`);

  return tag;
}
