/**
 * useDirectReactions — read-side accessor for DM reactions (story-07, AC-45).
 *
 * Mirrors the group-side reactionsByMessageId pattern from ChatStoreContext but
 * operates on the DM namespace (quizzl:reactions:dm:{peerPubkeyHex}).
 *
 * Architecture compliance:
 * - Lives in app/src/hooks/ (allowed to import from lib/).
 * - Does NOT use ChatStoreContext (DM and group state must not share runtime state, §3 rule 3).
 * - Consumes lib/reactions/api.ts (S2) and lib/marmot/chatPersistence.ts (type-only ChatMessage).
 * - Follows the module-singleton + subscribe pattern established by unreadStore.ts and api.ts.
 */

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import type { ReactionAggregate } from '@/src/lib/reactions/api';
import {
  loadReactions,
  aggregateForMessage,
  subscribeReactions,
} from '@/src/lib/reactions/api';

/**
 * Subscribe to the DM reactions store for a given peer and return a
 * Map<messageId, ReactionAggregate[]> recomputed whenever the store changes.
 *
 * @param peerPubkeyHex - The hex pubkey of the DM conversation partner.
 * @param selfPubkey    - The hex pubkey of the local user (used for selfReacted).
 * @param messages      - The current loaded DM thread messages (for keying the map).
 *
 * Returns a new Map reference on each store-write event so React detects the change.
 */
export function useDirectReactions(
  peerPubkeyHex: string,
  selfPubkey: string,
  messages: ChatMessage[],
): Map<string, ReactionAggregate[]> {
  const [reactionsByMessageId, setReactionsByMessageId] = useState<Map<string, ReactionAggregate[]>>(new Map());
  // Keep a stable ref to messages so the subscribe listener closure uses the latest value.
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!peerPubkeyHex || !selfPubkey) {
      setReactionsByMessageId(new Map());
      return;
    }

    const thread = { kind: 'dm' as const, peerPubkeyHex };
    let cancelled = false;

    function recompute() {
      if (cancelled) return;
      loadReactions(thread).then((rows) => {
        if (cancelled) return;
        const msgs = messagesRef.current;
        const map = new Map<string, ReactionAggregate[]>();
        for (const msg of msgs) {
          const agg = aggregateForMessage(rows, msg.id, selfPubkey);
          if (agg.length > 0) {
            map.set(msg.id, agg);
          }
        }
        setReactionsByMessageId(map);
      }).catch(() => {});
    }

    // Initial load
    recompute();

    // Subscribe to changes driven by applyOptimistic / applyInboundRumor / rollback
    const unsub = subscribeReactions(thread, recompute);

    return () => {
      cancelled = true;
      unsub();
    };
  // selfPubkey and peerPubkeyHex are stable for the lifetime of the component.
  // messagesRef is updated above; the listener closure reads the latest ref value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerPubkeyHex, selfPubkey]);

  return reactionsByMessageId;
}
