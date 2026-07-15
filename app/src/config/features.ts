/**
 * Feature toggles — compile-time flags that turn whole product features on or off.
 *
 * These are intentionally plain constants (not env-driven) so a disabled feature
 * is dead-code-eliminated from the shipped bundle and its UI simply does not render.
 */

/**
 * Voice/video calls.
 *
 * Temporarily DISABLED: the call feature (WebRTC signalling, TURN relay config,
 * call UI) is retained in the codebase but not exposed to users. The call icons
 * in the contacts/groups views are commented out, and this flag gates the
 * TURN-server / IP-privacy configuration block in Settings.
 *
 * Flip to `true` to re-enable the call surfaces. The underlying feature code is
 * kept intact so no re-implementation is needed.
 */
export const CALLS_ENABLED = false;

/**
 * Message attachments (image sharing).
 *
 * DEPRECATED / DISABLED: attaching images to messages is being retired. The
 * feature code (Blossom upload/download, image processing, the encrypted
 * image-message rumor kinds, the render path for previously-sent images) is
 * retained in the codebase but no new attachment can be composed.
 *
 * This flag gates ChatBox's composer entry points — the attach button, the
 * drag/drop handler and the clipboard paste handler — which covers every
 * surface that sends messages: contacts (DM), groups, and the developer/
 * feedback channel. Gating in ChatBox rather than at each call site keeps the
 * three entry points from drifting apart; a send that bypassed one of them is
 * the failure mode this feature has had before.
 *
 * Note this only stops *composing* new attachments. Images already received or
 * sent still render, so history stays readable while the feature winds down.
 *
 * Flip to `true` to re-enable. No re-implementation needed.
 */
export const ATTACHMENTS_ENABLED = false;
