# Feature Spec: Encrypted Image Sharing in Group Chat

## Context

The group chat in quizzl currently supports plain text messages and structured poll announcements only (see `app/src/components/groups/GroupChat.tsx`, `app/src/context/ChatStoreContext.tsx`). Members can describe things in words but cannot share visual content — screenshots of homework, photos from a class trip, diagrams, memes — which is the table-stakes feature people expect from any group messenger.

Marmot's MIP-04 v2 spec already defines an end-to-end encrypted image format (per-file ChaCha20-Poly1305 keys derived from the MLS exporter secret), and `marmot-ts` v0.4.0 ships ready-to-use helpers (`MarmotGroup.encryptMedia`, `decryptMedia`, `parseMediaImetaTag`). The encryption story is solved upstream — the missing pieces are entirely on the quizzl side: a file-picker UI, an upload client for Blossom, a thumbnail/blurhash pipeline, a wire format for image-bearing chat messages, a persistence layer for decrypted blobs, and a lightbox viewer.

The intended outcome: a group member can attach an image to a chat message (with optional caption), the image is processed locally (resized, EXIF-stripped, thumbnailed, blurhashed), encrypted with the current MLS epoch's per-file key, uploaded to a default Blossom server, and published as an MLS application rumor. Receiving members see a blurhash placeholder immediately, a low-res thumbnail as soon as it decrypts, and the full image after the larger blob downloads. Tapping the image opens a fullscreen lightbox with a download button. Everything that goes over the network is ciphertext.

## User-Facing Behaviour

### Composer
- The chat input panel gains an attachment button (paperclip icon) next to the send button.
- Clicking it opens the OS file picker (`<input type="file" accept="image/*" capture="environment">` — `capture` is honoured on mobile, ignored on desktop).
- Drag-and-drop: the chat panel highlights when a file is dragged over and accepts the drop.
- Paste: pasting an image into the message textarea (e.g. screenshot via Cmd/Ctrl+V) attaches it.
- Once attached, the composer shows a preview thumbnail above the input with a remove (×) button. The user can type an optional caption in the textarea below.
- Sending dispatches one message containing the image + caption. Hitting Enter without an attached image still sends a plain text message (existing behaviour preserved).
- Only one image per message in v1 (no albums).

### Outbound progress
- Optimistic render: the message bubble appears immediately with the local thumbnail. A small overlay shows progress: `processing → uploading XX% → sent`.
- If upload fails the bubble shows an error state with a retry affordance.
- If the user navigates away mid-upload, the upload continues in the background and completes; abort only on tab close.

### Inbound rendering
- A new image bubble component renders the message. On first paint it shows a blurhash placeholder at the encoded aspect ratio (no layout shift when the image arrives).
- The thumbnail blob is downloaded and decrypted first, fading in over the blurhash.
- The full-resolution blob downloads lazily — eagerly when the bubble enters the viewport, immediately when the user taps to open the lightbox.
- If the caption is non-empty it renders directly under the image, using the existing linkified text renderer (`app/src/lib/linkify.ts`).

### Lightbox
- Tapping the inline image opens a fullscreen Chakra modal showing the decrypted full-resolution image at native size with pan/pinch on touch.
- Header has a close button (×) and a download button. Download writes a file named `<sender-shortid>-<YYYYMMDD-HHmm>.<ext>` to the user's device.
- Tap-outside or Esc closes the lightbox.

### Failure modes
- Image too large after resize: surface an error in the composer ("Image too large to send"). Do not send.
- Upload fails after retries: keep the message in a failed state with a "Retry" button. Do not auto-discard.
- Decryption fails (corrupt ciphertext, hash mismatch, key missing because the message arrived from before this device joined the epoch): show a "Couldn't decrypt this image" tile in place of the image.
- Blossom 404 on download (file pruned by server): show a "Image is no longer available" tile.

## Wire Format

### Chat message envelope
Image messages reuse kind 9 (`CHAT_MESSAGE_KIND`) and follow the same JSON-content discriminator pattern that polls already use (`{type: 'poll_open', ...}`). `GroupChat.parseStructured()` (`app/src/components/groups/GroupChat.tsx:73`) is extended to recognise a new variant.

**Rumor:**
- `kind`: 9
- `content`: JSON string `{ "type": "image", "version": 1, "caption": "<optional>" }`. Caption is omitted (or empty string) when the user sent no caption.
- `tags`: two `imeta` tags built per NIP-92 + MIP-04 v2 — one for the full image, one for the thumbnail. They are distinguished by an extra `role` field that quizzl owns:
  - Full image: `["imeta", "url <blossom>", "m image/webp", "x <hex>", "size <bytes>", "dim <wxh>", "blurhash <bh>", "filename <name>", "n <nonce-hex>", "v mip04-v2", "role full"]`
  - Thumbnail: same shape with `role thumb` and its own `url`/`x`/`n` fields.

