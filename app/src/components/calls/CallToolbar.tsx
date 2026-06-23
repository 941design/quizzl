/**
 * CallToolbar.tsx — Voice/Video call entry point buttons (Story S8).
 *
 * Renders a pair of icon-labelled buttons (Voice Call, Video Call) for use
 * in both GroupChat and 1:1 ContactChat headers.
 *
 * Disable conditions:
 *   - callStore has an active or incoming call (user already in / ringing)
 *   - group call: group has 0 other members (nothing to call)
 *   - group call: group has >5 members total incl. self (5-cap §9 of callManager)
 *
 * Calling convention:
 *   getCallManager()?.startCall(…) is called at click time, not at render,
 *   following the same pattern as IncomingCallModal.tsx.
 */

import React from 'react';
import { HStack, IconButton, Tooltip } from '@chakra-ui/react';
import ThemeIcon from '@/src/components/ThemeIcon';
import { useCopy } from '@/src/context/LanguageContext';
import { useCallStore } from '@/src/lib/calls/callStore';
import { getCallManager } from '@/src/components/calls/IncomingCallWatcher';

/** Maximum participants in a call including self — mirrors callManager.ts constant. */
const MAX_CALL_PARTICIPANTS = 5;

// ── Group call toolbar ────────────────────────────────────────────────────────

export interface GroupCallToolbarProps {
  /** The MLS group id passed to CallManager.startCall(). */
  groupId: string;
  /**
   * Full member pubkey list for the group (including the local user).
   * Used to derive targetPubkeys (all members minus self) and to
   * enforce the 5-cap guard.
   */
  memberPubkeys: string[];
  /** Local user's pubkey — excluded from targetPubkeys. */
  ownPubkeyHex: string;
}

export function GroupCallToolbar({ groupId, memberPubkeys, ownPubkeyHex }: GroupCallToolbarProps) {
  const copy = useCopy();
  const callState = useCallStore();

  const targetPubkeys = memberPubkeys.filter((pk) => pk !== ownPubkeyHex);
  const totalParticipants = memberPubkeys.length; // includes self

  const callActive = callState.active !== null || callState.incoming !== null;
  const noOtherMembers = targetPubkeys.length === 0;
  // 5-cap: disable if total participants (incl. self) would exceed MAX_CALL_PARTICIPANTS.
  // memberPubkeys already includes self, so totalParticipants is the right number to check.
  const groupTooLarge = totalParticipants > MAX_CALL_PARTICIPANTS;

  const disabled = callActive || noOtherMembers || groupTooLarge;

  let tooltip: string;
  if (callActive) {
    tooltip = copy.calls.callInProgress;
  } else if (groupTooLarge) {
    tooltip = copy.calls.callDisabledGroupFull;
  } else {
    tooltip = '';
  }

  const handleVoice = () => {
    if (disabled) return;
    void getCallManager()?.startCall({
      callType: 'voice',
      groupId,
      targetPubkeys,
    });
  };

  const handleVideo = () => {
    if (disabled) return;
    void getCallManager()?.startCall({
      callType: 'video',
      groupId,
      targetPubkeys,
    });
  };

  return (
    <HStack spacing={1}>
      <Tooltip label={tooltip || copy.calls.startVoiceCall} placement="top">
        <IconButton
          aria-label={copy.calls.startVoiceCall}
          icon={<ThemeIcon name="phone" size={16} />}
          size="xs"
          variant="ghost"
          isDisabled={disabled}
          onClick={handleVoice}
          data-testid="group-voice-call-btn"
        />
      </Tooltip>
      <Tooltip label={tooltip || copy.calls.startVideoCall} placement="top">
        <IconButton
          aria-label={copy.calls.startVideoCall}
          icon={<ThemeIcon name="video" size={16} />}
          size="xs"
          variant="ghost"
          isDisabled={disabled}
          onClick={handleVideo}
          data-testid="group-video-call-btn"
        />
      </Tooltip>
    </HStack>
  );
}

// ── 1:1 contact call toolbar ──────────────────────────────────────────────────

export interface ContactCallToolbarProps {
  /** The contact's pubkey. Becomes the sole targetPubkeys entry. */
  peerPubkeyHex: string;
}

export function ContactCallToolbar({ peerPubkeyHex }: ContactCallToolbarProps) {
  const copy = useCopy();
  const callState = useCallStore();

  const callActive = callState.active !== null || callState.incoming !== null;
  const tooltip = callActive ? copy.calls.callInProgress : '';

  const handleVoice = () => {
    if (callActive) return;
    void getCallManager()?.startCall({
      callType: 'voice',
      groupId: null,
      targetPubkeys: [peerPubkeyHex],
    });
  };

  const handleVideo = () => {
    if (callActive) return;
    void getCallManager()?.startCall({
      callType: 'video',
      groupId: null,
      targetPubkeys: [peerPubkeyHex],
    });
  };

  return (
    <HStack spacing={1}>
      <Tooltip label={tooltip || copy.calls.startVoiceCall} placement="top">
        <IconButton
          aria-label={copy.calls.startVoiceCall}
          icon={<ThemeIcon name="phone" size={16} />}
          size="xs"
          variant="ghost"
          isDisabled={callActive}
          onClick={handleVoice}
          data-testid="contact-voice-call-btn"
        />
      </Tooltip>
      <Tooltip label={tooltip || copy.calls.startVideoCall} placement="top">
        <IconButton
          aria-label={copy.calls.startVideoCall}
          icon={<ThemeIcon name="video" size={16} />}
          size="xs"
          variant="ghost"
          isDisabled={callActive}
          onClick={handleVideo}
          data-testid="contact-video-call-btn"
        />
      </Tooltip>
    </HStack>
  );
}
