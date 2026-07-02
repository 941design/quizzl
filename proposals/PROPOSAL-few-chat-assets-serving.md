# Proposal: serve `few.chat/assets/*` from the `few-assets` R2 bucket

**To:** maintainers of the few.chat app (the Cloudflare Pages project served at
`few.chat` / `few-chat.pages.dev`).
**From:** the avatar-generation / avatar-server project (produces the avatar PNGs
and the manifest few.chat consumes).
**Status:** blocked on the few.chat side. Everything on the avatar side is done;
one routing change in the few.chat app is required to make avatars render.

> **Adapted to the few.chat repo (2026-07-02).** The hosting assumption is
> confirmed: few.chat deploys to **Cloudflare Pages**, but by **direct upload**
> — `make deploy` runs `wrangler pages deploy app/out` from the repo root, not a
> dashboard drag-drop and not a Git-integration build. (Note: `CLAUDE.md` still
> says "GitHub Pages" — that is stale; the Makefile is authoritative.) The
> recommendation (Option A) stands, and §5 now gives the exact wiring for this
> direct-upload pipeline instead of dashboard clicks. All repo-side claims below
> (manifest path, config pin, the guarding test) have been verified against the
> checked-in code.

---

## 1. Executive summary

Avatars now live in a **Cloudflare R2 bucket (`few-assets`)** and the few.chat app
renders them from a committed manifest whose image URLs point at
`https://few.chat/assets/<id>.png`. The PNGs have been uploaded to R2 and verified
present. **But `https://few.chat/assets/<id>.png` currently returns HTTP 404** —
because nothing routes `/assets/*` to the bucket, so the few.chat app answers those
requests with its own SPA/404 page.

**The decision for you:** choose how `few.chat/assets/*` should resolve to the
`few-assets` bucket. Our recommendation is a **Pages Function with an R2 binding**,
because it keeps the existing URL contract, keeps the bucket private, and ships
through your current Pages deploy. Details and alternatives below.

**User-facing effect once wired:** the avatar browser in few.chat stops showing
broken-image placeholders and renders all 657 published avatars. No app logic
changes — only the images become reachable.

---

## 2. Current behavior (evidence)

Measured from the avatar-server project against production:

| Check | Result |
|-------|--------|
| Object present in R2 (`wrangler r2 object get few-assets/<id>.png`) | **200** — returns the real 150,641-byte PNG |
| Public URL from the manifest (`GET https://few.chat/assets/<id>.png`) | **404**, body is `text/html` (~21 KB) — the few.chat app's own page |

The 404 body being the app's HTML is the tell: the request reaches few.chat, but
few.chat has no `/assets/*` handler, so its catch-all serves the SPA/404 response
instead of the image. The upload is fine; the **serving route is missing**.

---

## 3. The contract the avatar side depends on

These are fixed by the manifest and a few.chat regression test. Whatever routing
option you choose must satisfy them:

| Requirement | Value / reason |
|-------------|----------------|
| Request | `GET https://few.chat/assets/<id>.png` (also `HEAD`) |
| `<id>` | the object key in `few-assets` — the PNG filename (currently a UUID), e.g. `01000f37-a015-4997-8923-43b40c9ee182.png` |
| Response on hit | `200`, the PNG bytes, `Content-Type: image/png` |
| Response on miss | `404` (a real 404, not the SPA page, so broken entries are diagnosable) |
| Scheme | **HTTPS**. The manifest uses protocol-relative `//few.chat/assets/...`; an `http://` image URL is blocked as mixed content. `app/tests/unit/avatarManifest.test.ts` guards this — but note it only forbids `http://`; a protocol-relative `//` URL passes. Same-origin HTTPS satisfies it for free. |

**Two places pin the host/path** (verified in the repo), not one:
1. `app/src/data/avatarManifest.json` — every `imageUrl` is `//few.chat/assets/<id>.png`.
2. `app/src/config/profile.ts` — `AVATAR_BROWSER_CONFIG.endpointBaseUrl = '//few.chat/assets'`.

Changing to a different host/path (Option B) is therefore a change in **both** the
manifest *and* the app config, plus the guarding test — see Option B for why we
advise against it.

---

## 4. Options

