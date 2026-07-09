import { npubToPubkeyHex } from '@/src/lib/nostrKeys';
import { parseContactCard } from '@/src/lib/contactCard';

export function normaliseNpubPayload(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stripped = trimmed.toLowerCase().startsWith('nostr:')
    ? trimmed.slice('nostr:'.length).trim()
    : trimmed;

  return npubToPubkeyHex(stripped) ? stripped : null;
}

/**
 * Card-aware sibling of {@link normaliseNpubPayload} (epic: contact-card-exchange,
 * story S4) — the shared QR-scan validation seam consumed by `NpubQrScanner`, and
 * from there by every scan-mode `NpubQrModal` caller (`AddContactModal` in this
 * story, `InviteMemberModal` in S5). `normaliseNpubPayload` itself is left
 * unmodified: it is still used, as-is, by `MarmotContext.inviteByNpub`, which is
 * out of this story's scope.
 *
 * Accepts everything `normaliseNpubPayload` does (a bare npub, optionally
 * `nostr:`-prefixed) PLUS a contact-card onboarding link
 * (`https://few.chat/add#c=<payload>`) or a raw base64url card payload. All
 * decode/signature-verification logic is delegated to `parseContactCard` — the
 * single card decode seam (architecture.md DD 1) — so this function never parses
 * card bytes itself. It strips an optional `nostr:` URI prefix so the returned
 * (pre-fill) string is the bare payload; `parseContactCard` independently also
 * tolerates a `nostr:` prefix, so this strip is a convenience for the returned
 * value, not a correctness requirement of the delegation. A card whose signature
 * fails to verify is rejected here (returns `null`), never silently downgraded to
 * a bare-pubkey pass (AC-PARSE-4 / VQ-S4-006).
 *
 * Returns the normalised (prefix-stripped, trimmed) string — not the parsed
 * struct — so the `onScan` contract stays a plain string end to end; callers
 * re-parse it via `parseContactCard` when they need the decoded pubkey/profile
 * (e.g. `AddContactModal.processContactInput`).
 */
export function normaliseScanPayload(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stripped = trimmed.toLowerCase().startsWith('nostr:')
    ? trimmed.slice('nostr:'.length).trim()
    : trimmed;

  const parsed = parseContactCard(stripped);
  if ('error' in parsed) return null;

  return stripped;
}

export function canUseCameraQrScanner(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}
