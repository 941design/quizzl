import { describe, it, expect } from 'vitest';
import { getCopy } from '@/src/lib/i18n';

describe('leaveIntent i18n keys', () => {
  it('English copy has the leftGroup key with exact value', () => {
    const en = getCopy('en');
    expect(typeof en.groups.leftGroup).toBe('function');
    expect(en.groups.leftGroup('Alice')).toBe('Alice left the group');
  });

  it('German copy has the leftGroup key with exact value', () => {
    const de = getCopy('de');
    expect(typeof de.groups.leftGroup).toBe('function');
    expect(de.groups.leftGroup('Alice')).toBe('Alice hat die Gruppe verlassen');
  });
});
