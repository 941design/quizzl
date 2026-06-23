import { describe, it, expect } from 'vitest';

// parseStructured is a pure function — import directly without mocking
// Dynamic import used to keep the vi.mock hoisting requirement satisfied
// (no mocks needed here)

describe('parseStructured: call_notice', () => {
  it('T1: parses a started call_notice', async () => {
    const { parseStructured } = await import('@/src/lib/marmot/parseStructured');
    const content = JSON.stringify({
      type: 'call_notice',
      event: 'started',
      callId: 'abc-123',
      initiator: 'deadbeef',
    });
    const result = parseStructured(content);
    expect(result).toEqual({
      type: 'call_notice',
      event: 'started',
      callId: 'abc-123',
      initiator: 'deadbeef',
    });
  });

  it('T2: parses an ended call_notice', async () => {
    const { parseStructured } = await import('@/src/lib/marmot/parseStructured');
    const content = JSON.stringify({
      type: 'call_notice',
      event: 'ended',
      callId: 'xyz-789',
      initiator: 'cafebabe',
    });
    const result = parseStructured(content);
    expect(result?.type).toBe('call_notice');
    expect(result?.event).toBe('ended');
  });

  it('T3: rejects unknown event value', async () => {
    const { parseStructured } = await import('@/src/lib/marmot/parseStructured');
    const content = JSON.stringify({
      type: 'call_notice',
      event: 'paused',
      callId: 'xyz',
      initiator: 'pub',
    });
    // 'paused' is not a valid event value — should return null or non-call_notice
    const result = parseStructured(content);
    expect(result?.type === 'call_notice' && result?.event === 'paused').toBe(false);
  });

  it('T4: rejects missing callId', async () => {
    const { parseStructured } = await import('@/src/lib/marmot/parseStructured');
    const content = JSON.stringify({ type: 'call_notice', event: 'started', initiator: 'pub' });
    const result = parseStructured(content);
    expect(result?.type).not.toBe('call_notice');
  });

  it('T5: rejects non-call_notice type', async () => {
    const { parseStructured } = await import('@/src/lib/marmot/parseStructured');
    const content = JSON.stringify({ type: 'chat', content: 'hello' });
    const result = parseStructured(content);
    expect(result?.type).not.toBe('call_notice');
  });
});

describe('i18n: call notice keys', () => {
  it('T6: callStartedNotice present in en and de', async () => {
    const { getCopy } = await import('@/src/lib/i18n');
    expect(getCopy('en').calls.callStartedNotice('Alice')).toBeTruthy();
    expect(getCopy('de').calls.callStartedNotice('Alice')).toBeTruthy();
  });

  it('T7: callEndedNotice present in en and de', async () => {
    const { getCopy } = await import('@/src/lib/i18n');
    expect(getCopy('en').calls.callEndedNotice).toBeTruthy();
    expect(getCopy('de').calls.callEndedNotice).toBeTruthy();
  });

  it('T8: callStartedNotice en and de differ', async () => {
    const { getCopy } = await import('@/src/lib/i18n');
    const enResult = getCopy('en').calls.callStartedNotice('Alice');
    const deResult = getCopy('de').calls.callStartedNotice('Alice');
    expect(enResult).not.toBe(deResult);
  });

  it('T9: callEndedNotice en and de differ', async () => {
    const { getCopy } = await import('@/src/lib/i18n');
    expect(getCopy('en').calls.callEndedNotice).not.toBe(getCopy('de').calls.callEndedNotice);
  });
});
