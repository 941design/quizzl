/**
 * Unit tests for mediaManager.ts — Story S3, media acquisition and lifecycle.
 *
 * Tests:
 *   T1. acquireMedia('voice') calls getUserMedia with {audio:true, video:false}
 *       and returns correct result shape (audioTrack present, videoTrack null).
 *   T2. acquireMedia('video') calls getUserMedia with video constraints and
 *       returns correct result shape (videoTrack present).
 *   T3. Permission denied: getUserMedia rejects with NotAllowedError →
 *       acquireMedia throws a descriptive Error with cause set.
 *   T4. No device: NotFoundError → throws descriptive Error with cause.
 *   T5. muteAudio toggles track.enabled correctly.
 *   T6. disableVideo toggles video track.enabled correctly.
 *   T7. releaseMedia calls .stop() on every track in the stream.
 *   T8. enumerateDevices returns empty arrays when navigator.mediaDevices is undefined.
 *
 * Mocking strategy:
 *   navigator.mediaDevices is replaced via vi.stubGlobal / Object.defineProperty
 *   with a fake that returns controlled MediaStream and MediaStreamTrack objects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireMedia,
  muteAudio,
  disableVideo,
  releaseMedia,
  enumerateDevices,
} from '@/src/lib/calls/mediaManager';

// ── Fake MediaStreamTrack factory ─────────────────────────────────────────────

function makeFakeTrack(kind: 'audio' | 'video'): MediaStreamTrack {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

// ── Fake MediaStream factory ──────────────────────────────────────────────────

function makeFakeStream(audioCount = 1, videoCount = 0): {
  stream: MediaStream;
  audioTracks: MediaStreamTrack[];
  videoTracks: MediaStreamTrack[];
} {
  const audioTracks = Array.from({ length: audioCount }, () => makeFakeTrack('audio'));
  const videoTracks = Array.from({ length: videoCount }, () => makeFakeTrack('video'));
  const allTracks = [...audioTracks, ...videoTracks];

  const stream: MediaStream = {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    getTracks: () => allTracks,
  } as unknown as MediaStream;

  return { stream, audioTracks, videoTracks };
}

// ── DOMException factory ──────────────────────────────────────────────────────

function makeDomException(name: string): DOMException {
  const ex = new DOMException(name, name);
  return ex;
}

// ── Navigator mediaDevices stub helpers ───────────────────────────────────────

function stubMediaDevices(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
}

function clearMediaDevicesStub() {
  vi.unstubAllGlobals();
}

// =============================================================================
// T1 & T2: acquireMedia() — happy path
// =============================================================================

describe('acquireMedia', () => {
  afterEach(() => {
    clearMediaDevicesStub();
  });

  // ── T1: voice call ─────────────────────────────────────────────────────────

  it('T1: voice — calls getUserMedia({audio:true, video:false}) and returns audioTrack / videoTrack=null', async () => {
    const { stream, audioTracks } = makeFakeStream(1, 0);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMediaDevices(getUserMedia);

    const result = await acquireMedia('voice');

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });

    expect(result.stream).toBe(stream);
    expect(result.audioTrack).toBe(audioTracks[0]);
    expect(result.videoTrack).toBeNull();
  });

  // ── T2: video call ─────────────────────────────────────────────────────────

  it('T2: video — calls getUserMedia with ideal 1280×720@30fps constraints and returns videoTrack', async () => {
    const { stream, audioTracks, videoTracks } = makeFakeStream(1, 1);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMediaDevices(getUserMedia);

    const result = await acquireMedia('video');

    expect(getUserMedia).toHaveBeenCalledOnce();
    const [constraints] = getUserMedia.mock.calls[0] as [MediaStreamConstraints];
    expect(constraints.audio).toBe(true);
    expect(constraints.video).toMatchObject({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });

    expect(result.stream).toBe(stream);
    expect(result.audioTrack).toBe(audioTracks[0]);
    expect(result.videoTrack).toBe(videoTracks[0]);
  });

  // ── T3: NotAllowedError ────────────────────────────────────────────────────

  it('T3: permission denied — throws descriptive Error with cause=NotAllowedError', async () => {
    const domErr = makeDomException('NotAllowedError');
    const getUserMedia = vi.fn().mockRejectedValue(domErr);
    stubMediaDevices(getUserMedia);

    await expect(acquireMedia('voice')).rejects.toThrow(/permission denied/i);
    await expect(acquireMedia('voice')).rejects.toMatchObject({ cause: domErr });
  });

  // ── T4: NotFoundError ──────────────────────────────────────────────────────

  it('T4: no device — throws descriptive Error with cause=NotFoundError', async () => {
    const domErr = makeDomException('NotFoundError');
    const getUserMedia = vi.fn().mockRejectedValue(domErr);
    stubMediaDevices(getUserMedia);

    await expect(acquireMedia('voice')).rejects.toThrow(/No suitable media device/i);
    await expect(acquireMedia('voice')).rejects.toMatchObject({ cause: domErr });
  });

  // ── NotReadableError (device in use) ───────────────────────────────────────

  it('NotReadableError — throws descriptive Error mentioning device in use', async () => {
    const domErr = makeDomException('NotReadableError');
    const getUserMedia = vi.fn().mockRejectedValue(domErr);
    stubMediaDevices(getUserMedia);

    await expect(acquireMedia('voice')).rejects.toThrow(/already in use/i);
    await expect(acquireMedia('voice')).rejects.toMatchObject({ cause: domErr });
  });

  // ── Unknown DOMException ───────────────────────────────────────────────────

  it('unknown DOMException — throws descriptive Error with cause set', async () => {
    const domErr = makeDomException('AbortError');
    const getUserMedia = vi.fn().mockRejectedValue(domErr);
    stubMediaDevices(getUserMedia);

    await expect(acquireMedia('voice')).rejects.toThrow(/AbortError/i);
    await expect(acquireMedia('voice')).rejects.toMatchObject({ cause: domErr });
  });
});

// =============================================================================
// T5: muteAudio
// =============================================================================

describe('muteAudio', () => {
  it('T5: muted=true sets audio track.enabled to false', () => {
    const { stream, audioTracks } = makeFakeStream(1, 0);
    audioTracks[0].enabled = true;

    muteAudio(stream, true);

    expect(audioTracks[0].enabled).toBe(false);
  });

  it('T5: muted=false sets audio track.enabled to true', () => {
    const { stream, audioTracks } = makeFakeStream(1, 0);
    audioTracks[0].enabled = false;

    muteAudio(stream, false);

    expect(audioTracks[0].enabled).toBe(true);
  });

  it('T5: toggles all audio tracks when stream has multiple', () => {
    const { stream, audioTracks } = makeFakeStream(2, 0);

    muteAudio(stream, true);

    for (const track of audioTracks) {
      expect(track.enabled).toBe(false);
    }
  });

  it('T5: no-ops when stream has no audio tracks', () => {
    const { stream } = makeFakeStream(0, 1);
    // Should not throw
    expect(() => muteAudio(stream, true)).not.toThrow();
  });
});

// =============================================================================
// T6: disableVideo
// =============================================================================

describe('disableVideo', () => {
  it('T6: disabled=true sets video track.enabled to false', () => {
    const { stream, videoTracks } = makeFakeStream(1, 1);
    videoTracks[0].enabled = true;

    disableVideo(stream, true);

    expect(videoTracks[0].enabled).toBe(false);
  });

  it('T6: disabled=false sets video track.enabled to true', () => {
    const { stream, videoTracks } = makeFakeStream(1, 1);
    videoTracks[0].enabled = false;

    disableVideo(stream, false);

    expect(videoTracks[0].enabled).toBe(true);
  });

  it('T6: no-ops when stream has no video tracks (voice call)', () => {
    const { stream } = makeFakeStream(1, 0);
    // Should not throw
    expect(() => disableVideo(stream, true)).not.toThrow();
  });
});

// =============================================================================
// T7: releaseMedia
// =============================================================================

describe('releaseMedia', () => {
  it('T7: calls .stop() on every track in the stream', () => {
    const { stream, audioTracks, videoTracks } = makeFakeStream(1, 1);

    releaseMedia(stream);

    expect(audioTracks[0].stop).toHaveBeenCalledOnce();
    expect(videoTracks[0].stop).toHaveBeenCalledOnce();
  });

  it('T7: works when there are only audio tracks (voice call)', () => {
    const { stream, audioTracks } = makeFakeStream(1, 0);

    releaseMedia(stream);

    expect(audioTracks[0].stop).toHaveBeenCalledOnce();
  });

  it('T7: no-ops when stream has no tracks', () => {
    const { stream } = makeFakeStream(0, 0);
    expect(() => releaseMedia(stream)).not.toThrow();
  });
});

// =============================================================================
// T8: enumerateDevices
// =============================================================================

describe('enumerateDevices', () => {
  beforeEach(() => {
    clearMediaDevicesStub();
  });

  afterEach(() => {
    clearMediaDevicesStub();
  });

  it('T8: returns empty arrays when navigator.mediaDevices is undefined', async () => {
    // Stub navigator without mediaDevices
    vi.stubGlobal('navigator', {});

    const result = await enumerateDevices();

    expect(result.audioInputs).toEqual([]);
    expect(result.videoInputs).toEqual([]);
    expect(result.audioOutputs).toEqual([]);
  });

  it('T8: returns empty arrays when navigator itself is not defined', async () => {
    // In a real SSR context navigator is not available; simulate by removing it
    vi.stubGlobal('navigator', undefined);

    const result = await enumerateDevices();

    expect(result.audioInputs).toEqual([]);
    expect(result.videoInputs).toEqual([]);
    expect(result.audioOutputs).toEqual([]);
  });

  it('partitions devices into audioInputs, videoInputs, and audioOutputs', async () => {
    const fakeDevices: Partial<MediaDeviceInfo>[] = [
      { kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Mic', groupId: '' },
      { kind: 'videoinput', deviceId: 'cam1', label: 'Built-in Camera', groupId: '' },
      { kind: 'audiooutput', deviceId: 'spk1', label: 'Built-in Speaker', groupId: '' },
      { kind: 'audioinput', deviceId: 'mic2', label: 'USB Mic', groupId: '' },
    ];

    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue(fakeDevices),
      },
    });

    const result = await enumerateDevices();

    expect(result.audioInputs).toHaveLength(2);
    expect(result.videoInputs).toHaveLength(1);
    expect(result.audioOutputs).toHaveLength(1);
    expect(result.audioInputs[0].deviceId).toBe('mic1');
    expect(result.videoInputs[0].deviceId).toBe('cam1');
    expect(result.audioOutputs[0].deviceId).toBe('spk1');
  });

  it('returns empty arrays when enumerateDevices rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });

    const result = await enumerateDevices();

    expect(result.audioInputs).toEqual([]);
    expect(result.videoInputs).toEqual([]);
    expect(result.audioOutputs).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
