import { describe, it, expect } from 'vitest';
import {
  LEAVE_INTENT_KIND,
  serialiseLeaveIntent,
  parseLeaveIntent,
} from '@/src/lib/marmot/leaveSync';
import type { LeaveIntentPayload } from '@/src/lib/marmot/leaveSync';

describe('leaveSync', () => {
  describe('kind constant', () => {
    it('exports LEAVE_INTENT_KIND = 13', () => {
      expect(LEAVE_INTENT_KIND).toBe(13);
    });
  });

  describe('serialiseLeaveIntent', () => {
    it('serialises a payload to JSON with only the pubkey field', () => {
      const payload: LeaveIntentPayload = { pubkey: 'abcd' };
      const json = serialiseLeaveIntent(payload);
      expect(JSON.parse(json)).toEqual({ pubkey: 'abcd' });
    });

    it('emits no extra fields beyond pubkey', () => {
      const json = serialiseLeaveIntent({ pubkey: 'xyz' });
      const parsed = JSON.parse(json);
      expect(Object.keys(parsed)).toEqual(['pubkey']);
    });
  });

  describe('parseLeaveIntent', () => {
    it('round-trip: parseLeaveIntent(serialiseLeaveIntent({pubkey:"abcd"})) returns {pubkey:"abcd"}', () => {
      const result = parseLeaveIntent(serialiseLeaveIntent({ pubkey: 'abcd' }));
      expect(result).toEqual({ pubkey: 'abcd' });
    });

    it('returns null for invalid JSON input', () => {
      expect(parseLeaveIntent('not-json')).toBeNull();
    });

    it('returns null when pubkey field is absent', () => {
      expect(parseLeaveIntent('{"foo":1}')).toBeNull();
    });

    it('returns null when pubkey is not a string', () => {
      expect(parseLeaveIntent('{"pubkey":42}')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parseLeaveIntent('')).toBeNull();
    });

    it('returns null for a JSON null value', () => {
      expect(parseLeaveIntent('null')).toBeNull();
    });
  });
});
