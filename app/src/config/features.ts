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
