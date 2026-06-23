/**
 * Media acquisition and lifecycle manager (Story S3).
 *
 * Handles getUserMedia, track mute/disable, hardware release, and device
 * enumeration. Pure library code — no React, no context imports.
 *
 * IP privacy mode integration point: The caller (callManager.ts in S5) will
 * pass an iceTransportPolicy to peerSession. IP privacy does not affect media
 * acquisition — it affects the ICE config in turnConfig.ts (S10). No IP-privacy
 * logic is needed in this module.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export interface MediaAcquisitionResult {
  stream: MediaStream;
  audioTrack: MediaStreamTrack;
  videoTrack: MediaStreamTrack | null;
}

// ── Video constraints ─────────────────────────────────────────────────────────

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

// ── Error message helpers ─────────────────────────────────────────────────────

function makeMediaError(domErr: unknown): Error {
  if (domErr instanceof DOMException) {
    let msg: string;
    switch (domErr.name) {
      case 'NotAllowedError':
        msg = 'Media permission denied by user or browser policy';
        break;
      case 'NotFoundError':
        msg = 'No suitable media device found (microphone or camera missing)';
        break;
      case 'NotReadableError':
        msg = 'Media device is already in use by another application';
        break;
      default:
        msg = `Media device error: ${domErr.name} — ${domErr.message}`;
    }
    const err = new Error(msg);
    err.cause = domErr;
    return err;
  }

  const err = new Error(
    domErr instanceof Error
      ? `Unexpected error acquiring media: ${domErr.message}`
      : 'Unexpected error acquiring media',
  );
  err.cause = domErr;
  return err;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Acquire mic (voice) or mic+cam (video) from the browser.
 *
 * Throws a structured Error (with `cause` set to the original DOMException) if:
 *   - Permission is denied (NotAllowedError)
 *   - No device is present (NotFoundError)
 *   - The device is in use (NotReadableError)
 *   - Any other DOMException or unexpected failure
 *
 * Postcondition: the returned `stream` contains exactly one audio track.
 * For 'video' calls it also contains exactly one video track.
 */
export async function acquireMedia(callType: 'voice' | 'video'): Promise<MediaAcquisitionResult> {
  const constraints: MediaStreamConstraints =
    callType === 'video'
      ? { audio: true, video: VIDEO_CONSTRAINTS }
      : { audio: true, video: false };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    throw makeMediaError(err);
  }

  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();

  // getUserMedia with audio:true guarantees at least one audio track when it
  // resolves successfully. Guard defensively in case a browser deviates.
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    const err = new Error('getUserMedia resolved but stream contains no audio track');
    err.cause = null;
    throw err;
  }

  return {
    stream,
    audioTrack: audioTracks[0],
    videoTrack: videoTracks.length > 0 ? videoTracks[0] : null,
  };
}

/**
 * Mute or unmute the audio track(s) in `stream`.
 *
 * Setting `muted = true` sets `track.enabled = false`, silencing transmission
 * without stopping the hardware (indicator light stays on — use releaseMedia
 * to fully release the device).
 */
export function muteAudio(stream: MediaStream, muted: boolean): void {
  for (const track of stream.getAudioTracks()) {
    track.enabled = !muted;
  }
}

/**
 * Enable or disable the video track(s) in `stream`.
 *
 * Setting `disabled = true` sets `track.enabled = false`, sending black frames
 * without stopping the hardware (camera light stays on — use releaseMedia to
 * fully release the device).
 */
export function disableVideo(stream: MediaStream, disabled: boolean): void {
  for (const track of stream.getVideoTracks()) {
    track.enabled = !disabled;
  }
}

/**
 * Stop all tracks in `stream` and release the hardware.
 *
 * After this call the hardware indicator (camera/mic light) turns off. The
 * stream object becomes inert — do not attempt to re-use it.
 */
export function releaseMedia(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Enumerate available audio/video devices.
 *
 * Returns empty arrays when `navigator.mediaDevices` is unavailable (SSR,
 * insecure context, or browser without media support).
 *
 * Note: label strings are populated only after the user has granted a
 * media permission in the same origin. Before that, labels are empty strings.
 */
export async function enumerateDevices(): Promise<{
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    return { audioInputs: [], videoInputs: [], audioOutputs: [] };
  }

  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (err) {
    console.warn('[mediaManager] enumerateDevices failed:', err);
    return { audioInputs: [], videoInputs: [], audioOutputs: [] };
  }

  return {
    audioInputs: devices.filter((d) => d.kind === 'audioinput'),
    videoInputs: devices.filter((d) => d.kind === 'videoinput'),
    audioOutputs: devices.filter((d) => d.kind === 'audiooutput'),
  };
}
