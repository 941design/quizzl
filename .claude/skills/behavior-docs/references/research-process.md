# Research and review process

The goal is a document whose every claim is reconciled across specifications,
acceptance criteria, shipped code, and tests, with the reasoning behind decisions
sourced from ADRs and history. Fan the reading out; keep the judgement central.

---

## Step 1 — Scope the topic

Before spawning agents, do a quick orienting sweep so the briefs are well targeted:

- `ls specs/` and grep for the topic's keywords across `specs/` to find the owning
  epic(s) and any feature-request specs.
- Find the anchor code: the pure implementations under `app/src/lib/`, the relevant
  components under `app/src/components/`, the page under `app/pages/`, and the copy in
  `app/src/lib/i18n.ts`.
- Find the tests: the `*.spec.ts` under `app/tests/e2e/` and unit tests.

## Step 2 — Fan out three research subagents (Haiku)

Spawn concurrently. Each brief ends with: *be exhaustive, cite the source file for
every claim, list every edge case, do not summarise edge cases away.*

- **Specs & acceptance criteria reader** — collect every rule, decision, acceptance
  criterion, invariant, and edge case for the topic from `specs/` only. Capture
  acceptance-criteria IDs and decision rationale verbatim.
- **Code reader** — collect actual behaviour from `app/src/` and `app/pages/` only:
  guards, state, transitions, who-can-do-what, error/fail-closed paths, and the
  user-facing copy keys (for meaning, not for quoting). Cite `file:line`.
- **Tests reader** — collect the observable, asserted behaviour from `app/tests/`:
  every scenario and what it proves, especially edge cases and concurrency.

## Step 3 — Mine the reasoning (in parallel)

Design rationale is rarely in the code. In parallel with the agents:

- Read the relevant ADRs under `docs/adr/` — these carry the *why*, the alternatives
  considered, and the accepted risks.
- `git log --oneline -i --grep="<topic keywords>"` and read the messages of the
  commits that introduced the behaviour; the feature-request commit and the epic spec
  often state the decision explicitly.

## Step 4 — Cross-check, do not trust blindly

Read the two or three anchor files yourself and confirm the agents' key claims
against them. Subagents are for breadth; you own correctness. Where the specs and the
code disagree, the **shipped code and tests are the truth** — note the discrepancy in
the document rather than repeating a stale spec.

**Watch for superseded specs.** An older feature spec can be overtaken by a later
epic — the behaviour it describes may no longer be what ships. Before trusting a
spec, check whether a newer epic under `specs/` covers the same surface (and its
`epic-state.json` status), and confirm the behaviour against the current code. (For
example, an early invite-link spec's "mute/unmute" mechanism was later replaced by
automatic expiry and terminal deletion.) When a research agent cites only the older
spec, verify against the code before writing.

**File a backlog finding for every real inconsistency you find** — a spec contradicted
by code, a superseded spec, contradictory acceptance criteria, or material behaviour
no spec/ADR records. Do this as you find them, through the `base:backlog` skill; the
exact invocation and what does/does not qualify are in `SKILL.md` under *Discovered
inconsistencies → backlog findings*. Deduplicate against `base:backlog list` first.
The document records the resolved truth; the finding tracks fixing the source.

## Step 5 — Synthesise

Write the document per `document-template.md` and `writing-guidelines.md`. Strip
presentation to state, transitions, and confirmations. Give the sourced *why* behind
non-obvious rules. Cover edge cases exhaustively. End with a Sources section.

## Step 6 — Review with a Fable agent

Spawn a `fable` subagent to review the finished document. Its brief:

- Verify every behavioural claim against the code and specs (name the authoritative
  files); flag anything overclaimed.
- Find contradictions and broken cross-references.
- Enforce the writing standard: flag any presentation (buttons, badges, dialogs,
  layout, on-screen strings), any narration of superseded history that is not a
  decision's rationale, and any guarantee stated more strongly than its enforcement
  supports.
- Identify edge cases or material behaviour present in the sources but missing.
- Report problems only, most-serious first, quoting exact text and section.

Apply every finding you can confirm against the source — verify each before changing.
Then re-read `writing-guidelines.md` and do the self-check.

## Notes

- Prefer Haiku for the breadth-first research agents (cost) and Fable for the review.
- When documenting several topics at once, pipeline them — research the next while
  reviewing the previous.
- Keep citations durable in the final document (spec/ADR/code-area names), even though
  the research uses `file:line` internally.
