/**
 * pollHandler.ts
 *
 * RumorHandlers for POLL_OPEN_KIND (kind 10), POLL_VOTE_KIND (kind 11),
 * and POLL_CLOSE_KIND (kind 12).
 *
 * Mirrors lines 703-757 of MarmotContext.onApplicationMessage exactly.
 * All side-effect dependencies are injected — zero imports from
 * app/src/context/.
 *
 * Boundary rules (architecture.md):
 *   - Zero imports from app/src/context/
 *   - All IDB and state-setter deps received via injection
 */

import { POLL_OPEN_KIND, POLL_VOTE_KIND, POLL_CLOSE_KIND, parsePollOpen, parsePollVote, parsePollClose } from '@/src/lib/marmot/pollSync';
import type { Poll, PollVote } from '@/src/lib/marmot/pollPersistence';
import type { ApplicationRumor, DispatcherContext, RumorHandler } from '@/src/lib/marmot/applicationRumorDispatcher';

export interface PollHandlerDeps {
  savePoll: (poll: Poll) => Promise<void>;
  saveVote: (vote: PollVote) => Promise<void>;
  getPoll: (groupId: string, pollId: string) => Promise<Poll | null>;
  setPollVersion: (updater: (v: number) => number) => void;
}

// ---- POLL_OPEN handler -------------------------------------------------------

async function handleOpen(rumor: ApplicationRumor, ctx: DispatcherContext, deps: PollHandlerDeps): Promise<void> {
  const payload = parsePollOpen(rumor.content);
  if (!payload) return;

  const poll: Poll = {
    id: payload.id,
    groupId: ctx.groupId,
    title: payload.title,
    description: payload.description,
    options: payload.options,
    pollType: payload.pollType,
    creatorPubkey: payload.creatorPubkey,
    createdAt: rumor.created_at * 1000,
    closed: false,
  };

  await deps.savePoll(poll);
  deps.setPollVersion((v) => v + 1);
}

export function createPollOpenHandler(deps: PollHandlerDeps): RumorHandler {
  return {
    kind: POLL_OPEN_KIND,
    handle: (rumor: ApplicationRumor, ctx: DispatcherContext) => handleOpen(rumor, ctx, deps),
  };
}

// ---- POLL_VOTE handler -------------------------------------------------------

async function handleVote(rumor: ApplicationRumor, ctx: DispatcherContext, deps: PollHandlerDeps): Promise<void> {
  const payload = parsePollVote(rumor.content);
  if (!payload) return;

  const existingPoll = await deps.getPoll(ctx.groupId, payload.pollId);
  // Ignore votes for closed polls.
  if (existingPoll?.closed) return;

  if (!existingPoll) return;

  const vote: PollVote = {
    id: `${payload.pollId}:${rumor.pubkey}`,
    pollId: payload.pollId,
    voterPubkey: rumor.pubkey,
    responses: payload.responses,
    votedAt: rumor.created_at * 1000,
  };

  await deps.saveVote(vote);
  deps.setPollVersion((v) => v + 1);
}

export function createPollVoteHandler(deps: PollHandlerDeps): RumorHandler {
  return {
    kind: POLL_VOTE_KIND,
    handle: (rumor: ApplicationRumor, ctx: DispatcherContext) => handleVote(rumor, ctx, deps),
  };
}

// ---- POLL_CLOSE handler -----------------------------------------------------

async function handleClose(rumor: ApplicationRumor, ctx: DispatcherContext, deps: PollHandlerDeps): Promise<void> {
  const payload = parsePollClose(rumor.content);
  if (!payload) return;

  const existingPoll = await deps.getPoll(ctx.groupId, payload.pollId);
  if (!existingPoll) return;
  // Only the poll creator can close.
  if (existingPoll.creatorPubkey !== rumor.pubkey) return;

  const updated: Poll = {
    ...existingPoll,
    closed: true,
    results: payload.results,
    totalVoters: payload.totalVoters,
  };

  await deps.savePoll(updated);
  deps.setPollVersion((v) => v + 1);
}

export function createPollCloseHandler(deps: PollHandlerDeps): RumorHandler {
  return {
    kind: POLL_CLOSE_KIND,
    handle: (rumor: ApplicationRumor, ctx: DispatcherContext) => handleClose(rumor, ctx, deps),
  };
}
