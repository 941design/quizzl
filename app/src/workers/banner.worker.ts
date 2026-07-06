// app/src/workers/banner.worker.ts
//
// S5 (base:dev). Pure message-passing wrapper — off-main-thread banner
// generation (architecture.md Module Map: "banner.worker (NEW) | off-main-
// thread generation via postMessage; requestIdleCallback fallback if worker
// bundling proves fussy | Owned Data: none — pure message-passing wrapper
// around dynamicVisuals's generator call". Boundary Rule 11: worker bundling
// via Next.js 14's native `new Worker(new URL(...))` ESM pattern is
// genuinely greenfield in this repo (zero prior Worker usage); if bundling
// under `output: 'export'` proves fussy, useDynamicBanner.ts falls back to
// requestIdleCallback instead of ever calling the generator synchronously on
// the render path.
//
// THIS FILE MUST NOT DUPLICATE ANY OF dynamicVisuals.ts's INTERNAL
// composition/param-randomization logic (no blob math either) — it calls
// DYNAMIC_GENERATORS.watercolor exactly once and posts exactly one message
// per branch (architecture.json public_api / dependencies_forbidden:
// AC-STRUCT-4 single-import-site invariant — this file goes through
// DYNAMIC_GENERATORS exactly like useDynamicBanner.ts already does).
//
// Type-checking note: this repo's tsconfig.json has no "webworker" lib entry
// (only "dom", "dom.iterable", "esnext") and none is added here — `self`'s
// "dom"-lib (Window) typing is a superset that covers `addEventListener`
// with a MessageEvent<T> callback and `postMessage` cleanly, so this file
// type-checks with zero tsconfig changes.
import { DYNAMIC_GENERATORS, type StyleToken } from '@/src/themes/treatments/dynamicVisuals';

/** Message contract posted TO this worker (owned here — useDynamicBanner.ts imports it type-only). */
export type BannerWorkerRequest = { style: StyleToken; kind: 'banner'; render?: Record<string, unknown> };

/** Message contract posted FROM this worker back to the main thread. `ok: false` is the fail-soft signal for a generator throw. */
export type BannerWorkerResponse = { ok: true; svg: string } | { ok: false };

// The worker's own entry-point side effect — executed only inside the Worker
// global scope this file is instantiated into via `new URL(...)`, never
// imported for its runtime value from the main thread (architecture.json
// dependencies_forbidden). Never throws uncaught: a single try/catch around
// the one generator call, one postMessage per branch.
self.addEventListener('message', (event: MessageEvent<BannerWorkerRequest>) => {
  try {
    const svg = DYNAMIC_GENERATORS.watercolor(event.data.style, event.data.kind, event.data.render);
    self.postMessage({ ok: true, svg } satisfies BannerWorkerResponse);
  } catch {
    self.postMessage({ ok: false } satisfies BannerWorkerResponse);
  }
});