Receivers use `getMediaAttachments(rumor.tags)` from `marmot-ts/core/media.js` to get both attachments, then look at the `role` value (parsed manually since `parseMediaImetaTag` ignores unknown fields) to decide which is which. If `role` is missing on a single-attachment message we treat it as `full`.

### `MediaAttachment` shape (already provided by marmot-ts)
Defined in `marmot-ts/dist/core/media.d.ts:30-47`:
```
{
  url: string;          // Blossom blob URL
  sha256: string;       // hex SHA-256 of plaintext bytes
  type: string;         // canonicalised MIME, e.g. "image/webp"
  size?: number;
  dimensions?: string;  // "WIDTHxHEIGHT"
  blurhash?: string;
  filename: string;
  nonce: string;        // hex 12-byte AEAD nonce
  version: "mip04-v2";
}
```

## Architecture

### New modules
| Path | Responsibility |
|------|----------------|
| `app/src/lib/media/imageProcessing.ts` | Resize + strip EXIF + re-encode to WebP, generate thumbnail, compute blurhash, compute SHA-256 |
| `app/src/lib/media/blossomClient.ts` | BUD-01 signed-auth uploads + downloads against the configured server, with retry |
| `app/src/lib/media/imetaTag.ts` | Build `imeta` tag arrays from `MediaAttachment + role`. Hand-rolled NIP-92 serialiser (avoids adding `applesauce-common`) |
| `app/src/lib/media/imageMessage.ts` | Pack/parse the `{type:'image', ...}` JSON content, extract the two attachments + role from `rumor.tags` |
| `app/src/lib/marmot/mediaPersistence.ts` | IndexedDB store of decrypted blobs keyed by `groupId + sha256` |
| `app/src/components/groups/ImageAttachmentButton.tsx` | Paperclip icon + file picker + drag/drop/paste wiring |
| `app/src/components/groups/ImageMessageBubble.tsx` | Inbound bubble with blurhash → thumb → full progressive render |
| `app/src/components/groups/ImageLightbox.tsx` | Fullscreen modal with download button |
| `app/src/hooks/useImageSend.ts` | Orchestrates the full send pipeline (process → encrypt → upload → publish) with progress callbacks |
| `app/src/hooks/useDecryptedImage.ts` | Suspense-friendly hook that returns object URLs for `(groupId, attachment)` and shares in-flight downloads |

### Modified modules
| Path | Change |
|------|--------|
| `app/src/components/groups/GroupChat.tsx` | Render `ImageAttachmentButton` in the input row; teach `parseStructured()` about `type: 'image'`; render `ImageMessageBubble` when the structured type is image |
| `app/src/context/ChatStoreContext.tsx` | Expose `sendImageMessage(file, caption)` alongside the existing `sendMessage(content)`. Optimistic UI must include the local pre-upload thumbnail so the bubble renders instantly |
| `app/src/context/MarmotContext.tsx` | Construct each `MarmotGroup` with a `media` factory backed by `mediaPersistence.ts` so `decryptMedia()` is cached on disk, surviving reloads and key rotations |
| `app/src/lib/marmot/chatPersistence.ts` | No schema change required — `ChatMessage.content` stays a JSON string; the existing dedup/sort logic carries over. Add a non-breaking optional `localMediaRefs?: string[]` to remember which decrypted blobs belong to a message (for cleanup on group leave) |
| `app/src/lib/i18n.ts` | Add `groups.imageAttachmentLabel`, `groups.imageUploading`, `groups.imageSendFailed`, `groups.imageRetry`, `groups.imageDecryptFailed`, `groups.imageUnavailable`, `groups.imageDownload`, `groups.imageTooLarge`, `groups.imageProcessing` — both `en` and `de` |
| `app/src/config/profile.ts` (or new `app/src/config/blossom.ts`) | Hardcoded default Blossom server URL + sane upload limits |

### Send pipeline (step by step)

> **DECISION (2026-04-25)**: V1 runs the processing pipeline on the **main thread** (not a Web Worker). This matches the codebase (no Workers exist yet) and avoids new webpack/Next-14 infrastructure. Brief jank on large inputs is acceptable; Worker migration is a follow-up if it becomes a problem.

