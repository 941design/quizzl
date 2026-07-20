/**
 * noGreyedOutPeople.test.ts — source-scan regression guard: contacts, group
 * members, and profiles must never be visually dimmed/greyed out, disabled
 * or not (product invariant, see CLAUDE.md).
 *
 * This repo has no jsdom / @testing-library — mirrors the existing
 * OutboundJoinRequestCard.test.ts precedent of reading `.tsx` source as a
 * string and asserting against it with regexes.
 *
 * Out of scope: OutboundJoinRequestCard and ManageInviteLinksModal's
 * rowStyleFor() dim a group / invite-link row, not a person — the
 * invariant is about contacts/members/profiles specifically.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(TEST_FILE_DIR, '..', '..', '..'); // app/tests/unit/components -> app/

function readSrc(...segments: string[]): string {
  return fs.readFileSync(path.join(APP_ROOT, 'src', ...segments), 'utf8');
}

describe('UserCard.tsx — never dims the shared person card (contacts, members, join requests)', () => {
  const source = readSrc('components', 'UserCard.tsx');

  it('has no dimmed prop', () => {
    expect(source).not.toMatch(/\bdimmed\b/);
  });

  it('does not conditionally set opacity on the card container', () => {
    expect(source).not.toMatch(/opacity:/);
    expect(source).not.toMatch(/opacity=/);
  });
});

describe('MemberList.tsx — group members are never dimmed, pending or not', () => {
  const source = readSrc('components', 'groups', 'MemberList.tsx');

  it('does not pass dimmed to UserCard', () => {
    expect(source).not.toMatch(/dimmed/);
  });
});

describe('InviteMemberModal.tsx — non-selectable contact rows are not greyed out', () => {
  const source = readSrc('components', 'groups', 'InviteMemberModal.tsx');

  it('does not set opacity based on entry.selectable', () => {
    expect(source).not.toMatch(/opacity=\{entry\.selectable/);
  });
});

describe('contacts.tsx — blocked/pending contacts are not dimmed', () => {
  const source = fs.readFileSync(path.join(APP_ROOT, 'pages', 'contacts.tsx'), 'utf8');

  it('does not set opacity based on isBlocked/isPending/restricted', () => {
    expect(source).not.toMatch(/opacity=\{[^}]*(isBlocked|isPending|restricted)/);
  });
});
