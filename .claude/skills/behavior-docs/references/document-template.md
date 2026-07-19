# Document structure

Two artefacts: a single index, and one document per topic. Adapt section names to
the topic — this is a shape to follow, not a form to fill in. Omit a section that a
topic genuinely does not need; never pad.

---

## The index — `docs/behavior/README.md`

- A short intro stating what these documents are (current, intended behaviour; not
  implementation or UI) and that they are maintained with the `/behavior-docs` skill.
- A **Topics** list: one entry per existing document, linking the file, with a
  one-line hook naming what it covers.
- Optionally a **Planned topics** list for intended-but-unwritten coverage.
- Keep it in sync the moment a topic document is added, renamed, or removed.

---

## A topic document — `docs/behavior/<topic-slug>.md`

Recommended skeleton:

```markdown
# <Topic Title>

*One-sentence subtitle: what this covers and its scope, in plain terms.*

---

## 1. What this means here
Frame the topic. Define the core concepts and the design goal in one or two
paragraphs, at product altitude.

## 2..N. Behaviour, by area
One numbered section per coherent area of behaviour. Within each:
- the states involved and what they mean;
- the transitions — who can cause each, what they require (including confirmations),
  and what results;
- the invariants that always hold;
- the *reason* behind any non-obvious rule, sourced.
Use short tables for permission matrices or state/transition summaries where they
read more clearly than prose. A table is behaviour; it is not presentation.

## The central trade-off   (where the topic has one)
State plainly what the design buys and what it costs — gain / pay / never-pay, or a
tradeoff table. Include the narrow worst-case failure and its only mitigation.

## Edge cases and how they resolve
An exhaustive list. Each item: the trigger, then the resolution. Cover concurrency,
offline actors, failure / fail-closed paths, empty / last / sole cases, races,
reloads, cold starts.

## Deliberately out of scope
What is explicitly not part of this behaviour today, each with a one-line reason.

## Sources
The specs, acceptance criteria, ADRs, code areas, and test areas this document was
reconciled from. Durable names, not line numbers. Note any behaviour verified only by
manual validation.
```

### Conventions

- Cross-reference sibling sections by number ("see §7") and check the target actually
  supports the claim.
- Prefer British or American spelling consistently with the rest of `docs/behavior/`.
- Keep line length readable (~90 columns) to match the existing documents.
- No presentation, no history-narration, no overclaimed guarantees — see
  `writing-guidelines.md`.
