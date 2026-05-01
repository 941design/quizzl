import type { PollResult } from './pollPersistence';

/**
 * Resolve the display name for an invite_cancelled canceller.
 * ALWAYS uses the protocol-enforced MLS senderPubkey — never the
 * attacker-controlled `structured.by` field — to prevent identity spoofing.
 */
export function resolveCancellerDisplay(
  senderPubkey: string,
  profileMap: Record<string, { nickname?: string }>,
  truncate: (pubkey: string) => string,
): string {
  return profileMap[senderPubkey]?.nickname ?? truncate(senderPubkey);
}

export type StructuredContent =
  | { type: 'poll_open'; pollId: string; title: string; creatorPubkey: string }
  | { type: 'poll_close'; pollId: string; title: string; results: PollResult[]; totalVoters: number }
  | { type: 'image'; version: 1; caption: string }
  | { type: 'invite_cancelled'; pubkey: string; by: string }
  | null;

export function parseStructured(content: string): StructuredContent {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type === 'poll_open' && parsed.pollId && parsed.title) return parsed as StructuredContent;
    if (parsed?.type === 'poll_close' && parsed.pollId && parsed.title && Array.isArray(parsed.results)) return parsed as StructuredContent;
    if (parsed?.type === 'image' && parsed.version !== undefined) {
      return { type: 'image', version: 1, caption: typeof parsed.caption === 'string' ? parsed.caption : '' };
    }
    if (parsed?.type === 'invite_cancelled' && typeof parsed.pubkey === 'string' && typeof parsed.by === 'string') {
      return { type: 'invite_cancelled', pubkey: parsed.pubkey, by: parsed.by };
    }
  } catch {
    // Not JSON — plain text message
  }
  return null;
}
