---
epic: epic-emoji-feature
project: quizzl
project_path: /Users/mrother/Projects/941design/quizzl
git_remote: <not-recorded-by-lead>
commit_at_start: <reopen baseline — pre-dab5204>
commit_at_end: d9ceec9
started: 2026-05-08
completed: 2026-05-08
stories_total: 1
stories_done: 1
stories_escalated: 0
---

# Retrospective: epic-emoji-feature (reopened remediation)

> **Off-spec invocation note.** This retro was produced outside the `/feature` Step 6
> trigger contract. The workflow was an ad-hoc reopen → fix → verify → e2e cycle
> driven directly by the lead, not a `/feature` run. Inputs were assembled by the
> lead from in-session tool output rather than from `result.json` / `retro_bundle` /
> `verification.json` artifacts. Verbatim quotation of the per-agent RETROSPECTIVE
> blocks is preserved; provenance is given at the granularity the lead recorded.

## Per-story findings

### S1 — Remove-tombstone bug fix at `ChatStoreContext.tsx:396-443`
**Provenance**: quizzl @ commits [dab5204, d9ceec9]
**Source agents**: base:pbt-dev, base:verification-examiner
**Scope**: project_specific
**What made this harder**:
> The fix itself was mechanically clear from the task description, but the test harness for ChatStoreContext is a React context with MarmotGroup/signer dependencies — impossible to unit-test directly. Exercising sendReaction's body required extracting the logic manually into simulation helpers, which added a layer of indirection. A pure helper function for the send/rollback body (as the task spec mentions as an option) would have made this trivially testable.

**What surprised**:
> applyOptimisticRemoval was already fully correct and exported — nothing needed in api.ts. The entire bug was confined to one call site.

## Verification phase findings

- **S1** (verification-examiner, scope: meta):
> The original story-08 verifier closed AC-56 as YES while groups-reactions.spec.ts:328 was deterministically failing — the fix was not yet landed. This verification explicitly traced every e2e test assertion to the underlying production code path to prevent repeating that error.

## Lead's epic-meta findings

### Verifier rubber-stamping is a recurring failure mode, not a one-off
**Source stories**: epic-emoji-feature/story-08 (prior round), epic-image-sharing/story-07, epic-emoji-feature S1 (this round, near-miss)
**Source agents**: base:verification-examiner (this round, retrospectively flagging the prior round), lead cross-check against working tree and `bug-reports/e2e-iteration-2026-05-08.md`
**Provenance**: quizzl — no commits for the bad verifications (the implementing diffs are missing or were missing); referenced artifacts: `groups-reactions.spec.ts:328`, `MarmotContext.tsx` vs. `ChatStoreContext.tsx` discrepancy in epic-image-sharing
**Observation**:
> The original story-08 verifier closed AC-56 as YES while groups-reactions.spec.ts:328 was deterministically failing — the fix was not yet landed.

> [Lead] `epic-image-sharing` story-07 verifier answered AC-41 YES against `MarmotContext.tsx` while the actual deliverable belongs in `ChatStoreContext.tsx` (and the implementing diff is still uncommitted in the working tree as of today).

> [Lead] The verifier I spawned this round only avoided the same trap because the brief explicitly told it about the prior failure and demanded AC-by-AC code tracing.

The pattern is: verifiers answer AC questions against AC text + adjacent-looking code without confirming the code path under test is actually the path the AC specifies, and without confirming the test that asserts the AC is currently green. Two adjacent epics, same mode, identified across two different ACs (AC-56 and AC-41). The fact that an explicit "trace every assertion to production code, do not repeat the prior failure" instruction in the brief is what averts the failure means the default verifier behavior is the failure.

**Suggested harness change**:
Add two non-optional fields to the `verification-examiner` rubric, applied per AC: (a) the file:line of the production code path the AC's e2e/integration assertion exercises, derived by reading the test, not the AC text; and (b) the current pass/fail status of that test on HEAD, with the run command and exit code captured. An AC cannot be answered YES without both fields populated. This makes the trap that caught story-08 and story-07 structurally impossible rather than instruction-dependent.

### `describe.serial` cascade caps e2e verification confidence regardless of fix quality
**Source stories**: epic-emoji-feature S1 (this round)
**Source agents**: lead (e2e run analysis)
**Provenance**: `app/tests/e2e/groups-reactions.spec.ts` lines 161 (B2 optimistic-ADD bridge bug, pre-existing, out of scope), 197 (AC-40 remove via bridge — did not run), 302 (AC-49/AC-51/AC-56 picker-UI remove — green)
**Observation**:
The structural fix for the remove-tombstone bug is identical between the picker-UI path (line 302) and the bridge path (line 197). Line 302 is e2e-green, validating the fix. Line 197 did-not-run because `describe.serial` blocks downstream tests when an upstream test fails, and the upstream failure (line 161 / B2) is an unrelated, pre-existing bug. The fix is correct (unit-tested + indirectly e2e-validated via the symmetric path), but e2e confidence for the line-197 path is gated on B2, which is out of scope for this round.

This is a single-occurrence observation in this retro, but it is structural: any future fix in this spec file that lands behind line 161 will hit the same wall. Surfacing it because the lead flagged it explicitly and the gating mechanism is durable.

**Suggested harness change**:
None at the harness level — this is project-internal test architecture. Project-specific fix is to either (1) split `describe.serial` blocks at the line-161 boundary so a B2 failure does not poison line 197 onward, or (2) prioritize B2. Documenting here so the next person hitting "AC-X did not run" in this file recognizes the pattern.