1. `useImageSend.send(file, caption)` is called from the composer.
2. **Pre-process on the main thread** with chunked yields (`await new Promise(r => setTimeout(r, 0))`) between heavy steps so the UI stays responsive:
   - Decode the image with `createImageBitmap`.
   - If width or height exceed `MAX_EDGE` (constant: 2048), scale down preserving aspect ratio. Always re-encode to **WebP at 0.85 quality** via canvas `toBlob` (or `OffscreenCanvas.convertToBlob` when available). Re-encoding through a canvas inherently strips EXIF and any embedded ICC/IPTC metadata.
   - Generate a thumbnail by repeating the same pipeline at `THUMB_MAX_EDGE` (constant: 320), WebP at 0.6 quality.
   - Compute blurhash from a small 32×32 pixel sample (use the `blurhash` npm package).
   - Compute SHA-256 of plaintext bytes for both blobs (full + thumb) — needed for MIP-04 key derivation. Use `crypto.subtle.digest('SHA-256', ...)`; no extra dependency.
3. **Encrypt** both blobs:
   - `const fullEnc  = await group.encryptMedia(fullBlob,  { filename, type:'image/webp', dimensions, blurhash, size })`.
   - `const thumbEnc = await group.encryptMedia(thumbBlob, { filename: filename+'.thumb', type:'image/webp', dimensions: thumbDim, size })`.
   - `group` comes from `useMarmot().getGroup(groupId)` (`app/src/context/MarmotContext.tsx:978`).
4. **Upload** ciphertexts to Blossom via `blossomClient.put(encryptedBytes)`:
   - Compute SHA-256 of ciphertext bytes (Blossom's blob address is the ciphertext hash, not the plaintext hash — confirm against the chosen server's BUD-02 behaviour).
   - Build a BUD-01 auth event (kind 24242, NIP-98-style) signed by the user's existing Nostr signer (NDK). Cache auths per session within their TTL.
   - PUT the bytes to `<blossomBase>/upload`. Read the returned blob descriptor, extract the canonical URL, and stamp `attachment.url`.
   - Retry (3× exponential backoff) on transient errors. Surface terminal errors via the progress callback.
5. **Publish** via `group.sendApplicationRumor(rumor)` (`marmot-ts/dist/client/group/marmot-group.d.ts:232`). The rumor is built locally:
   - `kind: 9`, `content: JSON.stringify({ type:'image', version:1, caption })`, `tags: [imetaFull, imetaThumb]`, `created_at: now`, `pubkey: <our hex pubkey>`. Leaves `id`/`sig` empty per Marmot's rumor convention.
6. **Persist locally** via the existing `appendMessage` (`app/src/lib/marmot/chatPersistence.ts:37`) and via `mediaPersistence` (decrypted blobs for both full and thumb, keyed by their plaintext SHA-256).
7. Optimistic message ID is replaced by the real rumor ID; same dedup logic as today (`app/src/context/ChatStoreContext.tsx:104`).

### Receive pipeline

1. `MarmotGroup` emits `applicationMessage`. `ChatStoreContext` already deserialises the rumor and filters by kind (`app/src/context/ChatStoreContext.tsx:116`).
2. The existing `parseStructured` is extended; when it returns `{type:'image', ...}` the receive path additionally extracts `MediaAttachment[]` from `rumor.tags` via `getMediaAttachments` and stores them in the persisted `ChatMessage` (new optional `attachments` field on `ChatMessage`).
3. Render: the message list uses the structured type to pick `ImageMessageBubble`, which:
   - Shows the blurhash immediately (cheap, no I/O).
   - Calls `useDecryptedImage(groupId, thumbAttachment)`. The hook checks `mediaPersistence` first; on miss it downloads from Blossom, calls `group.decryptMedia(...)` (which itself caches into the `media` store passed to `MarmotGroup`), wraps in an object URL, and returns it.
   - When the user scrolls the bubble into view (IntersectionObserver) or taps it, repeats the same hook call for the full attachment.
4. Group leave (`group.leave()` already implemented elsewhere) triggers a cleanup pass that walks all stored `localMediaRefs` for the group and deletes them from `mediaPersistence` and from object-URL caches.

## Pre-Upload Processing Constants

Defined in a single config module:
- `MAX_EDGE`: 2048 px
- `THUMB_MAX_EDGE`: 320 px
- `MAX_INPUT_BYTES`: 25 MB (rejected before processing)
- `MAX_OUTPUT_BYTES`: 5 MB (rejected after processing if still over — would only trigger for adversarial inputs)
- `OUTPUT_MIME`: `image/webp`
- `FULL_QUALITY`: 0.85
- `THUMB_QUALITY`: 0.6
- `BLURHASH_COMPONENTS`: `[4, 3]`

## Persistence

