/**
 * CallScreen.tsx — Full-screen in-call overlay (Story S7).
 *
 * Mounted in Layout.tsx alongside IncomingCallModal. Renders only when
 * callStore.active !== null. Presents a video/avatar grid, a bottom
 * controls bar (mute, camera, hang-up), and a participant list.
 *
 * Design decisions:
 *   - Fixed-position overlay rather than a Chakra Modal, so the screen
 *     sits above all other layers (zIndex 1400, above Chakra modal at 1300)
 *     without the nesting-modal complexity.
 *   - Local isMuted/isCameraOff state shadows the MediaStream state for
 *     immediate UI feedback; callManager.setMuted/setVideoEnabled is
 *     called as a side-effect.
 *   - Video elements are wired via useEffect + srcObject = stream because
 *     React does not support srcObject as a JSX prop.
 *   - Camera button is hidden for voice-only calls (callType === 'voice').
 *   - PiP button is conditionally rendered based on
 *     document.pictureInPictureEnabled, checked at mount time.
 *   - No console.error calls.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Flex,
  Grid,
  GridItem,
  HStack,
  IconButton,
  Text,
  Tooltip,
  VStack,
} from '@chakra-ui/react';
import { useCallStore } from '@/src/lib/calls/callStore';
import { getCallManager } from '@/src/components/calls/IncomingCallWatcher';
import { useCopy } from '@/src/context/LanguageContext';
import type { RemoteParticipant } from '@/src/lib/calls/callStore';

// ── Local video component ─────────────────────────────────────────────────────

/**
 * Attaches a MediaStream to a <video> element via a ref callback.
 * srcObject cannot be set as a JSX prop in React — we use useEffect instead.
 */
function LocalVideo({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked before user gesture — silently ignore.
      });
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  if (!stream) {
    return (
      <Box
        w="100%"
        h="100%"
        bg="gray.700"
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderRadius="md"
        data-testid="local-video-avatar"
      >
        <Text fontSize="4xl">📷</Text>
      </Box>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }}
      data-testid="local-video"
    />
  );
}

// ── Remote video component ────────────────────────────────────────────────────

