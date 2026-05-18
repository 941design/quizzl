# Meta-Retro: BACKLOG.md → BACKLOG.json migration + bug-report triage

Date: 2026-05-18
Scope: meta — pipeline, agent design, project conventions
Trigger: `/base:orient` auto-migrated v2 BACKLOG.md → v3 BACKLOG.json (demoting 3 rows to findings); user asked me to triage every demoted row and every untracked file under `bug-reports/` and decide on my own whether each represents real outstanding work.

The triage itself landed. This retro is about what made it harder than it had to be and what would have let me decide without re-deriving from primary sources every time.

---

## What would have helped me decide on my own

### 1. Bug-report status header convention

Every file under `bug-reports/` is a snapshot of a moment. Several of the reports I triaged describe bugs that have since been fixed, but nothing in the file points at the fix. I had to:

- read each bug report,
- grep the cited file/line paths,
- run `git log --all -- <path>` to find the closing commit,
- compare current code against the report's hypothesis.

That is O(N) primary-source lookups per report. A two-line header at the top of every bug report would compress it to O(1):

```
Status: Resolved-in: <sha> (<one-line>)        # for closed
Status: Open — see findings[<slug>]            # when promoted to backlog
Status: Superseded-by: <other-report>          # when split or rerouted
```

Concrete examples from this triage:

| Report | Actual state I had to derive | Could have been declared |
|---|---|---|
| `avatar-images-placeholder-mobile.md` | Resolved by `e4cc6e1` + `d165f6b` (protocol-relative URLs) | `Status: Resolved-in: d165f6b` |
| `profile-propagation-new-members.md` | Superseded by `epic-member-profile-discovery-and-relay-on-behalf` (request/response + relay-on-behalf) | `Status: Superseded-by: profile-rumor-undeliverable-to-new-member.md` |
| `profile-rumor-undeliverable-to-new-member.md` | Still open; test.fixme at `groups-member-profiles.spec.ts:175` | `Status: Open — finding: profile-rumor-kind-from-one-peer` |

No tooling needed — just a writing convention. Could be added to whatever drops files into `bug-reports/` (the `/base:bug` workflow already writes there).

### 2. Bug-report files don't auto-enter the backlog

`bug-reports/` accumulates files but nothing routes them into `findings[]`. Both surfaces exist but the connection between them is manual. Today I had to grep `bug-reports/` myself, decide which were still real, and `add-finding` each by hand. A new bug report sitting next to a tracked-and-closed one looks identical from the outside.

Two options, in increasing invasiveness:

- **Convention**: every new bug-report file must be added as a finding the same session it's authored. The `/base:orient` Rule 0–style auto-migration could detect orphans by listing `bug-reports/*.md` and warning on any path not referenced by `findings[i].anchor.path`.
- **Tooling**: a `/base:bug --intake <path>` mode that takes an existing bug-report file, registers a finding, and stamps the report's Status header. Same surface for fresh bugs and historical orphans.

### 3. v2 BACKLOG.md migration demoted spec-pointing rows in a lossy way

The v2 `## Epics` section accepted rows like `specs/out-of-band-leave.md — PROPOSED — …` and `docs/event-sourced-receive-engine-spec.md — PROPOSED — …`. The migrator demoted both to generic findings because neither pointed at a `specs/epic-<slug>/` dir. That's true to the schema but throws away the writer's intent: these were *proposed epics whose spec just lived in the wrong place*, not generic backlog items.

I had to read each demoted finding's referenced spec file before I could tell they were epic-shaped. Two of the three demoted rows ended up becoming real epic dirs (`specs/epic-out-of-band-leave/`, `specs/epic-event-sourced-receive-engine/`); only the e2e-cache row was a genuine finding.

A safer migration could either:

- auto-scaffold an epic dir when a v2 `## Epics` row points at a `.md` file (move it into `specs/epic-<derived-slug>/spec.md`), or
- tag the resulting finding with a scope axis like `planned-epic` so triage can find them with one filter rather than reading every demoted spec.

