import { DEFAULT_RELAYS, STORAGE_KEYS } from '../types'

export function getEffectiveRelays(): string[] {
  if (typeof localStorage === 'undefined') return DEFAULT_RELAYS as string[]
  const stored = localStorage.getItem(STORAGE_KEYS.relays)
  if (!stored) return DEFAULT_RELAYS as string[]
  try {
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_RELAYS as string[]
  } catch {
    return DEFAULT_RELAYS as string[]
  }
}

export function saveRelays(urls: string[]): void {
  localStorage.setItem(STORAGE_KEYS.relays, JSON.stringify(urls))
}

/**
 * Returns true if the given URL is a valid, non-empty WebSocket relay URL
 * (wss:// or ws://).
 */
export function isValidRelayUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed.startsWith('wss://') && !trimmed.startsWith('ws://')) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.hostname.length > 0
  } catch {
    return false
  }
}
