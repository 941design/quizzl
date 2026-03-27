import { describe, it, expect } from 'vitest';
import {
  POLL_OPEN_KIND,
  POLL_VOTE_KIND,
  POLL_CLOSE_KIND,
  serialisePollOpen,
  serialisePollVote,
  serialisePollClose,
  parsePollOpen,
  parsePollVote,
  parsePollClose,
} from '@/src/lib/marmot/pollSync';
import type { PollOpenPayload, PollVotePayload, PollClosePayload } from '@/src/lib/marmot/pollSync';

describe('pollSync', () => {
  describe('kind constants', () => {
    it('exports correct kind discriminators', () => {
      expect(POLL_OPEN_KIND).toBe(10);
      expect(POLL_VOTE_KIND).toBe(11);
      expect(POLL_CLOSE_KIND).toBe(12);
    });
  });

  describe('PollOpen serialise/parse', () => {
    const sampleOpen: PollOpenPayload = {
      id: 'poll-uuid-1',
      title: 'Which topic next?',
      description: 'Vote for our next study session',
      options: [
        { id: 'A', label: 'Functions' },
        { id: 'B', label: 'Arrays' },
        { id: 'C', label: 'Loops' },
      ],
      pollType: 'singlechoice',
      creatorPubkey: 'abc123',
    };

    it('round-trips through serialise/parse', () => {
      const json = serialisePollOpen(sampleOpen);
      const result = parsePollOpen(json);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('poll-uuid-1');
      expect(result!.title).toBe('Which topic next?');
      expect(result!.options).toHaveLength(3);
      expect(result!.pollType).toBe('singlechoice');
      expect(result!.creatorPubkey).toBe('abc123');
    });

    it('parses multiplechoice poll type', () => {
      const multi: PollOpenPayload = { ...sampleOpen, pollType: 'multiplechoice' };
      const result = parsePollOpen(serialisePollOpen(multi));
      expect(result!.pollType).toBe('multiplechoice');
    });

    it('preserves optional description', () => {
      const result = parsePollOpen(serialisePollOpen(sampleOpen));
      expect(result!.description).toBe('Vote for our next study session');
    });

    it('handles missing description', () => {
      const noDesc: PollOpenPayload = { ...sampleOpen, description: undefined };
      const result = parsePollOpen(serialisePollOpen(noDesc));
      expect(result).not.toBeNull();
      expect(result!.description).toBeUndefined();
    });

    it('returns null for random text', () => {
      expect(parsePollOpen('hello world')).toBeNull();
    });

    it('returns null for unrelated JSON', () => {
      expect(parsePollOpen(JSON.stringify({ foo: 'bar' }))).toBeNull();
    });

    it('returns null when options has fewer than 2 entries', () => {
      const bad = { ...sampleOpen, options: [{ id: 'A', label: 'Only one' }] };
      expect(parsePollOpen(JSON.stringify(bad))).toBeNull();
    });

    it('returns null for invalid pollType', () => {
      const bad = { ...sampleOpen, pollType: 'yesno' };
      expect(parsePollOpen(JSON.stringify(bad))).toBeNull();
    });

    it('returns null when option lacks label', () => {
      const bad = { ...sampleOpen, options: [{ id: 'A' }, { id: 'B', label: 'ok' }] };
      expect(parsePollOpen(JSON.stringify(bad))).toBeNull();
    });
  });

  describe('PollVote serialise/parse', () => {
    const sampleVote: PollVotePayload = {
      pollId: 'poll-uuid-1',
      responses: ['A'],
    };

    it('round-trips through serialise/parse', () => {
      const json = serialisePollVote(sampleVote);
      const result = parsePollVote(json);
      expect(result).not.toBeNull();
      expect(result!.pollId).toBe('poll-uuid-1');
      expect(result!.responses).toEqual(['A']);
    });

    it('handles multiple responses', () => {
      const multi: PollVotePayload = { pollId: 'poll-uuid-1', responses: ['A', 'C'] };
      const result = parsePollVote(serialisePollVote(multi));
      expect(result!.responses).toEqual(['A', 'C']);
    });

    it('returns null for empty responses array', () => {
      const bad = { pollId: 'poll-uuid-1', responses: [] };
      expect(parsePollVote(JSON.stringify(bad))).toBeNull();
    });

    it('returns null for missing pollId', () => {
      expect(parsePollVote(JSON.stringify({ responses: ['A'] }))).toBeNull();
    });

    it('returns null for random text', () => {
      expect(parsePollVote('not json')).toBeNull();
    });

    it('returns null for non-string responses', () => {
      const bad = { pollId: 'x', responses: [1, 2] };
      expect(parsePollVote(JSON.stringify(bad))).toBeNull();
    });
  });

  describe('PollClose serialise/parse', () => {
    const sampleClose: PollClosePayload = {
      pollId: 'poll-uuid-1',
      results: [
        { optionId: 'A', label: 'Functions', count: 5 },
        { optionId: 'B', label: 'Arrays', count: 2 },
        { optionId: 'C', label: 'Loops', count: 1 },
      ],
      totalVoters: 8,
    };

    it('round-trips through serialise/parse', () => {
      const json = serialisePollClose(sampleClose);
      const result = parsePollClose(json);
      expect(result).not.toBeNull();
      expect(result!.pollId).toBe('poll-uuid-1');
      expect(result!.results).toHaveLength(3);
      expect(result!.totalVoters).toBe(8);
    });

    it('validates result entry shape', () => {
      const bad = {
        pollId: 'x',
        results: [{ optionId: 'A', count: 5 }], // missing label
        totalVoters: 5,
      };
      expect(parsePollClose(JSON.stringify(bad))).toBeNull();
    });

    it('returns null for non-number count', () => {
      const bad = {
        pollId: 'x',
        results: [{ optionId: 'A', label: 'A', count: '5' }],
        totalVoters: 5,
      };
      expect(parsePollClose(JSON.stringify(bad))).toBeNull();
    });

    it('returns null for missing totalVoters', () => {
      const bad = {
        pollId: 'x',
        results: [{ optionId: 'A', label: 'A', count: 5 }],
      };
      expect(parsePollClose(JSON.stringify(bad))).toBeNull();
    });

    it('returns null for random text', () => {
      expect(parsePollClose('garbage')).toBeNull();
    });

    it('handles zero-vote results', () => {
      const zeroVote: PollClosePayload = {
        pollId: 'p',
        results: [
          { optionId: 'A', label: 'X', count: 0 },
          { optionId: 'B', label: 'Y', count: 0 },
        ],
        totalVoters: 0,
      };
      const result = parsePollClose(serialisePollClose(zeroVote));
      expect(result!.totalVoters).toBe(0);
      expect(result!.results.every((r) => r.count === 0)).toBe(true);
    });
  });
});
