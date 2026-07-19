---
name: behavior-docs
description: Create or update the product-level, human-readable behaviour specification for one or more topics (e.g. "group administration", "contact invitation"), or exhaustively for all topics. Researches specs, acceptance criteria, code, tests, and ADRs via subagents; writes one document per topic under docs/behavior/ with a shared index; then runs a Fable review pass. Use whenever asked to document, specify, or write up how a feature or topic behaves.
argument-hint: "[topic ...] | all"
---

# behavior-docs — write and maintain behaviour specifications

This skill produces **product-level, human-readable behaviour specifications**: one
self-contained document per topic under `docs/behavior/`, plus a shared index. It is
the standard way to create or update these documents in this repo. The reader is a
product owner deciding on behaviour — not an engineer reading how it is built.

## Read these before writing — they are binding

Load and apply in full, and re-read them before writing each document:

- [references/writing-guidelines.md](references/writing-guidelines.md) — voice, what
  to describe versus omit, honest guarantees, edge-case and sourcing rules. These
  encode hard preferences; treat every rule as a requirement.
- [references/document-template.md](references/document-template.md) — the required
  per-topic document structure and the index format.
- [references/research-process.md](references/research-process.md) — ready subagent
  briefs and the reconciliation method for the research and review steps.

## Output structure (always)

- `docs/behavior/README.md` — the index / table of contents. One entry per topic,
  linking its file with a one-line hook. **Keep it in sync** whenever a topic
  document is created, renamed, or removed.
- `docs/behavior/<topic-slug>.md` — one document per topic (kebab-case slug).

## Scope — from `$ARGUMENTS`

- One or more topic names → create or update exactly those topics.
- `all` → build or refresh the whole set. Derive the topic list from the existing
  index, the epics under `specs/`, and the ADRs under `docs/adr/`; present the
  proposed list and proceed once it is agreed.
- Empty → ask which topic(s), or offer `all`.

Topics are independent; you may process several in parallel.

## Process, per topic (research → synthesise → review)

1. **Research.** Spawn parallel research subagents (use Haiku for efficiency): one
   over specs + acceptance criteria, one over code, one over tests — each briefed to
   collect *exhaustive* behaviour and edge cases and to cite sources. In parallel,
   mine `docs/adr/` and `git log` for the **reasoning** behind non-obvious decisions.
   Read the two or three anchor files yourself to cross-check the agents rather than
   trusting their reports blindly. Briefs are in
   [references/research-process.md](references/research-process.md).

2. **Synthesise** the document per the guidelines and template. Reconcile
   specs / acceptance criteria / code / tests; where they disagree, **shipped code
   and tests win** — note the discrepancy. Describe current behaviour only; give the
   *reason* behind key decisions, sourced from ADRs / specs / commits. When a
   disagreement is a real defect in the sources (not merely doc wording), **also file
   a backlog finding** — see *Discovered inconsistencies* below.

3. **Review.** Spawn a `fable` subagent to review the finished document for
   contradictions, factual inaccuracies (it must verify against code and specs),
   gaps, and voice/altitude drift — including any presentational detail that crept
   back in. Apply every finding you can confirm against the source; verify each
   before changing.

4. **Finalise.** Update the index. Report to the user: what was created or updated,
   the key decisions, and any gaps or unresolved corners you surfaced.

## Discovered inconsistencies → backlog findings

Reconciling the sources routinely surfaces defects that are **not** documentation
problems: a spec that ships differently in code, a spec superseded by a later epic,
contradictory acceptance criteria, or material behaviour that no spec or ADR records.
Fixing the prose hides these; they belong in the backlog.

For each such inconsistency file a finding through the **`base:backlog`** skill —
never by editing `BACKLOG.json` or calling its scripts directly (that is a contract
violation):

```
Skill("base:backlog", args: "add-finding \
  --text \"<one-line headline>\" \
  --anchor <path[:line] | -> \
  --motivation \"<why it matters — the risk or confusion it causes>\" \
  --behavior \"<what currently happens, and how the sources disagree>\" \
  [--approach \"<how to resolve — e.g. retire or update the stale spec>\"] \
  [--kind spec-gap]")
```

- `--anchor` points at the offending file (the stale spec, or the code area); use `-`
  for a cross-cutting issue. `--text`, `--anchor`, `--motivation`, and `--behavior`
  are required.
- Use `--kind spec-gap` when a spec is missing, stale, or superseded.
- **Deduplicate first:** run `Skill("base:backlog", args: "list")` (or `query`) and
  skip anything already recorded.
- Still record the resolved truth in the document — the finding tracks fixing the
  *source*; the document states what actually ships.

**File a finding for:** a spec contradicted by shipped code; a spec superseded by a
later epic; contradictory or ambiguous acceptance criteria; behaviour with no spec or
ADR (including unrecorded accepted risks — e.g. a race the code allows that nothing
documents). **Do not file for:** documentation wording, or intended decisions already
recorded in a spec/ADR.

## Guardrails

- These are behaviour specifications, not tutorials or UI documentation. Never
  describe buttons, badges, dialogs, layout, or on-screen strings — describe state,
  transitions, required confirmations, meaning, and invariants.
- Prefer durable citations (spec / ADR / code-area names) over line numbers.
- Do not narrate superseded history unless it is the stated reason for a current
  design decision.
- File `base:backlog` findings for genuine code/spec inconsistencies you discover
  (see above) — never mutate `BACKLOG.json` directly.