### Ad-hoc retro pipeline is missing
**Source stories**: this retrospective itself
**Source agents**: lead
**Provenance**: this `/feature`-Step-6 invocation outside its declared trigger contract
**Observation**:
The trigger contract scopes this agent to `/feature` Step 6. Workflows that are ad-hoc — reopen-and-fix, bug rescue, lead-driven verification rounds, anything that produces real per-agent RETROSPECTIVE blocks but did not start from `/feature` — currently have no retro pipeline. The per-agent RETROSPECTIVE blocks live only in tool output and evaporate when the lead's context window rolls. The lead routed around this by manually quoting the blocks into the spawn prompt for this invocation. That is fragile.

**Suggested harness change**:
Three concrete options, in increasing order of invasiveness:

1. **`/retro` slash command.** A user-invocable command that takes a free-form input bundle (story result paths or inline pasted RETROSPECTIVE blocks + lead-observed signals) and produces a retro body. Same agent, broadened invocation surface. Lowest cost; the agent's prose contract already handles ad-hoc inputs (this very retro proves it).

2. **`lead-invoked` mode flag.** Extend the trigger contract to accept an explicit `mode: lead-invoked` with a documented input schema that does not require `result.json` / `retro_bundle` / `verification.json`. The lead supplies whatever they have; the agent does best-effort synthesis. Preserves the strict `/feature` Step 6 path while unblocking ad-hoc use.

3. **Persist per-agent RETROSPECTIVE blocks to a known path.** Have `pbt-dev` and `verification-examiner` (and any other doer agent that emits a RETROSPECTIVE block) always write the block to a known path — e.g. `specs/epic-<slug>/.retros/<agent>-<commit-or-timestamp>.md` — in addition to returning it in tool output. The lead then has a stable on-disk corpus to pass to the synthesizer regardless of how the work was triggered. Highest invasiveness, but solves the evaporation problem permanently and removes the lead's manual-quotation step.

Recommend option 1 as the immediate fix and option 3 as the durable fix. Option 2 is a half-measure unless paired with option 3.

### Documented friction (C1 Playwright cache contention) was not adopted as a permanent fix
**Source stories**: epic-emoji-feature S1 (this round, e2e setup)
**Source agents**: lead
**Provenance**: `bug-reports/e2e-iteration-2026-05-08.md` § C1; this session re-applied the workaround by hand
**Observation**:
The C1 Playwright browser-cache contention failure (`/opt/playwright-browsers/chromium_headless_shell-1208` missing) was already documented in `bug-reports/e2e-iteration-2026-05-08.md` with three candidate permanent fixes. None has been adopted. The lead re-applied the documented workaround manually this session. Pure execution friction — diagnosis is correct and complete; the gap is execution-on-the-followups, not understanding.

This is a single-occurrence observation in this round (it has happened more than once historically, but only once in *this* invocation), so it is logged here as a per-finding signal rather than a cross-story theme. Surfacing because the lead flagged it explicitly and because un-adopted documented fixes accumulate cost on every subsequent e2e run.

**Suggested harness change**:
None at the harness level. Project-specific: pick one of the three candidate permanent fixes from `bug-reports/e2e-iteration-2026-05-08.md` § C1 and land it.

## Discrepancies
- Verbatim from lead's notes:
  > Verifier rubber-stamping is recurring, not a one-off. Two adjacent recent epics show the identical failure mode: epic-emoji-feature story-08 verifier closed AC-56 as YES while the e2e was deterministically red. epic-image-sharing story-07 verifier answered AC-41 YES against MarmotContext.tsx while the actual deliverable belongs in ChatStoreContext.tsx (and the implementing diff is still uncommitted in the working tree as of today).
  > The verifier I spawned this round only avoided the same trap because the brief explicitly told it about the prior failure and demanded AC-by-AC code tracing. Without that instruction, I believe it would have repeated the pattern.
  > describe.serial cascade caps verification confidence regardless of fix quality. B2 (optimistic-ADD bridge bug at line 161) blocks the e2e gold-standard signal for AC-40 remove (line 197) even though the structural fix for AC-40 remove is identical to AC-56's and is unit-tested. Future serial-block fixes in this file will hit the same wall until B2 is fixed.
  > C1 Playwright cache contention bit again. Already documented in `bug-reports/e2e-iteration-2026-05-08.md` § C1 with three permanent-fix candidates listed. None has been adopted; the workaround had to be re-applied by hand this session.
  > Ad-hoc retro pipeline is missing entirely. This is the proximal reason for this very invocation. The contract gap is the finding.

---

## Trigger-contract recommendation (off-spec note)

The synthesizer was invoked outside its declared trigger contract (`/feature` Step 6).
The contract should be broadened. Concrete recommendations, repeated here as the
explicit closing note the lead asked for:

1. **`/retro` slash command** (lowest cost). User-invocable; takes a free-form input
   bundle (paths or pasted RETROSPECTIVE blocks + lead signals) and produces a retro
   body. The synthesizer's prose contract already handles ad-hoc inputs.
2. **`lead-invoked` mode flag** on this agent. Extend the trigger contract to accept
   `mode: lead-invoked` with a relaxed input schema (no `result.json` / `retro_bundle` /
   `verification.json` requirement). Preserves the `/feature` Step 6 path while
   unblocking ad-hoc use.
3. **Persist per-agent RETROSPECTIVE blocks to a known on-disk path** (durable fix).
   Have `pbt-dev`, `verification-examiner`, and any other doer that emits a
   RETROSPECTIVE block always write it to e.g.
   `specs/epic-<slug>/.retros/<agent>-<commit-or-timestamp>.md` in addition to
   returning it in tool output. Solves the evaporation problem permanently
   (the per-agent blocks here only survived because the lead manually quoted them
   into the spawn prompt before they scrolled out of context). Removes the lead's
   manual-quotation step and makes the synthesizer's input corpus stable across
   invocation paths.

Recommended pairing: option 1 immediately + option 3 as the durable fix.
