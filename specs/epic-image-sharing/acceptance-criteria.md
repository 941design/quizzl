# Acceptance Criteria — Image Sharing Epic

Each AC uses the form: **[Component/Function] [verb] [resulting state]** — specific, testable, no intent language.

---

## Config & i18n (Story 01)

**AC-01** `app/src/config/blossom.ts` exports `BLOSSOM_BASE_URL` equal to `"https://blossom.band"`, `MAX_EDGE` equal to `2048`, `THUMB_MAX_EDGE` equal to `320`, `MAX_INPUT_BYTES` equal to `26214400` (25 MB), `MAX_OUTPUT_BYTES` equal to `5242880` (5 MB), `OUTPUT_MIME` equal to `"image/webp"`, `FULL_QUALITY` equal to `0.85`, `THUMB_QUALITY` equal to `0.6`, and `BLURHASH_COMPONENTS` equal to `[4, 3]`.

**AC-02** The `Copy` type in `app/src/lib/i18n.ts` is extended with `groups.imageAttachmentLabel: string`, `groups.imageProcessing: string`, `groups.imageUploading: (pct: number) => string`, `groups.imageSendFailed: string`, `groups.imageRetry: string`, `groups.imageDecryptFailed: string`, `groups.imageUnavailable: string`, `groups.imageDownload: string`, `groups.imageTooLarge: string`, `groups.imageRemove: string`.

**AC-03** Both the `en` and `de` objects in `app/src/lib/i18n.ts` contain non-empty values for all ten keys listed in AC-02; `imageUploading` is a function accepting a number and returning a localised string.

---

## Image Processing Utility (Story 02)

**AC-04** `imageProcessing.processImage(blob)` returns a `ProcessedImage` object whose `full.blob` has MIME type `"image/webp"`, whose `full.dimensions` width and height are both ≤ `MAX_EDGE` (2048), and whose byte size is ≤ `MAX_OUTPUT_BYTES` (5 MB) when given any valid raster input ≤ `MAX_INPUT_BYTES`.

**AC-05** `imageProcessing.processImage(blob)` returns a `ProcessedImage` where `thumb.blob` has MIME type `"image/webp"`, and `thumb.dimensions` width and height are both ≤ `THUMB_MAX_EDGE` (320).

**AC-06** `imageProcessing.processImage(blob)` returns a `ProcessedImage` where `full.sha256` and `thumb.sha256` are each a 64-character lowercase hex string equal to the SHA-256 of the respective plaintext blob bytes.

**AC-07** `imageProcessing.processImage(blob)` returns a `ProcessedImage` where `blurhash` is a non-empty string whose length is consistent with `BLURHASH_COMPONENTS = [4, 3]` (i.e., between 6 and 50 characters per the blurhash spec).

**AC-08** `imageProcessing.processImage(blob)` throws `ImageTooLargeError` when the input blob byte size exceeds `MAX_INPUT_BYTES` (25 MB), without performing any canvas operations.

**AC-09** A WebP blob produced by `imageProcessing.processImage` does not contain an Exif APP1 marker (`FF E1`) at byte offset 12 when given a JPEG input that originally contained EXIF data.

---

## imeta Tag Builder + Image Message Envelope (Story 03)

**AC-10** `buildImetaTag(attachment, role)` returns a `string[]` whose first element is `"imeta"`, which includes entries for `url`, `m`, `x`, `size`, `dim`, `blurhash`, `filename`, `n`, `v`, and `role` when all corresponding fields on `attachment` are populated.

**AC-11** `parseMediaImetaTag(buildImetaTag(attachment, "full"))` (from `marmot-ts`) returns a `MediaAttachment` whose `url`, `sha256`, `type`, `filename`, `nonce`, and `version` fields equal the corresponding values on the original `attachment`.

**AC-12** `buildImetaTag(attachment, "thumb")` produces a tag where the entry `"role thumb"` is present, and `buildImetaTag(attachment, "full")` produces a tag where the entry `"role full"` is present.

**AC-13** `buildImageMessageContent(caption)` returns a JSON string that `JSON.parse` decodes to `{ type: "image", version: 1, caption: <string> }`.

**AC-14** `buildImageMessageContent("")` produces an object where `caption` is `""`, and `parseImageMessageContent` applied to that string returns `{ type: "image", version: 1, caption: "" }`.

**AC-15** `parseImageMessageContent` returns `null` for any string that is not valid JSON, or whose parsed `type` field is not `"image"`, or whose `version` field is absent — ensuring coexistence with existing `poll_open`/`poll_close` discriminators.

---

## Blossom Client (Story 04)

**AC-16** `buildBlossomAuthEvent(signer, ciphertextSha256)` returns an unsigned event draft with `kind: 24242`, a `["t", "upload"]` tag, a `["x", <ciphertextSha256>]` tag, and an `["expiration", <timestamp>]` tag where the expiration is approximately `now + 300` seconds (within ±5 s tolerance).

