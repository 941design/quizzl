// app/src/components/WelcomeInvite.tsx
//
// Shared, PURE presentation component for the first-visit invite welcome
// (epic first-visit-invite-welcome, story S2). Renders the HeroAccents
// backdrop, an optional invite line, the "Just chat." pitch (reused from
// copy.home.*), a name input, and a single primary action button.
//
// This component does NOT know whether it is being used for a contact-card
// invite or a group invite — that distinction lives entirely in the props
// (inviteLine / primaryActionLabel / onPrimaryAction) supplied by the caller
// (S3 for /add, S4 for /groups?join=...). No transport, decode, or
// persistence imports here — presentation only.
import { Box, Heading, Input, Text, UnorderedList, ListItem, VStack, Button } from '@chakra-ui/react';
import { useCopy } from '@/src/context/LanguageContext';
import HeroAccents from '@/src/components/HeroAccents';

export type WelcomeInviteProps = {
  /** Invite-line text already computed by the caller. null renders NO invite line at all (not an empty string, not a fallback) — the pitch, name input, and action still render. */
  inviteLine: string | null;
  nameValue: string;
  onNameChange: (value: string) => void;
  primaryActionLabel: string;
  primaryActionDisabled: boolean;
  onPrimaryAction: () => void;
  /** Optional busy indicator on the primary action button; defaults to false. */
  primaryActionLoading?: boolean;
};

export default function WelcomeInvite({
  inviteLine,
  nameValue,
  onNameChange,
  primaryActionLabel,
  primaryActionDisabled,
  onPrimaryAction,
  primaryActionLoading,
}: WelcomeInviteProps): JSX.Element {
  const copy = useCopy();

  return (
    <Box
      position="relative"
      overflow="hidden"
      borderRadius="2xl"
      px={{ base: 4, md: 8 }}
      data-testid="welcome-invite"
    >
      <HeroAccents />
      <VStack spacing={8} py={16} position="relative" zIndex={1}>
        {inviteLine !== null && (
          <Text textAlign="center" fontSize="lg" fontWeight="semibold" data-testid="welcome-invite-line">
            {inviteLine}
          </Text>
        )}

        <VStack spacing={3} maxW="600px">
          <Heading as="h2" size="lg" textAlign="center">
            {copy.home.subheadingLead}
          </Heading>
          <UnorderedList spacing={3}>
            {copy.home.subheadingPoints.map((point, i) => (
              <ListItem key={i} color="textMuted" fontSize="lg">
                {point}
              </ListItem>
            ))}
          </UnorderedList>
        </VStack>

        <VStack spacing={4} align="stretch" maxW="md" w="full">
          <Box>
            <Text fontWeight="semibold" mb={1}>
              {copy.welcome.nameLabel}
            </Text>
            <Input
              value={nameValue}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={copy.welcome.namePlaceholder}
              bg="surfaceBg"
              data-testid="welcome-name-input"
            />
          </Box>

          <Button
            onClick={onPrimaryAction}
            isDisabled={primaryActionDisabled}
            isLoading={primaryActionLoading ?? false}
            size="lg"
            data-testid="welcome-primary-action"
          >
            {primaryActionLabel}
          </Button>
        </VStack>
      </VStack>
    </Box>
  );
}
