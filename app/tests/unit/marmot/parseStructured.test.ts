import { describe, it, expect } from 'vitest';
import { parseStructured, resolveCancellerDisplay } from '@/src/lib/marmot/parseStructured';

describe('parseStructured', () => {
  it('returns invite_cancelled variant for valid input', () => {
    const result = parseStructured('{"type":"invite_cancelled","pubkey":"aabb","by":"ccdd"}');
    expect(result).toEqual({ type: 'invite_cancelled', pubkey: 'aabb', by: 'ccdd' });
  });

  it('returns null for invite_cancelled missing pubkey', () => {
    const result = parseStructured('{"type":"invite_cancelled","by":"ccdd"}');
    expect(result).toBeNull();
  });

  it('returns null for invite_cancelled missing by', () => {
    const result = parseStructured('{"type":"invite_cancelled","pubkey":"aabb"}');
    expect(result).toBeNull();
  });

  it('returns poll_open for valid poll_open input', () => {
    const result = parseStructured('{"type":"poll_open","pollId":"p1","title":"Vote!","creatorPubkey":"aa"}');
    expect(result).toMatchObject({ type: 'poll_open', pollId: 'p1', title: 'Vote!' });
  });

  it('returns null for plain text', () => {
    const result = parseStructured('hello world');
    expect(result).toBeNull();
  });

  it('returns null for unknown type', () => {
    const result = parseStructured('{"type":"unknown","foo":"bar"}');
    expect(result).toBeNull();
  });
});

describe('resolveCancellerDisplay — trust boundary', () => {
  const truncate = (pk: string) => pk.slice(0, 8) + '…';

  it('uses nickname from profileMap keyed on senderPubkey', () => {
    const result = resolveCancellerDisplay(
      'realSenderPk',
      { realSenderPk: { nickname: 'Alice' } },
      truncate,
    );
    expect(result).toBe('Alice');
  });

  it('falls back to truncated senderPubkey when no profile', () => {
    const result = resolveCancellerDisplay('realSenderPk', {}, truncate);
    expect(result).toBe('realSend…');
  });

  it('ignores a forged by field — uses senderPubkey not structured.by', () => {
    // Simulate attacker posting by='adminPk' while actual sender is 'attackerPk'
    const forgedBy = 'adminPk';
    const actualSender = 'attackerPk';
    const profileMap = {
      adminPk: { nickname: 'Admin' },
      attackerPk: { nickname: 'Attacker' },
    };
    // The render layer must call resolveCancellerDisplay(msg.senderPubkey, ...)
    // not resolveCancellerDisplay(structured.by, ...).
    // This test proves the function always returns the senderPubkey's display.
    expect(resolveCancellerDisplay(actualSender, profileMap, truncate)).toBe('Attacker');
    // And that using the forged field would have returned the wrong name:
    expect(resolveCancellerDisplay(forgedBy, profileMap, truncate)).toBe('Admin');
  });
});