**AC-17** `blossomClient.put(encryptedBytes, authEvent)` sends a `PUT` request to `<BLOSSOM_BASE_URL>/upload` with the correct `Authorization: Nostr <base64-encoded-auth>` header and the encrypted bytes as the body, and returns the canonical blob URL from the server response's `url` field.

**AC-18** `blossomClient.put` retries up to 3 times on HTTP 5xx or network error, with delays of approximately 500 ms, 1500 ms, and 5000 ms, and throws a `BlossomUploadError` after the third failure.

**AC-19** `blossomClient.put` does NOT retry on HTTP 4xx responses and throws `BlossomUploadError` immediately.

**AC-20** `blossomClient.get(sha256)` fetches `<BLOSSOM_BASE_URL>/<sha256>` and returns the response body as `Uint8Array`, or throws `BlossomNotFoundError` on HTTP 404.

---

## Media Persistence + MarmotClient media factory + leaveGroup cleanup (Story 05)

**AC-21** `mediaPersistence.setBlob(groupId, plaintextSha256, data)` stores `{ bytes: Uint8Array, type: string }` such that a subsequent `mediaPersistence.getBlob(groupId, plaintextSha256)` returns the same `bytes` and `type` after an in-process round-trip.

**AC-22** `mediaPersistence.addMessageRef(groupId, plaintextSha256, messageId)` and `mediaPersistence.clearGroupMedia(groupId)` together result in `mediaPersistence.getBlob(groupId, plaintextSha256)` returning `null` after `clearGroupMedia` is called.

**AC-23** `MarmotClient` is constructed in `MarmotContext.tsx:259-268` with a `mediaFactory` option of type `GroupMediaFactory<BaseGroupMedia>` backed by the `quizzl-media-blobs` / `blobs` IDB store, so that `group.media` is defined for every group loaded after app startup.

**AC-24** The `leaveGroup` function in `MarmotContext.tsx` calls `mediaPersistence.clearGroupMedia(groupId)` between `clearPollData` and `clearUnreadGroup`, so that all persisted blobs for the group are removed from the `quizzl-media-blobs` IDB store on leave.

**AC-25** `'quizzl-media-blobs'` is added to the `INDEXEDDB_DATABASES` array in `app/tests/e2e/helpers/clear-state.ts` so that the E2E `clearAppState` helper deletes this database on each test run.

---

## Send Pipeline: useImageSend + ChatStoreContext + Composer UI (Story 06)

**AC-26** `ChatStoreContext` exposes `sendImageMessage(file: File, caption: string): Promise<void>` that is accessible via `useChatStore()`.

**AC-27** Calling `sendImageMessage` immediately adds an optimistic `ChatMessage` with `content` equal to `JSON.stringify({ type: "image", version: 1, caption })` and a non-empty `attachments` array to the `messages` state before any async processing completes.

**AC-28** After `sendImageMessage` resolves successfully, `appendMessage` is called with a `ChatMessage` whose `attachments` array contains two `MediaAttachment` objects (one with `role "full"`, one with `role "thumb"`) and whose `localMediaRefs` array contains at least two entries (one per attachment sha256).

**AC-29** `useImageSend.send` invokes the processing, encryption, and upload steps in order: `imageProcessing.processImage` → `group.encryptMedia` (twice) → `blossomClient.put` (twice) → `buildRumor` with `kind: 9`, then `group.sendApplicationRumor`.

**AC-30** `useImageSend.send` calls `mediaPersistence.setBlob` for both the full and thumbnail plaintext blobs before calling `sendApplicationRumor`, so that they are locally cached even for the sender.

**AC-31** `useImageSend.send` reports progress through a callback: `"processing"` before image processing, `"uploading"` with a percentage (0–100) during Blossom upload, and `"sent"` after `sendApplicationRumor` resolves.

**AC-32** When `blossomClient.put` throws `BlossomUploadError` after retries exhausted, `useImageSend.send` reports status `"failed"` via the progress callback and does NOT call `sendApplicationRumor`.

**AC-33** `GroupChat` renders an `ImageAttachmentButton` component with `data-testid="image-attachment-button"` in the composer row, adjacent to the send button.

**AC-34** `ImageAttachmentButton` opens a hidden `<input type="file" accept="image/*" capture="environment">` element on click, with `data-testid="image-file-input"`.

**AC-35** When a file is selected via the file input, a preview thumbnail appears in the composer area with `data-testid="image-preview-thumbnail"` and a remove button with `data-testid="image-preview-remove"`.

**AC-36** Clicking `data-testid="image-preview-remove"` clears the attachment so no preview is shown and pressing Enter sends a plain text message.

**AC-37** The composer area dispatches `dragover` + `drop` events containing an image `File`, the file is attached and `data-testid="image-preview-thumbnail"` becomes visible.

**AC-38** Pasting an image (via a `ClipboardEvent` with a `Files` item of type `image/*`) into the textarea attaches the file and renders `data-testid="image-preview-thumbnail"`.

