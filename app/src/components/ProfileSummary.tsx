import React from 'react';
import {
  Box,
  HStack,
  Image,
  Text,
  VStack,
  usePrefersReducedMotion,
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import type { UserProfile } from '@/src/types';

const attentionPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

type ProfileSummaryProps = {
  profile: UserProfile;
  fallbackName: string;
  size?: 'sm' | 'md';
  /**
   * When true, this summary represents the signed-in user who has not yet set a
   * display name. Renders a neutral avatar and a slowly pulsing call-to-action
   * (using `fallbackName`) to draw attention to setting the profile name. The
   * npub is never shown in this state — it is meaningless to a fresh user.
   */
  promptForName?: boolean;
};

export default function ProfileSummary({
  profile,
  fallbackName,
  size = 'md',
  promptForName = false,
}: ProfileSummaryProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const hasName = Boolean(profile.nickname);
  const isPlaceholder = promptForName && !hasName;
  const displayName = profile.nickname || fallbackName;
  const avatarSize = size === 'sm' ? '44px' : '64px';
  const nameSize = size === 'sm' ? 'sm' : 'lg';
  const pulseAnimation =
    isPlaceholder && !prefersReducedMotion
      ? `${attentionPulse} 2.2s ease-in-out infinite`
      : undefined;

  return (
    <HStack spacing={size === 'sm' ? 2 : 4} align="center" animation={pulseAnimation}>
      <Box
        w={avatarSize}
        h={avatarSize}
        borderRadius="full"
        overflow="hidden"
        bg="surfaceMutedBg"
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderWidth="1px"
        borderColor="borderSubtle"
        flexShrink={0}
        data-testid="profile-avatar-thumb"
      >
        {profile.avatar ? (
          <Image
            src={profile.avatar.imageUrl}
            alt="Profile avatar"
            w="100%"
            h="100%"
            objectFit="cover"
          />
        ) : (
          <Text fontWeight="bold" color="textMuted" fontSize={size === 'sm' ? 'sm' : 'lg'}>
            {isPlaceholder ? '?' : displayName.slice(0, 1).toUpperCase()}
          </Text>
        )}
      </Box>

      <VStack align="start" spacing={0}>
        <Box>
          <Text
            fontWeight="bold"
            fontSize={nameSize}
            color={isPlaceholder ? 'textMuted' : undefined}
            data-placeholder={isPlaceholder ? 'true' : undefined}
            data-testid="profile-display-name"
          >
            {displayName}
          </Text>
        </Box>
      </VStack>
    </HStack>
  );
}
