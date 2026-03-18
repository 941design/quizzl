import React from 'react';
import { Badge, Box, HStack, Image, Text, VStack, Wrap, WrapItem } from '@chakra-ui/react';
import type { UserProfile } from '@/src/types';
import { PROFILE_BADGES } from '@/src/config/profile';

type ProfileSummaryProps = {
  profile: UserProfile;
  fallbackName: string;
  size?: 'sm' | 'md';
  showBadges?: boolean;
};

export default function ProfileSummary({
  profile,
  fallbackName,
  size = 'md',
  showBadges = false,
}: ProfileSummaryProps) {
  const displayName = profile.nickname || fallbackName;
  const selectedBadges = PROFILE_BADGES.filter((badge) => profile.badgeIds.includes(badge.id));
  const avatarSize = size === 'sm' ? '40px' : '64px';
  const nameSize = size === 'sm' ? 'sm' : 'lg';

  return (
    <HStack spacing={size === 'sm' ? 3 : 4} align="center">
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
            alt={`${profile.avatar.subject} avatar`}
            w="100%"
            h="100%"
            objectFit="cover"
          />
        ) : (
          <Text fontWeight="bold" color="textMuted" fontSize={size === 'sm' ? 'sm' : 'lg'}>
            {displayName.slice(0, 1).toUpperCase()}
          </Text>
        )}
      </Box>

      <VStack align="start" spacing={showBadges ? 1 : 0}>
        <Box>
          <Text fontWeight="bold" fontSize={nameSize} data-testid="profile-display-name">
            {displayName}
          </Text>
          {profile.avatar && (
            <Text fontSize="xs" color="textMuted" textTransform="capitalize">
              {profile.avatar.subject}
            </Text>
          )}
        </Box>

        {showBadges && selectedBadges.length > 0 && (
          <Wrap spacing={2}>
            {selectedBadges.map((badge) => (
              <WrapItem key={badge.id}>
                <Badge colorScheme={badge.colorScheme}>{badge.label}</Badge>
              </WrapItem>
            ))}
          </Wrap>
        )}
      </VStack>
    </HStack>
  );
}
