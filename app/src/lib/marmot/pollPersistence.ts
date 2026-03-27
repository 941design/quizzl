/**
 * Poll persistence layer — idb-keyval implementation.
 *
 * Polls are stored per-group under the key `quizzl:polls:{groupId}`.
 * Votes are stored per-poll under the key `quizzl:poll-votes:{pollId}`.
 */

import { get, set, del } from 'idb-keyval';

// ---- Types ----

export interface PollOptionDef {
  /** Short alphanumeric identifier (e.g. "A", "B", "C") */
  id: string;
  /** Human-readable label */
  label: string;
}

export interface PollResult {
  optionId: string;
  label: string;
  count: number;
}

export interface Poll {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  options: PollOptionDef[];
  pollType: 'singlechoice' | 'multiplechoice';
  creatorPubkey: string;
  createdAt: number;
  closed: boolean;
  results?: PollResult[];
  totalVoters?: number;
}

export interface PollVote {
  /** Compound key: `${pollId}:${voterPubkey}` */
  id: string;
  pollId: string;
  voterPubkey: string;
  responses: string[];
  votedAt: number;
}

// ---- Storage keys ----

function pollsKey(groupId: string): string {
  return `quizzl:polls:${groupId}`;
}

function votesKey(pollId: string): string {
  return `quizzl:poll-votes:${pollId}`;
}

// ---- Polls CRUD ----

/** Load all polls for a group, sorted newest-first by createdAt. */
export async function loadPolls(groupId: string): Promise<Poll[]> {
  const stored = await get<Poll[]>(pollsKey(groupId));
  return (stored ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

// Per-key write serialization to avoid race conditions (same pattern as chatPersistence.ts)
const writeQueues = new Map<string, Promise<void>>();

function enqueue(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const next = prev.then(fn);
  const settled = next.catch(() => {});
  writeQueues.set(key, settled);
  settled.then(() => {
    if (writeQueues.get(key) === settled) writeQueues.delete(key);
  });
  return next;
}

/** Save or update a poll (upsert by id). */
export function savePoll(poll: Poll): Promise<void> {
  const key = pollsKey(poll.groupId);
  return enqueue(key, async () => {
    const existing = (await get<Poll[]>(key)) ?? [];
    const idx = existing.findIndex((p) => p.id === poll.id);
    if (idx >= 0) {
      existing[idx] = poll;
    } else {
      existing.push(poll);
    }
    await set(key, existing);
  });
}

/** Get a single poll by id from a group. */
export async function getPoll(groupId: string, pollId: string): Promise<Poll | null> {
  const polls = await loadPolls(groupId);
  return polls.find((p) => p.id === pollId) ?? null;
}

// ---- Votes CRUD ----

/** Load all votes for a poll. */
export async function loadVotes(pollId: string): Promise<PollVote[]> {
  const stored = await get<PollVote[]>(votesKey(pollId));
  return stored ?? [];
}

/** Save or replace a vote (keyed by pollId:voterPubkey — latest wins). */
export function saveVote(vote: PollVote): Promise<void> {
  const key = votesKey(vote.pollId);
  return enqueue(key, async () => {
    const existing = (await get<PollVote[]>(key)) ?? [];
    const idx = existing.findIndex((v) => v.id === vote.id);
    if (idx >= 0) {
      existing[idx] = vote;
    } else {
      existing.push(vote);
    }
    await set(key, existing);
  });
}

/** Clear all poll data for a group (polls + all associated votes). */
export async function clearPollData(groupId: string): Promise<void> {
  const polls = await loadPolls(groupId);
  // Delete votes for each poll
  for (const poll of polls) {
    await del(votesKey(poll.id));
  }
  // Delete the polls list
  await del(pollsKey(groupId));
}