The migration report (`BACKLOG.migration-report.md`) lists the demoted rows but says only "interpretable as work-we-know-about." It does not distinguish "thin TODO" from "full unstarted epic with a spec already drafted." Adding that distinction would make the report directly actionable.

### 4. The evidence-based classifier should hint at remediation

`base:next-epic` correctly classified `specs/epic-learning-groups-nostr-mls/` as `UNKNOWN` because it lacks a `spec.md`. The right action — write a minimal `Status: Implemented` stub — is one line of advice the classifier could include alongside the verdict. As written it just says UNKNOWN and stops; the user/agent has to know enough about the classifier's input set to derive the fix.

Concretely: when classifier returns `UNKNOWN` because `spec.md` is missing AND `epic-state.json#status == "done"` AND `completed_stories` is non-empty, emit:

> *Hint: dir looks like a completed pre-template epic. Write a `spec.md` stub with `Status: Implemented` to clear UNKNOWN; see ADR-NNN / `specs/epic-learning-groups-nostr-mls/spec.md` for the established pattern.*

This would save the same 5-minute pattern-derivation every time another legacy dir surfaces.

### 5. Memory entries describing "open follow-ups" decay faster than they should

`memory/open_followups_2026-05-08.md` — written 10 days ago — was already stale on every section by today. Most of what it called "open" had been closed by master commits in the intervening week:

- `epic-emoji-feature` was marked open; closed by `4d6d26b` → `74014ed`.
- `epic-image-sharing` AC-41 was called uncommitted; landed in `8e8a5ef`.
- `epic-member-profile-discovery` AC-045 reopen was called open; closed by `f53eacf`.

The memory file *does* say "verify state before acting — these will decay." I followed that. The cost is still that I caught the staleness only by cross-checking `git log -20`. For a project with this commit cadence, a memory file that names commits-as-state ("X is open since commit Y") is fundamentally a snapshot — its half-life on this repo is days, not weeks. Either:

