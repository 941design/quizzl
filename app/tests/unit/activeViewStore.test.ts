/**
 * Unit tests for activeViewStore — the notification-domain-invariants registry.
 *
 * The registry answers a single question for every live bell increment site:
 * "is the entity this event targets the one the user currently has open in a
 * detail view?" (per-entity granularity — see spec
 * specs/epic-notification-domain-invariants). The two invariants it serves:
 *   INV-1 (off-domain rings): event target ≠ active view → bell rings.
 *   INV-2 (on-domain updates): event target = active view → bell suppressed.
 *
 * AC-REG-1: setActiveView / clearActiveView / isActiveView(domain, id).
 * AC-REG-2: with no active view, isActiveView is false for every input.
 * AC-REG-3: after clear, isActiveView returns false.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const { setActiveView, clearActiveView, isActiveView, getActiveGroupId } = await import(
  '@/src/lib/activeViewStore'
);

describe('activeViewStore', () => {
  beforeEach(() => {
    clearActiveView();
  });

  // ── AC-REG-2: default (no active view) ──────────────────────────────────────
  it('AC-REG-2: with no active view, isActiveView is false for every input', () => {
    expect(isActiveView('group', 'g1')).toBe(false);
    expect(isActiveView('dm', 'a'.repeat(64))).toBe(false);
    expect(getActiveGroupId()).toBeNull();
  });

  // ── AC-REG-1: group active view ─────────────────────────────────────────────
  it('AC-REG-1: a group active view matches only its own id and domain', () => {
    setActiveView({ domain: 'group', id: 'g1' });
    expect(isActiveView('group', 'g1')).toBe(true);
    expect(isActiveView('group', 'g2')).toBe(false);
    // domain must match too — a dm event for the same string is not on-domain
    expect(isActiveView('dm', 'g1')).toBe(false);
    expect(getActiveGroupId()).toBe('g1');
  });

  // ── AC-REG-1: dm active view + peer-id lowercasing ──────────────────────────
  it('AC-REG-1: a dm active view compares peer ids case-insensitively', () => {
    const PEER = 'AbCd'.repeat(16); // mixed-case 64-char hex
    setActiveView({ domain: 'dm', id: PEER });
    expect(isActiveView('dm', PEER.toLowerCase())).toBe(true);
    expect(isActiveView('dm', PEER.toUpperCase())).toBe(true);
    expect(isActiveView('dm', 'b'.repeat(64))).toBe(false);
    // a dm active view exposes no active group
    expect(getActiveGroupId()).toBeNull();
    expect(isActiveView('group', PEER)).toBe(false);
  });

  // ── AC-REG-3: clear resets everything ───────────────────────────────────────
  it('AC-REG-3: clearActiveView resets isActiveView and getActiveGroupId', () => {
    setActiveView({ domain: 'group', id: 'g1' });
    clearActiveView();
    expect(isActiveView('group', 'g1')).toBe(false);
    expect(getActiveGroupId()).toBeNull();
  });

  it('AC-REG-1: setting a new active view replaces the previous one', () => {
    setActiveView({ domain: 'group', id: 'g1' });
    setActiveView({ domain: 'dm', id: 'c'.repeat(64) });
    expect(isActiveView('group', 'g1')).toBe(false);
    expect(isActiveView('dm', 'c'.repeat(64))).toBe(true);
    expect(getActiveGroupId()).toBeNull();
  });
});