function RemoteVideo({
  participant,
}: {
  participant: RemoteParticipant;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked — silently ignore.
      });
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [participant.stream]);

  const hasVideo = participant.stream !== null && !participant.videoOff;

  if (!hasVideo) {
    // Show avatar fallback: initials derived from pubkey
    const initial = participant.pubkey.slice(0, 1).toUpperCase();
    return (
      <Box
        w="100%"
        h="100%"
        bg="gray.600"
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderRadius="md"
        position="relative"
        data-testid={`remote-avatar-${participant.pubkey.slice(0, 8)}`}
      >
        <Text fontSize="5xl" color="white" fontWeight="bold">
          {initial}
        </Text>
        {participant.muted && (
          <Box
            position="absolute"
            bottom={2}
            right={2}
            bg="blackAlpha.700"
            borderRadius="full"
            px={2}
            py={1}
          >
            <Text fontSize="xs" color="white">🔇</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box position="relative" w="100%" h="100%">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }}
        data-testid={`remote-video-${participant.pubkey.slice(0, 8)}`}
      />
      {participant.muted && (
        <Box
          position="absolute"
          bottom={2}
          right={2}
          bg="blackAlpha.700"
          borderRadius="full"
          px={2}
          py={1}
        >
          <Text fontSize="xs" color="white">🔇</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * CallScreen — full-screen in-call overlay.
 *
 * Renders when callStore.active !== null. Unmounts automatically when
 * callManager.hangup() clears callStore.active.
 */
export function CallScreen() {
  const { active } = useCallStore();
  const copy = useCopy();

  // Local UI state for media controls (snappy toggles before manager responds)
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Detect PiP support at mount (browser-only check, safe for SSR)
  useEffect(() => {
    setPipSupported(
      typeof document !== 'undefined' && !!document.pictureInPictureEnabled,
    );
  }, []);

  // Reset mute/camera state when a new call starts
  useEffect(() => {
    if (active) {
      setIsMuted(false);
      setIsCameraOff(false);
    }
  }, [active?.callId]);

  // Attach local stream to local video element
  useEffect(() => {
    if (localVideoRef.current && active?.localStream) {
      localVideoRef.current.srcObject = active.localStream;
      localVideoRef.current.play().catch(() => {
        // Autoplay may be blocked — silently ignore.
      });
    }
    return () => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
    };
  }, [active?.localStream]);

  // Not visible when no active call
  if (!active) return null;

  const participantCount = active.participants.length + 1; // +1 for local user

  // ── Event handlers ──────────────────────────────────────────────────────────

  function handleToggleMute() {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    getCallManager()?.setMuted(newMuted);
  }

  function handleToggleCamera() {
    const newCameraOff = !isCameraOff;
    setIsCameraOff(newCameraOff);
    getCallManager()?.setVideoEnabled(!newCameraOff);
  }

  function handleHangUp() {
    void getCallManager()?.hangup();
  }

  async function handlePiP() {
    if (!localVideoRef.current) return;
    try {
      await localVideoRef.current.requestPictureInPicture();
    } catch {
      // PiP may be unavailable due to permissions or user gesture requirements
    }
  }

  // ── Video grid layout ───────────────────────────────────────────────────────
  //
  // Single participant (1 remote + local): 2-column grid.
  // 2–4 remote participants: 2×2 grid with local in corner.
  // Local tile is always the last cell (bottom-right).

  const totalTiles = active.participants.length + 1; // remote tiles + local
  const gridColumns = totalTiles <= 2 ? 2 : 3;

  return (
    <Box
      position="fixed"
      top={0}
      left={0}
      right={0}
      bottom={0}
      bg="gray.900"
      zIndex={1400}
      display="flex"
      flexDirection="column"
      data-testid="call-screen"
    >
      {/* Status bar */}
      <HStack
        px={4}
        py={2}
        justify="space-between"
        bg="blackAlpha.400"
        data-testid="call-status-bar"
      >
        <Text color="green.300" fontSize="sm" fontWeight="semibold">
          {copy.calls.callConnected}
        </Text>
        <Text color="gray.300" fontSize="sm" data-testid="participant-count-label">
          {copy.calls.participants(participantCount)}
        </Text>
      </HStack>

      {/* Video/Avatar grid */}
      <Box flex={1} p={3} overflow="hidden">
        <Grid
          templateColumns={`repeat(${gridColumns}, 1fr)`}
          gap={3}
          h="100%"
          data-testid="video-grid"
        >
          {/* Remote participant tiles */}
          {active.participants.map((participant) => (
            <GridItem key={participant.pubkey} minH={0}>
              <Box h="100%" minH="120px">
                <RemoteVideo participant={participant} />
              </Box>
            </GridItem>
          ))}

          {/* Local tile (always last) */}
          <GridItem minH={0} data-testid="local-tile">
            <Box h="100%" minH="120px" position="relative">
              {active.localStream ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    transform: 'scaleX(-1)', // mirror local preview
                  }}
                  data-testid="local-video"
                />
              ) : (
                <Box
                  w="100%"
                  h="100%"
                  bg="gray.700"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  borderRadius="md"
                  data-testid="local-video-avatar"
                >
                  <Text fontSize="4xl">🙂</Text>
                </Box>
              )}
              {isMuted && (
                <Box
                  position="absolute"
                  bottom={2}
                  left={2}
                  bg="blackAlpha.700"
                  borderRadius="full"
                  px={2}
                  py={1}
                >
                  <Text fontSize="xs" color="white">🔇</Text>
                </Box>
              )}
            </Box>
          </GridItem>
        </Grid>
      </Box>

      {/* Participant list */}
      {active.participants.length > 0 && (
        <Box
          px={4}
          py={2}
          bg="blackAlpha.400"
          data-testid="participant-list"
        >
          <HStack spacing={3} wrap="wrap">
            {active.participants.map((p) => (
              <HStack key={p.pubkey} spacing={1}>
                <Text color="gray.200" fontSize="xs" data-testid={`participant-name-${p.pubkey.slice(0, 8)}`}>
                  {p.pubkey.slice(0, 8)}…
                </Text>
                {p.muted && <Text fontSize="xs">🔇</Text>}
                {p.videoOff && <Text fontSize="xs">📵</Text>}
              </HStack>
            ))}
          </HStack>
        </Box>
      )}

      {/* Controls bar */}
      <Flex
        justify="center"
        align="center"
        py={5}
        gap={4}
        bg="blackAlpha.600"
        data-testid="call-controls"
      >
        {/* Mute / Unmute */}
        <Tooltip label={isMuted ? copy.calls.unmuteAudio : copy.calls.muteAudio}>
          <IconButton
            aria-label={isMuted ? copy.calls.unmuteAudio : copy.calls.muteAudio}
            icon={<Text fontSize="xl">{isMuted ? '🔇' : '🎙️'}</Text>}
            onClick={handleToggleMute}
            colorScheme={isMuted ? 'red' : 'whiteAlpha'}
            variant="solid"
            size="lg"
            borderRadius="full"
            data-testid="mute-btn"
          />
        </Tooltip>

        {/* Camera toggle — hidden for voice calls */}
        {active.callType === 'video' && (
          <Tooltip label={isCameraOff ? copy.calls.cameraOn : copy.calls.cameraOff}>
            <IconButton
              aria-label={isCameraOff ? copy.calls.cameraOn : copy.calls.cameraOff}
              icon={<Text fontSize="xl">{isCameraOff ? '📵' : '📷'}</Text>}
              onClick={handleToggleCamera}
              colorScheme={isCameraOff ? 'red' : 'whiteAlpha'}
              variant="solid"
              size="lg"
              borderRadius="full"
              data-testid="camera-btn"
            />
          </Tooltip>
        )}

        {/* Hang Up */}
        <Tooltip label={copy.calls.hangUp}>
          <IconButton
            aria-label={copy.calls.hangUp}
            icon={<Text fontSize="xl">📵</Text>}
            onClick={handleHangUp}
            colorScheme="red"
            variant="solid"
            size="lg"
            borderRadius="full"
            data-testid="hangup-btn"
          />
        </Tooltip>

        {/* Picture-in-Picture (optional, browser-gated) */}
        {pipSupported && active.localStream && (
          <Tooltip label="Picture in Picture">
            <IconButton
              aria-label="Picture in Picture"
              icon={<Text fontSize="xl">⧉</Text>}
              onClick={() => void handlePiP()}
              colorScheme="whiteAlpha"
              variant="solid"
              size="lg"
              borderRadius="full"
              data-testid="pip-btn"
            />
          </Tooltip>
        )}
      </Flex>
    </Box>
  );
}
