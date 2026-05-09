/**
 * scoreHandler.ts
 *
 * RumorHandler for SCORE_RUMOR_KIND (kind 1).
 *
 * Boundary rules (architecture.md):
 *   - Zero imports from app/src/context/
 *   - All IDB and state-setter deps received via injection
 */

import { SCORE_RUMOR_KIND, parseScorePayload } from '@/src/lib/marmot/scoreSync';
import type { ScoreUpdate } from '@/src/types';
import type { ApplicationRumor, DispatcherContext, RumorHandler } from '@/src/lib/marmot/applicationRumorDispatcher';

export interface ScoreHandlerDeps {
  mergeMemberScore: (groupId: string, pubkeyHex: string, nickname: string, update: ScoreUpdate) => Promise<void>;
}

async function handle(rumor: ApplicationRumor, ctx: DispatcherContext, deps: ScoreHandlerDeps): Promise<void> {
  const update = parseScorePayload(rumor.content);
  if (!update) return;
  // Use a short prefix of pubkey as nickname fallback — matches MarmotContext behaviour.
  await deps.mergeMemberScore(ctx.groupId, rumor.pubkey, rumor.pubkey.slice(0, 8), update);
}

export function createScoreHandler(deps: ScoreHandlerDeps): RumorHandler {
  return {
    kind: SCORE_RUMOR_KIND,
    handle: (rumor: ApplicationRumor, ctx: DispatcherContext) => handle(rumor, ctx, deps),
  };
}