| | A. Pages Function + R2 binding **(recommended)** | B. Public R2 custom domain (subdomain) | C. Standalone Worker route |
|---|---|---|---|
| Mechanism | A function in the Pages project handles `/assets/*`, reads the key from a bound `few-assets` bucket, streams it back | Attach a hostname (e.g. `assets.few.chat`) to the bucket as an R2 public custom domain; Cloudflare serves objects directly | A separate Worker bound to `few.chat/assets/*` with an R2 binding |
| URL contract | **Unchanged** — stays `few.chat/assets/<id>.png` | **Breaks** — becomes `assets.few.chat/<id>.png`; manifest + emitter must change | Unchanged |
| Bucket exposure | Stays **private** (served through the binding) | Bucket made **public** | Stays private |
| Header/caching control | Full (set `Content-Type`, `Cache-Control` in code) | Limited to R2/CDN defaults + rules | Full |
| Operational surface | Rides the existing `make deploy` (`wrangler pages deploy`); adds a repo-root `functions/` dir + a `wrangler.toml` (binding + build-output dir) | New DNS record + public-bucket config; no app code | A second deploy artifact + route precedence to manage |
| Main drawback | Requires a Functions handler + a `wrangler.toml` in the repo (this repo has neither today) | Manifest/contract change + public bucket + mixed-content re-test | Extra Worker to own; route ordering vs Pages |

### Why we recommend A and reject B as the default

**Reject B (mechanism):** the manifest hardcodes `//few.chat/assets/<id>.png`, and
that exact shape is pinned by a mixed-content regression test. Moving to
`assets.few.chat` forces a change to the manifest emitter on the avatar side **and**
a re-verification of that test, and it makes the bucket public. That is more moving
parts, across two repos, for no user-visible benefit over A. If B is nonetheless
chosen, the follow-on work is: (1) add the `assets.few.chat` DNS + R2 custom domain,
(2) change `STORED_BASE_URL` in `emit-avatar-manifest.mjs` (avatar side),
(3) regenerate and re-commit the manifest, (4) change
`AVATAR_BROWSER_CONFIG.endpointBaseUrl` in `app/src/config/profile.ts` (few.chat
side), (5) re-verify the guarding test.

**Reject C (mechanism):** it works, but you now own a separate Worker and must
ensure its `few.chat/assets/*` route takes precedence over the Pages catch-all.
That is strictly more operational surface than a function that already lives inside
the Pages project. Prefer C only if you deliberately want assets decoupled from the
app's deploy lifecycle.

---

## 5. Recommended implementation (Option A) — wired for this repo's direct upload

This repo deploys by direct upload, not a Pages Git build. `wrangler pages deploy`
**does** compile a `functions/` directory and **does** apply bindings, but only
when it can find them — for direct upload that means a repo-checked-in
`functions/` dir plus a `wrangler.toml`. The dashboard "Add binding" flow does
**not** apply here (dashboard direct-upload does not support Functions; the
wrangler CLI path does). Concretely:

1. **Add a `wrangler.toml` at the repo root** declaring the Pages build output and
   the R2 binding (this is the source of truth `wrangler pages deploy` reads):
   ```toml
   name = "few-chat"
   pages_build_output_dir = "app/out"

   [[r2_buckets]]
   binding     = "few_assets"   # -> env.few_assets in the function
   bucket_name = "few-assets"
   ```
   > The bucket name `few-assets` and binding `few_assets` are the create-bucket
   > coordinates (see Appendix). `pages_build_output_dir` must match `LOCAL_DIST`
   > (`app/out`) in the Makefile.

2. **Add the function at the repo root** — `functions/`, **not** inside `app/out`
   (that dir is wiped and regenerated on every `make build`). Cloudflare requires
   the functions dir at the project root, outside the static output.
   ```js
   // functions/assets/[[path]].js
   export async function onRequest(context) {
     const { request, env, params } = context;
     if (request.method !== 'GET' && request.method !== 'HEAD') {
       return new Response('Method Not Allowed', { status: 405 });
     }
     const key = Array.isArray(params.path) ? params.path.join('/') : params.path;
     if (!key || key.includes('..')) return new Response('Not Found', { status: 404 });

     const object = await env.few_assets.get(key);
     if (!object) return new Response('Not Found', { status: 404 });

     const headers = new Headers();
     object.writeHttpMetadata(headers);
     if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/png');
     headers.set('Cache-Control', 'public, max-age=86400'); // see §6
     headers.set('ETag', object.httpEtag);
     return new Response(request.method === 'HEAD' ? null : object.body, { headers });
   }
   ```
   The route `functions/assets/[[path]].js` binds `/assets/*` and captures the key
   after `/assets/` in `params.path`.

