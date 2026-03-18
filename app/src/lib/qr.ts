import { npubToPubkeyHex } from '@/src/lib/nostrKeys';

export function normaliseNpubPayload(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stripped = trimmed.toLowerCase().startsWith('nostr:')
    ? trimmed.slice('nostr:'.length).trim()
    : trimmed;

  return npubToPubkeyHex(stripped) ? stripped : null;
}

export function canUseCameraQrScanner(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}