**AC-39** When the processed output blob exceeds `MAX_OUTPUT_BYTES` (5 MB), `sendImageMessage` does not proceed to encrypt/upload and instead the composer displays a string containing `copy.groups.imageTooLarge` with `data-testid="image-too-large-error"`.

---

## Receive Pipeline: useDecryptedImage + ImageMessageBubble + GroupChat dispatch (Story 07)

**AC-40** `ChatMessage` in `app/src/lib/marmot/chatPersistence.ts` includes the optional fields `attachments?: MediaAttachment[]` and `localMediaRefs?: string[]`.

**AC-41** The receive handler in `MarmotContext.tsx:547-559` (kind 9 branch) passes `rumor.tags` through to `appendMessage` by populating the `attachments` field via `getMediaAttachments(rumor.tags)` when the parsed content has `type: "image"`.

**AC-42** `parseStructured` in `GroupChat.tsx` recognises `{ type: "image", version: 1, caption?: string }` and returns a typed object `{ type: "image"; version: 1; caption: string }` for valid image message content.

**AC-43** `GroupChat` renders an `ImageMessageBubble` component (not a plain-text bubble) when `parseStructured` returns `{ type: "image" }`.

**AC-44** `ImageMessageBubble` renders a blurhash placeholder element with `data-testid="image-blurhash-placeholder"` immediately on first render, before any Blossom download completes.

**AC-45** `useDecryptedImage(groupId, attachment)` checks `mediaPersistence.getBlob` first; on a cache hit it returns an object URL without making any network request.

**AC-46** `useDecryptedImage(groupId, attachment)` on a cache miss fetches `blossomClient.get(attachment.url)`, calls `group.decryptMedia(encryptedBytes, attachment)`, stores the result via `mediaPersistence.setBlob`, and returns an object URL.

**AC-47** When `useDecryptedImage` resolves with an object URL for the thumbnail, `ImageMessageBubble` replaces the blurhash placeholder with an `<img>` element with `data-testid="image-thumbnail"`.

**AC-48** When `group.decryptMedia` throws, `ImageMessageBubble` renders a tile with `data-testid="image-decrypt-failed"` containing text equal to `copy.groups.imageDecryptFailed`.

**AC-49** When `blossomClient.get` throws `BlossomNotFoundError`, `ImageMessageBubble` renders a tile with `data-testid="image-unavailable"` containing text equal to `copy.groups.imageUnavailable`.

**AC-50** A non-empty caption is rendered under the image using `splitLinks()` from `app/src/lib/linkify.ts` with `data-testid="image-caption"`.

---

## ImageLightbox (Story 08)

**AC-51** Clicking `data-testid="image-thumbnail"` inside `ImageMessageBubble` opens `ImageLightbox` as a fullscreen Chakra modal (`size="full"`).

**AC-52** `ImageLightbox` renders the full-resolution decrypted image via `useDecryptedImage(groupId, fullAttachment)` as an `<img>` element with `data-testid="lightbox-image"` once the blob resolves.

**AC-53** `ImageLightbox` renders a download button with `data-testid="lightbox-download"` that, when clicked, triggers a file download with a filename matching the pattern `<sender-shortid>-<YYYYMMDD-HHmm>.<ext>`.

**AC-54** `ImageLightbox` renders a close button with `data-testid="lightbox-close"` that dismisses the modal.

**AC-55** Pressing the Escape key while `ImageLightbox` is open closes the modal.

**AC-56** Clicking the modal overlay (outside the image content area) closes the modal.

---

## E2E: Blossom mock + groups-image-sharing.spec.ts (Story 09)

**AC-57** `docker-compose.e2e.yml` includes a `blossom-mock` service on port `3001` that implements `PUT /upload` (stores ciphertext keyed by ciphertext-SHA-256, returns JSON `{ url: "http://localhost:3001/<sha256>" }`) and `GET /:sha256` (returns the stored bytes with HTTP 200, or 404 if not found).

**AC-58** `make e2e-up` starts both the strfry relay and the blossom-mock container; `make e2e-down` stops and removes both.

**AC-59** `app/tests/fixtures/test-image.png` exists and is a valid PNG with byte size ≤ 50 KB.

**AC-60** The E2E test in `groups-image-sharing.spec.ts` two-tab scenario passes: tab A attaches `test-image.png`, sends, and within the timeout, tab B's message list contains an element with `data-testid="image-thumbnail"`.

**AC-61** The E2E test verifies that clicking `data-testid="image-thumbnail"` on tab B opens a modal with `data-testid="lightbox-image"` visible.

**AC-62** The E2E test verifies that clicking `data-testid="lightbox-download"` triggers a download (verified by the browser's download event or file system write).

**AC-63** The E2E test verifies the retry flow: with the blossom-mock returning HTTP 500, the composer shows `data-testid="image-send-failed"` after retries are exhausted; after mock recovery a click on `data-testid="image-retry-button"` successfully sends the image.

**AC-64** The E2E test verifies that after both tabs reload, tab B still renders `data-testid="image-thumbnail"` (cached blob survives page reload).
