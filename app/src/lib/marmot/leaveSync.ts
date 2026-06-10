/**
 * leaveSync.ts — Utilities for building and processing leave-intent messages.
 *
 * Mirrors pollSync.ts. Serialises/deserialises leave-intent
 * payloads for MLS application messages (kind 13).
 */

// ---- MLS application-message kind discriminator ----

export const LEAVE_INTENT_KIND = 13;

// ---- Payload type ----

export interface LeaveIntentPayload {
  pubkey: string;
}

// ---- Serialisation ----

export function serialiseLeaveIntent(payload: LeaveIntentPayload): string {
  return JSON.stringify({ pubkey: payload.pubkey });
}

// ---- Parsing (with validation) ----

export function parseLeaveIntent(content: string): LeaveIntentPayload | null {
  try {
    const d = JSON.parse(content) as LeaveIntentPayload;
    if (typeof d.pubkey !== 'string') {
      return null;
    }
    return { pubkey: d.pubkey };
  } catch {
    return null;
  }
}
