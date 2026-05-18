/**
 * leaveHandler.ts
 *
 * RumorHandler for LEAVE_INTENT_KIND (kind 13).
 *
 * Mirrors pollHandler.ts. All side-effect dependencies are injected —
 * zero imports from app/src/context/.
 *
 * Boundary rules (architecture.md):
 *   - Zero imports from app/src/context/
 *   - All state-mutation deps received via injection
 */

import { LEAVE_INTENT_KIND, parseLeaveIntent } from '@/src/lib/marmot/leaveSync';
import type { ApplicationRumor, DispatcherContext, RumorHandler } from '@/src/lib/marmot/applicationRumorDispatcher';

export interface LeaveHandlerDeps {
  enqueueLeave: (groupId: string, pubkey: string) => void;
}

// ---- LEAVE_INTENT handler ---------------------------------------------------

function handleLeaveIntent(rumor: ApplicationRumor, ctx: DispatcherContext, deps: LeaveHandlerDeps): void {
  const payload = parseLeaveIntent(rumor.content);
  if (!payload) return;

  deps.enqueueLeave(ctx.groupId, payload.pubkey);
}

export function createLeaveIntentHandler(deps: LeaveHandlerDeps): RumorHandler {
  return {
    kind: LEAVE_INTENT_KIND,
    handle: (rumor: ApplicationRumor, ctx: DispatcherContext) => handleLeaveIntent(rumor, ctx, deps),
  };
}
