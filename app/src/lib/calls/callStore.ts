/**
 * callStore.ts — In-memory call state store (Story S2).
 *
 * Module-level external store for `useSyncExternalStore`.
 * Call state is ephemeral (no localStorage, no IDB).
 *
 * Design constraints:
 *   - Invariant: `incoming` and `active` are never both non-null simultaneously.
 *     `setIncoming` clears `active`; `setActive` clears `incoming`.
 *
 * Pattern follows `app/src/lib/unreadStore.ts` (module-level let + Set<listener> +
 * direct `useSyncExternalStore` import from 'react').
 */

import { useSyncExternalStore } from 'react';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface IncomingCall {
  callId: string;
  callerPubkey: string;
  callType: 'voice' | 'video';
  /** groupId is null in S2; enriched by callManager in S5. */
  groupId: string | null;
  recipientPubkeys: string[];
}

export interface RemoteParticipant {
  pubkey: string;
  stream: MediaStream | null;
  muted: boolean;
  videoOff: boolean;
}

export interface ActiveCall {
  callId: string;
  participants: RemoteParticipant[];
  localStream: MediaStream | null;
  callType: 'voice' | 'video';
}

export interface CallState {
  incoming: IncomingCall | null;
  active: ActiveCall | null;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let _state: CallState = { incoming: null, active: null };
const _listeners = new Set<() => void>();

function _emit(): void {
  _listeners.forEach((l) => l());
}

// ─── Store API ────────────────────────────────────────────────────────────────

export const callStore = {
  /**
   * Subscribe to state changes — for `useSyncExternalStore`.
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  },

  /** Snapshot accessor — for `useSyncExternalStore`. */
  getSnapshot(): CallState {
    return _state;
  },

  /**
   * Set incoming call. Clears active (invariant: only one non-null at a time).
   * Pass `null` to clear the incoming state.
   */
  setIncoming(call: IncomingCall | null): void {
    _state = { incoming: call, active: null };
    _emit();
  },

  /**
   * Set active call. Clears incoming (invariant: only one non-null at a time).
   * Pass `null` to clear the active state.
   */
  setActive(call: ActiveCall | null): void {
    _state = { incoming: null, active: call };
    _emit();
  },

  /** Reset both to null. */
  clearAll(): void {
    _state = { incoming: null, active: null };
    _emit();
  },
} as const;

// ─── React hook ───────────────────────────────────────────────────────────────

const _serverSnapshot: CallState = { incoming: null, active: null };

/**
 * React hook — wraps `callStore` with `useSyncExternalStore` for safe concurrent
 * rendering.
 *
 * Usage: `const { incoming, active } = useCallStore();`
 */
export function useCallStore(): CallState {
  return useSyncExternalStore(
    callStore.subscribe,
    callStore.getSnapshot,
    // Server snapshot: always the empty state (SSR-safe)
    () => _serverSnapshot,
  );
}