Two new IndexedDB key namespaces (via the existing `idb-keyval` dep):
- `quizzl:media:blob:<groupId>:<plaintextSha256>` → `{ bytes: Uint8Array, type: string }` (the decrypted plaintext, mirrors what Marmot's `StoredMedia` shape gives us).
- `quizzl:media:meta:<groupId>:<plaintextSha256>` → `{ messageIds: string[] }` (reverse index for cleanup, since a single blob may be referenced by multiple messages — e.g. forwards in v2).

Plaintext storage is consistent with how kind 9 text already lives plaintext in IDB. The privacy model is "device-local plaintext is acceptable, network ciphertext is mandatory".

`MarmotGroup` is given a `media` factory that wraps this same store so that `marmot-ts`' built-in cache and quizzl's UI cache are the same physical storage. This is the single source of truth — no double-caching.

## Blossom

### Server
Hardcoded default in `app/src/config/blossom.ts`: **`https://blossom.band`** (decided 2026-04-25). Code path is server-agnostic; the constant lives in one file so swapping later is a one-line change.

### Auth
BUD-01 signed authorization events (kind 24242) signed via NDK's existing signer. Each auth event:
- `created_at`: now
- `tags`: `[["t","upload"], ["x", <ciphertext-sha256>], ["expiration", <now+5min>]]`
- `content`: short human label (e.g. `"quizzl image upload"`)

Re-signing per upload is fine; we don't bother caching auths in v1.

### Retries
Three attempts with 500ms / 1500ms / 5000ms backoff. Terminal failure surfaces to the UI.

### Static-export compatibility
The PWA constraint (`output: 'export'`) is irrelevant here — Blossom is a runtime fetch from the browser. No `next/image`, no server-side image optimisation. Image rendering uses Chakra's `<Image>` (which is just `<img>`) on object URLs created from decrypted blobs.

## i18n

Both EN and DE entries added to `app/src/lib/i18n.ts` under `groups`:
- `imageAttachmentLabel` — "Attach image" / "Bild anhängen"
- `imageProcessing` — "Processing image…" / "Bild wird verarbeitet…"
- `imageUploading: (pct: number) => string` — "Uploading {pct}%" / "Wird hochgeladen {pct} %"
- `imageSendFailed` — "Failed to send image" / "Bild konnte nicht gesendet werden"
- `imageRetry` — "Retry" / "Erneut versuchen"
- `imageDecryptFailed` — "Couldn't decrypt this image" / "Bild konnte nicht entschlüsselt werden"
- `imageUnavailable` — "Image is no longer available" / "Bild ist nicht mehr verfügbar"
- `imageDownload` — "Download" / "Herunterladen"
- `imageTooLarge` — "Image is too large" / "Bild ist zu groß"
- `imageRemove` — "Remove image" / "Bild entfernen"

## New Dependencies

- `blurhash` (~5 KB) — encode + decode blurhash strings.
- *(No `applesauce-common`)* — we hand-roll the imeta tag builder in `app/src/lib/media/imetaTag.ts` to avoid pulling in the entire applesauce stack for two helper functions. Inbound parsing already comes for free via `marmot-ts`' own `parseMediaImetaTag` / `getMediaAttachments`.
- *(No Blossom SDK)* — the BUD-01 auth + PUT flow is ~80 lines using `fetch` + the existing NDK signer. Adding `blossom-client-sdk` is an option if it turns out non-trivial; revisit during implementation.

## Testing & Verification

### Unit tests (vitest)
- `imageProcessing.test.ts`: round-trip a known PNG → resized WebP, assert `dimensions <= MAX_EDGE`, assert EXIF is absent, assert blurhash is a valid string of expected length.
- `imetaTag.test.ts`: build → `parseMediaImetaTag` → equal-modulo-canonicalisation. Round-trip both `role full` and `role thumb`.
- `imageMessage.test.ts`: round-trip JSON envelope; reject malformed structured content; coexist with existing poll content discriminator.
- `mediaPersistence.test.ts`: set / get / delete; cleanup on group leave.

### Integration test (vitest, hits a real ephemeral Blossom server if one is wired into the test fixture, otherwise mocks the HTTP layer)
- Mock MarmotGroup → `encryptMedia` → blossomClient → publish → ingest on a second simulated client → `decryptMedia` → original bytes.

### E2E (Playwright, alongside existing `test:e2e:groups`)

> **DECISION (2026-04-25)**: E2E uses a **tiny Blossom mock server added to `docker-compose.e2e.yml`** (alongside strfry on :7777) — not `page.route`. It must implement BUD-02 PUT `/upload` (store ciphertext keyed by ciphertext-sha256) and GET `/<sha256>` (serve back). One small Node script. Add Make targets `e2e-blossom-up`/`e2e-blossom-down` (or fold them into the existing `e2e-up`/`e2e-down`).

- Two-tab scenario: tab A creates a group, invites tab B, tab B joins. Tab A attaches a known fixture image, sends. Assert the message appears on tab B with a blurhash placeholder, then with the thumbnail, then with the full image. Assert the lightbox opens and download triggers a file save.
- Failure scenarios: stop the mock server (or have it return 500 for one upload) → assert the retry button surfaces; restart/recover → click retry → assert success.
- Mobile viewport: assert the file picker accepts the camera capture intent (via `accept`/`capture` attributes).

### Manual verification
1. `make dev`, open in two browser profiles, join the same group.
2. Send a `image/jpeg` photo from disk. Confirm: optimistic render, progress, final render, no console errors.
3. Reload both tabs. Confirm the image is still rendered (cached blob path).
4. Have an admin add a third member, triggering a commit (epoch advance). Send a new image. Reload. Confirm the *old* image still renders (blob cache survives epoch advance, validating the persistence design).
5. Drag an image onto the chat panel; confirm it attaches.
6. Take a screenshot, paste into the textarea; confirm it attaches.
7. Tap an image; confirm lightbox + download.

## Out of Scope (v1)

- Albums / multi-image messages. (Single image + caption only.)
- Replying to or quoting an image. (Replies via existing `e` tags would work for the envelope but are not wired in the current chat UI.)
- Animated GIFs, video, audio, generic file attachments. (WebP-encoded stills only.)
- Image edits (crop, rotate, draw on top) before sending.
- Deletion / unsend. (No NIP-09 support yet in the chat layer.)
- Forwarding an image to another group. (Would require either re-encrypting under the destination group's epoch or referencing the existing ciphertext — out of scope for v1.)
- Garbage collection on Blossom. Quizzl uploads but never deletes; cleanup is server policy. The MIP spec leaves this to operators.
- User-configurable Blossom server. Hardcoded default per the answered scope question; revisit if needed.
- Client-side virus / NSFW screening.

## Open Questions / Risks

- ~~**Blossom server choice.**~~ **RESOLVED 2026-04-25: `https://blossom.band`.**
- **NDK signer availability.** Blossom auth requires an actual signer, not a read-only pubkey. Confirm the auth bootstrap path makes a signer available before the user can open the chat composer (almost certainly yes — they'd already need a signer to send any chat message — but worth a defensive check).
- ~~**OffscreenCanvas + Web Worker support.**~~ **RESOLVED 2026-04-25: V1 is main-thread only; Worker migration deferred.**
- **`role` tag isn't part of MIP-04.** It's a quizzl-private convention encoded in the imeta tag's name-value pairs. NIP-92 allows arbitrary keys, and `parseMediaImetaTag` ignores unknown ones, so this is forward-compatible with other MIP-04 clients (they'd see two attachments with the same filename and could pick either).
- **Blossom address: ciphertext hash vs plaintext hash.** BUD-02 uses the SHA-256 of the uploaded bytes as the address — for us that's the *ciphertext* hash. The MIP-04 attachment's `sha256` field is the *plaintext* hash. Don't confuse them; they're distinct fields with distinct purposes.

## Files To Touch (Summary)

**New:**
- `app/src/lib/media/imageProcessing.ts` (main-thread; no separate worker file in v1)
- `app/src/lib/media/blossomClient.ts`
- `app/src/lib/media/imetaTag.ts`
- `app/src/lib/media/imageMessage.ts`
- `app/src/lib/marmot/mediaPersistence.ts`
- `app/src/components/groups/ImageAttachmentButton.tsx`
- `app/src/components/groups/ImageMessageBubble.tsx`
- `app/src/components/groups/ImageLightbox.tsx`
- `app/src/hooks/useImageSend.ts`
- `app/src/hooks/useDecryptedImage.ts`
- `app/src/config/blossom.ts`
- Tests for each of the above.

**Modified:**
- `app/src/components/groups/GroupChat.tsx` — composer button, structured-type extension, render dispatch.
- `app/src/context/ChatStoreContext.tsx` — `sendImageMessage` method, optimistic UI for attachments.
- `app/src/context/MarmotContext.tsx` — wire `media` factory into MarmotGroup construction.
- `app/src/lib/marmot/chatPersistence.ts` — optional `attachments` and `localMediaRefs` fields on `ChatMessage`.
- `app/src/lib/i18n.ts` — new EN+DE strings under `groups`.
- `app/package.json` — add `blurhash`.
