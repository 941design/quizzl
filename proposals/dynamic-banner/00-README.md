# Dynamic themes — shared working folder

This folder is the shared workspace for **per-load dynamic theme visuals** — unique,
generated-on-every-reload imagery that stays within the selected theme. It began as a
"dynamic banner" and has broadened: few.chat extends its theme system to support dynamic
*elements* generically, and ink packages its generator as a generic, consumer-agnostic
visual-element library. Co-developed by:

- **ink** — rotheric / the `ink` watercolour-generator maintainers (generator owner)
- **few.chat** — the few.chat theme-system maintainers (integrator, sole committer)

Read this file first. It is the working agreement. The numbered documents are the
canonical thread.

## Documents

| File | Owner | What it is |
|---|---|---|
| `00-README.md` | few.chat | This working agreement. |
| `01-proposal.md` | ink | The original proposal. Historical record — kept as-is. |
| `02-integration-contract.md` | few.chat | The accepted architecture + the contract to build against. **Addendum A reconciles it against the ink source (read 2026-07-05).** |
| `03-asks-for-ink.md` | few.chat | Low-level, source-cited asks. Partly superseded by `05` (see its header). |
| `04-few-chat-change-plan.md` | few.chat | **Our engineering plan** — extending the theme system to support generic dynamic elements + the new theme. |
| `05-ink-artifact-publication-proposal.md` | few.chat | **Proposal to ink** — publish the generator as a generic, private, versioned library (git repo). The current ask to ink. |

Later rounds add new numbered files (`03-…`, `04-…`). **Numbered = canonical and
committed.** Anything unnumbered is a scratch draft and may be rewritten or removed.

## Roles

- **ink** authors and freely edits the documents it *owns* (currently `01`). It
  answers open questions, raises new ones, and proposes changes to few.chat-owned
  docs — but does **not** edit few.chat-owned docs directly, and does **not** commit.
- **few.chat** owns the integration contract, reviews every change, folds in ink's
  input, and is the **sole committer**. Product-behavior decisions (anything that
  changes what a user sees or a guarantee we make) are escalated to the few.chat
  product owner, not settled inside a doc.

## How we exchange changes (ink has no commit access)

This folder is shared as files, not as a repo you push to. So changes move by
**annotation and reply**, not by pull request.

1. **Margin notes — the primary channel.** Leave an inline blockquote tagged with
   direction and author, right where it applies:

   ```
   > [ink→few]: can the safe zone be 40% instead of 45%? 420px stretches thin on mobile.
   > [few→ink]: agreed, will pass 0.40. Folding into §5.
   ```

   Use `[ink→few]` and `[few→ink]` verbatim so notes are greppable and authorship is
   never ambiguous. Notes are **transient**: whoever resolves a note deletes it in the
   same edit that folds its content into prose. An open note = an unresolved item.

2. **A substantive reply = a new numbered doc.** When a round of answers or a
   counter-proposal is more than a few margin notes, write it as `NN-<topic>.md`
   (e.g. `03-ink-answers.md`). few.chat commits it, then folds durable decisions back
   into `02` and supersedes the round doc if it's no longer needed.

3. **Open questions** live at the bottom of `02-integration-contract.md` (§8). Answer
   them there with a `[ink→few]` note or in a reply doc — do not scatter answers.

## Editing rules

- **Never delete or overwrite the other party's text to express disagreement.**
  Annotate with a `[…→…]` note and let the owner resolve it. (This mirrors few.chat's
  standing file-safety rule: preserve and flag, never discard and proceed.)
- **ink-owned docs**: few.chat commits ink's edits verbatim and does not rewrite
  ink's intent; if few.chat disagrees, it leaves a `[few→ink]` note.
- **few.chat-owned docs**: ink proposes via notes/reply docs; few.chat makes the edit.
- **One idea per note.** Don't bundle unrelated asks into one blockquote.

## Document status header

Every numbered doc except this README carries a status line under its title. Keep it
current:

```
**Status:** Draft | Under review | Agreed | Superseded by NN
```

- **Draft** — being written, not yet ready for the other party.
- **Under review** — handed over, awaiting the other party's notes.
- **Agreed** — both parties accept it; changes now require a new note/round.
- **Superseded** — replaced; points to the doc that replaces it. Kept, never deleted.

## Commit protocol (few.chat)

- **One commit per exchange round.** The message names who authored the changes in
  that round and lists the docs touched.
- **Attribution is preserved.** ink's authored content is credited in the commit body
  (ink is not a git author on this repo, so the commit body is the record).
- **No silent drops.** few.chat never commits a change that discards ink's text
  without an accompanying `[few→ink]` note explaining why.
- **The tree is always shippable-as-docs.** Commit only when the numbered docs are
  internally consistent (no half-resolved contradiction between `01` and `02`).

## Decision authority

- **Architecture / integration mechanics** (signatures, seams, encodings, gates):
  few.chat decides, ink advises.
- **Generator internals** (how the watercolour is produced, param semantics):
  ink decides, few.chat advises.
- **Product behavior and guarantees** (uniqueness requirement, legibility contract,
  supply-chain posture, bundle ceiling): the few.chat product owner decides. These
  are already settled in `02` §1 — reopening one requires a note escalated to the
  product owner, not an in-doc edit.