3. **Reconcile the Makefile deploy command.** With a `wrangler.toml` present,
   `pages_build_output_dir` is the source of truth, so the deploy line should drop
   the positional output-dir arg and let wrangler read the config (this is also
   what makes it pick up the `functions/` dir and bindings):
   ```make
   # Makefile, deploy target — was:
   #   npx --yes wrangler@latest pages deploy $(LOCAL_DIST) \
   #     --project-name=$(FEW_PROJECT) --branch=main --commit-dirty=true
   # becomes:
   npx --yes wrangler@latest pages deploy \
     --project-name=$(FEW_PROJECT) --branch=main --commit-dirty=true
   ```
   `make build` still produces `app/out`; `deploy-check` still asserts
   `app/out/index.html` exists. Nothing else in the pipeline changes.

4. **Precedence is automatic.** The static export has no SPA rewrite — it emits a
   real `404.html` that Pages serves for unmatched paths. A Pages Function on
   `/assets/*` is matched before the static-asset/404 fallback, and wrangler
   auto-generates the `_routes.json` that scopes the function to `/assets/*` only,
   leaving all app routes on the static path. No manual precedence config needed.

5. **Deploy** with `make deploy` (or `make deploy` after `make build`). Verify per §7.

---

## 6. The one real decision inside Option A: cache immutability

Uploads from the avatar side are **overwrite-by-id**: regenerating an avatar can
replace the object at the same `<id>.png` key. That interacts with caching:

- `Cache-Control: public, max-age=31536000, immutable` — best performance, but a
  replaced image can be served stale for up to a year at the edge/browser.
- `Cache-Control: public, max-age=86400` (used in the snippet above) — a safe
  default: cached for a day, picks up replacements within 24h.

Pick based on whether ids are truly stable. If a given `<id>.png` will **never**
change content once published, use `immutable`. If images can be regenerated in
place, keep a moderate `max-age`. This is a judgment call only you can make for
few.chat's release cadence.

---

## 7. Verification (after deploy)

```bash
# 1. A known object returns the image, not the SPA page:
curl -I https://few.chat/assets/01000f37-a015-4997-8923-43b40c9ee182.png
#   expect: HTTP/2 200, content-type: image/png

# 2. A missing object returns a real 404 (not the 21 KB HTML page):
curl -I https://few.chat/assets/does-not-exist.png
#   expect: HTTP/2 404, small body

# 3. Manifest smoke test — every referenced image resolves:
#    (run against app/src/data/avatarManifest.json)
```
The avatar side can re-run its own reachability check across a sample of manifest
ids once you confirm the route is live.

---

## 8. Scope boundaries

**Already done (avatar side) — no action needed from you:**
- `few-assets` R2 bucket created (Standard storage class), in the same Cloudflare
  account as the few.chat Pages project.
- 657 fruit avatars uploaded and verified present in the bucket.
- `avatarManifest.json` generated with the correct `//few.chat/assets/<id>.png`
  URLs, subjects, and accessories.

**This proposal (few.chat side) — the ask:**
- Route `/assets/*` → `few-assets` (Option A recommended). Concretely, three
  small checked-in artifacts: `wrangler.toml` (build-output dir + R2 binding),
  `functions/assets/[[path]].js` (the handler), and a one-line `Makefile` deploy
  edit. No app/runtime code changes; no change to the manifest or to
  `app/src/config/profile.ts`.

**Related but separate — the manifest hand-off:**
- New/changed avatars require the regenerated `avatarManifest.json` to be committed
  into the few.chat app (at `app/src/data/avatarManifest.json`) and redeployed. The
  app renders a committed snapshot, not R2 live, by design. This proposal does not
  change that; it only makes the images the manifest points at reachable.

---

## Appendix — coordinates

- **Bucket:** `few-assets` (Cloudflare R2, Standard class).
- **Suggested binding:** `few_assets` (from the create-bucket output).
- **Sample keys that are known-present in the bucket** (for testing):
  - `01000f37-a015-4997-8923-43b40c9ee182.png`
  - `747a8c89-f51f-4b26-9375-1e47b8d1953d.png`
- **Object key scheme:** `<uuid>.png` — the manifest `id` is the key without `.png`.
- **Current published set:** subject_type = `fruit`, 657 objects (the catalog can
  later expand to other subjects; that only adds objects under the same scheme).
