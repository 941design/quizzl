# Incremental E2E Policy — emoji-feature epic

`make test-e2e` and `make test-e2e-groups` run the **full** Playwright suite
serially (`workers: 1`, ~5+ minutes for groups, can hang). For per-story
validation this is too slow and obscures where failures originate. Use the
incremental protocol below instead.

## Order of execution (binding)

When validating a single story, run e2e specs in this order, **stopping at
the first failure** and reporting it:

1. **Tier 1 — New specs for this story.** The Playwright spec(s) added or
   modified in this story. If any of these fail, the story's own claims
   are broken. Report and stop.

2. **Tier 2 — Specs that exercise the same surface.** Specs whose paths
   match the touched component(s) or library file(s):
   - `EmojiComposerPicker.tsx` / `composeInsert.ts` → `emoji-composer.spec.ts`
     (already in Tier 1) plus any chat-input regression spec.
   - `directMessages.ts` (DM transport) → `groups-direct-chat-*.spec.ts`,
     `dm-*.spec.ts`.
   - `MarmotContext.tsx` / `ChatStoreContext.tsx` → `groups-*.spec.ts` that
     exercise group send/receive (e.g. `groups-contacts.spec.ts`,
     `groups-direct-chat-no-duplicates.spec.ts`).
   - `ChatBox.tsx` → all chat surfaces (DM and group specs both).
   - `lib/reactions/*` → reactions specs once they exist.

3. **Tier 3 — Broader regression.** A representative sample from the
   remaining suite (e.g. `notification-bell.spec.ts`, `banner-decor.spec.ts`)
   to catch unrelated regressions. Skip if Tier 2 was extensive.

Do **not** run the full suite as a single command unless the story is the
final one in the epic.

## How to invoke

Two acceptable approaches; pick whichever fits the verifier's tools:

### A. `base:e2e-tester` subagent (preferred)

```
Agent({
  subagent_type: "base:e2e-tester",
  description: "Run story-NN e2e specs incrementally",
  prompt: "Run these Playwright specs in order, stop on first failure: [tier-1-list, tier-2-list, tier-3-list]. Report which spec fails (if any) and the first failing assertion. Use `node scripts/run-e2e.mjs <path>` to invoke individual specs."
})
```

### B. Direct invocation per spec

For specs that need the strfry harness (groups), bring it up once:

```
make e2e-up   # one-time per session — docker-compose strfry+blossom
```

Then run each spec in order, stopping on failure:

```
node app/scripts/run-e2e.mjs tests/e2e/<spec>.spec.ts
```

Tear down at the end of the validation pass:

```
make e2e-down
```

For specs that don't need a relay (e.g. `emoji-composer.spec.ts`), invoke
directly:

```
cd app && node scripts/run-e2e.mjs tests/e2e/<spec>.spec.ts
```

## Known pre-existing failures (do not block stories on these)

- `app/tests/e2e/story-01-scaffold.spec.ts:23` — pre-existing failure on
  `master` as of story-05. Verified by `git log` showing no recent
  changes around the failing assertion. Not introduced by this epic.

## When the full suite IS warranted

- The story-09-style final epic gate (if any).
- A claim of "no regressions epic-wide" before merge.
- Investigating a flake suspected to be cross-spec ordering.

In these cases, run `make test-e2e-groups` once with adequate timeout and
expect 5+ minutes.

## Why incremental

- A 5-minute hang masks where the failure is.
- Agents have repeatedly stalled on full-suite runs (story-05 round 1 was
  blocked here for ~30 minutes).
- Tier-1 + Tier-2 typically completes in under 60 seconds and isolates
  the regression.