- the memory should be tighter / shorter-lived, expiring itself by date, or
- the project-curator should be the one writing the equivalent file (so it's regenerated each `/feature` close), or
- I should just not write this kind of "open list" to memory and instead rely on `BACKLOG.json#findings[]` as the canonical surface (which is what I am converging on after this migration).

The third option is the right one. Memory entries should remember *non-derivable* facts ("this peer's profile rumor flake is upstream of EpochResolver, not in the buffer"), not commit-state inventories. I'll prune `open_followups_2026-05-08.md` separately.

### 6. Verifier rubber-stamping is a recurring failure mode and the only mitigation today is a prompt instruction

The emoji-feature reopen retrospective (`bug-reports/retro-emoji-feature-reopen-2026-05-08.md`) documented two adjacent epics where `verification-examiner` closed an AC against the wrong code path (story-08 AC-56, story-07 AC-41). The retro proposes two non-optional fields per AC verdict:

- the file:line of the production-code path that the AC's e2e/integration assertion actually exercises (derived by reading the test, not the AC text), and
- the current pass/fail status of that test on HEAD, with the run command and exit code.

That fix lives in the `verification-examiner` agent definition, not in any single project. Raising it up here per the global guideline (meta = always raise to you). I did not act on it in this session.

### 7. Ad-hoc retro pipeline is missing

Same retro flagged that work outside `/feature` Step 6 produces real RETROSPECTIVE blocks that evaporate when the lead's context rolls. Three options proposed in the retro itself:

1. `/retro` slash command (lowest cost) — takes a free-form input bundle.
2. `lead-invoked` mode flag on the retro-synthesizer agent — relaxed input schema.
3. Persist per-agent RETROSPECTIVE blocks to `specs/epic-<slug>/.retros/<agent>-<sha>.md` always, regardless of invocation path.

Recommended pairing in the retro: option 1 + option 3. Raising again here because nothing has happened since.

### 8. e2e-tester subagent reads stale `.output` paths; subagents fall into fault-then-rationalize

From `bug-reports/e2e-iteration-2026-05-08.md` § C2 and § C3. Both are global agent-design concerns that have been documented for 10 days without acting. Repeating verbatim:

- **C2**: bind a strict invariant on `base:e2e-tester` — "use ONLY the `.output` file path returned by your most recent `Bash run_in_background` in this turn."
- **C3**: encode into agent prompts — "when a strict-mode violation count exceeds the expected duplicate count by a large factor, suspect selector over-matching; when the count is 2-3 with distinct testids visible in the diagnostics, suspect product duplication."

### 9. Documented friction not being adopted compounds at every test run

The Playwright cache contention (C1 of the e2e iteration report) has three candidate permanent fixes documented since 2026-05-08, none adopted. I re-applied the workaround narrative in finding `makefile-envrc-not-pin-playwright-browsers` because that's still the right surface, but the fix itself is small (one `export` in `.envrc` or one Make var) and has now cost three sessions of repeated manual workaround. The pattern — "documented but not adopted" — is the meta finding worth raising: between documenting a friction and adopting its fix, the cheapest path is to *do the fix at documentation time*, especially when the report itself lists candidate fixes ranked by invasiveness.

---

## Summary of disposition

| Item | Decision | Rationale |
|---|---|---|
| `specs-out-band-leave-md-documented` finding | Promoted → `specs/epic-out-of-band-leave/` PLANNED | Spec was implementation-ready; demotion to finding was lossy. |
| `docs-event-sourced-receive-engine-spec` finding | Promoted → `specs/epic-event-sourced-receive-engine/` PLANNED | Architectural epic; flagged for `/base:arch-debate` first. |
| `e2e-infrastructure-playwright-browser-cache` finding | Re-anchored to `Makefile:45` with sharper text | Real infra TODO; documented fixes still unadopted. |
| `bug-reports/avatar-images-placeholder-mobile.md` | No new finding | Resolved by `e4cc6e1` + `d165f6b`. File is now historical record. |
| `bug-reports/profile-propagation-new-members.md` | No new finding | Superseded by member-profile-discovery epic (request/response + relay-on-behalf). |
| `bug-reports/profile-rumor-undeliverable-to-new-member.md` | Added finding `profile-rumor-kind-from-one-peer` | Real active flake; test still fixme on master. |
| `bug-reports/e2e-iteration-2026-05-08.md` B1 | Added finding `dm-rendering-produced-multiple-bubbles-per` | Locator workaround on master masks the underlying duplication. |
| `bug-reports/e2e-iteration-2026-05-08.md` B2 | No new finding | Closed by `dab5204` / `4d6d26b` / `74014ed` (emoji-feature reopen-remediation). |
| `bug-reports/e2e-iteration-2026-05-08.md` B3 | Added finding `profile-request-memo-attempts-stays-at` | Test still fixme; updated diagnosis (fake-clock interaction). |
| `bug-reports/e2e-iteration-2026-05-08.md` C1 | Covered by sharpened e2e finding | Same Playwright cache issue. |
| `bug-reports/e2e-iteration-2026-05-08.md` C2 / C3 | Meta — surfaced here (items 6, 8) | Global agent-design concerns. |
| `bug-reports/retro-emoji-feature-reopen-2026-05-08.md` | Meta — surfaced here (items 6, 7) | Cross-epic verifier rubber-stamping + ad-hoc retro pipeline gap. |
| `specs/epic-learning-groups-nostr-mls/` UNKNOWN | Wrote `spec.md` stub with `Status: Implemented` | Legacy pre-template epic; one-line fix. |
| Stale `next_action` on `epic-member-profile-discovery-and-relay-on-behalf` | Replaced with current state | v2 BACKLOG.md narrative survived migration verbatim. |

Net change: 14 epics (2 new PLANNED), 4 sharp findings (down from 3 thin + 5 untracked-but-unresolved bug reports), 1 legacy epic dir repaired, 1 stale comment cleaned.
