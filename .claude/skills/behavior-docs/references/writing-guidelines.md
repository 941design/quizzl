# Writing guidelines for behaviour specifications

These are hard preferences, generalised from repeated review feedback. Treat each as
a requirement, not a suggestion. When a draft violates one, fix the draft.

The reader is a **product owner**: someone deciding what the product should do, who
needs enough to make informed decisions and nothing that only matters to whoever
builds it.

---

## 1. Voice and altitude

- **Lead with behaviour, not mechanism.** Say what happens and what changes for the
  people using the product first. Reach for implementation detail only when it
  changes what a decision-maker would conclude.
- **Open on the subject — no meta-preamble.** Do not preface a document with
  commentary about what the document is or is not (e.g. "this describes behaviour, not
  implementation", "this is called out plainly rather than smoothed over"). The index
  frames what these documents are; each document starts on its topic, under a title
  and a one-line subtitle, and nothing else.
- **Be direct.** Use assertive statements. Avoid "it seems", "it might be worth",
  "one could argue". State what is true.
- **Reveal trade-offs.** Where a design buys one thing at the cost of another, say so
  plainly — ideally in a structured form (what you gain / what you pay / what you
  never pay, or a small table). A trade-off hidden is a decision the reader cannot
  make.
- **Name the decision behind a rule.** Whenever a rule exists because of a deliberate
  choice, give the choice, not just the rule.

## 2. What to describe

- **Current, intended behaviour only.** Describe how the product behaves now. Do
  **not** narrate history: no "previously", no "was amended", no "used to", no
  "reserved for a future increment", no changelog. The single exception: when the
  history *is* the reason for a current decision, give the reason — as reasoning, not
  chronology.
- **State and state transitions, fully.** Enumerate the states a thing can be in,
  what moves it between them, who can cause each move, and the invariants that always
  hold. This is the backbone of a behaviour spec.
- **Confirmations and their meaning.** When an action requires an explicit
  confirmation — especially an irreversible or destructive one — that requirement is
  behaviour: state it, and state what the confirmation asserts (e.g. "cannot be
  undone"). The *fact and meaning* of the confirmation are in scope.
- **Edge cases, exhaustively.** Concurrency, offline actors, failure and fail-closed
  paths, empty / last / sole cases, races, reloads, cold starts. For each: the
  trigger and how it resolves. A dedicated edge-cases section is expected.

## 3. What to omit — presentation

Describe *what the system does and communicates*, never *how it is shown*.

- **Omit:** buttons, icons, pencils, badges, dialogs, modals, toasts, menus, layout,
  colours, which control is shown / hidden / enabled / disabled, testids, and verbatim
  on-screen copy.
- **Keep:** the state or transition the control represents, and the meaning it
  conveys. "Leaving requires an explicit confirmation that the group cannot be
  recovered" — not "a modal with an Abandon button appears".
- If a *communicated meaning* is itself a constraint (e.g. wording must not imply a
  message was delivered), state the constraint on the meaning — not the string that
  satisfies it.

## 4. Depth, in service of understanding

Add technical depth where it changes what the reader concludes, and only there.

- Explain a mechanism when omitting it would let the reader believe something false —
  e.g. that a shared invite link can be recalled (it cannot; the system can only
  ignore future requests bearing it), or that a member who "left" can no longer
  receive messages (not yet, at the protocol level).
- Do not add mechanism for its own sake. Depth serves a decision; it is not a tour of
  the implementation.

## 5. The *why* behind decisions

- For every non-obvious rule, explain **why**, sourced from ADRs, specs, or commit
  history. The reasoning is often more valuable than the rule.
- Prefer a **causal chain**: what would go wrong under the alternative, and why the
  chosen design avoids it. "Admin is add-only because the protocol offers no safe
  removal: a demote would let any client strip the creator, and could be silently
  lost to a concurrent change" beats "admin is add-only (by decision)".
- Mine `docs/adr/` and `git log` for this. A rule whose reason you cannot find is a
  rule to flag, not to invent a reason for.

## 6. Honest guarantees

- Distinguish **app-enforced** from **protocol- or cryptographically-enforced**.
  Never let an app-level convention read as a hard guarantee.
- Name **where** a restriction is actually enforced (interface, protocol, both), so
  the reader knows what the guarantee is worth.
- Never overclaim. If something holds only "as long as everyone uses a conforming
  client", say exactly that.

## 7. Accuracy and traceability

- **Reconcile every claim** against specifications, acceptance criteria, code, and
  tests. Where they disagree, **shipped code and tests are the truth** — and note the
  discrepancy rather than papering over it.
- End each document with a **Sources** section: the specs, ADRs, code areas, and test
  areas the document was reconciled from. Prefer durable names over line numbers.
- **Flag** behaviour that is verified only by manual validation, not automated tests.
- State known gaps and unresolved corners honestly; do not smooth them away.

## 8. A quick self-check before finishing

- Does the document open with meta-commentary about itself instead of its topic? →
  cut it.
- Could a reader point to any sentence and ask "which button?" → you left in
  presentation.
- Does any sentence narrate history that isn't a reason for a current decision? →
  cut it.
- Is any guarantee stated more strongly than its enforcement supports? → qualify it.
- Is every non-obvious rule accompanied by its why? → add it or flag the gap.
- Is every edge case's *resolution* stated, not just its existence? → complete it.
- Does a Sources section let someone re-verify every claim? → add it.
