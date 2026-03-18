import React from 'react';
import {
  Box,
  Heading,
  Text,
  VStack,
  Button,
  Alert,
  AlertIcon,
  AlertDescription,
  useDisclosure,
} from '@chakra-ui/react';
import Head from 'next/head';
import { useCopy } from '@/src/context/LanguageContext';
import { useMarmot } from '@/src/context/MarmotContext';
import { useNostrIdentity } from '@/src/context/NostrIdentityContext';
import GroupCard from '@/src/components/groups/GroupCard';
import CreateGroupModal from '@/src/components/groups/CreateGroupModal';
import BackupReminderBanner from '@/src/components/groups/BackupReminderBanner';
import OfflineBanner from '@/src/components/groups/OfflineBanner';

export default function GroupsPage() {
  const copy = useCopy();
  const { groups, ready } = useMarmot();
  const { backedUp } = useNostrIdentity();
  const createDisclosure = useDisclosure();

  return (
    <>
      <Head>
        <title>{`${copy.groups.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="groups-page">
        {/* Offline indicator */}
        <OfflineBanner />

        {/* Backup reminder: only when user is in groups and hasn't backed up */}
        {ready && groups.length > 0 && !backedUp && (
          <BackupReminderBanner />
        )}

        <Box mb={6}>
          <Heading as="h1" size="xl" mb={2}>
            {copy.groups.heading}
          </Heading>
          <Text color="textMuted" mb={4}>
            {copy.groups.description}
          </Text>

          <Button onClick={createDisclosure.onOpen} data-testid="create-group-btn">
            {copy.groups.createGroup}
          </Button>
        </Box>

        {!ready && (
          <Box py={8} textAlign="center" color="textMuted">
            <Text>{copy.groups.loading}</Text>
          </Box>
        )}

        {ready && groups.length === 0 && (
          <Alert
            status="info"
            borderRadius="md"
            flexDirection="column"
            alignItems="flex-start"
            gap={2}
            data-testid="groups-empty-state"
          >
            <AlertIcon />
            <Box>
              <Text fontWeight="semibold">{copy.groups.noGroups}</Text>
              <AlertDescription>
                <Text>{copy.groups.noGroupsBody}</Text>
              </AlertDescription>
            </Box>
          </Alert>
        )}

        {ready && groups.length > 0 && (
          <VStack spacing={3} align="stretch" data-testid="groups-list">
            {groups.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
          </VStack>
        )}
      </Box>

      <CreateGroupModal
        isOpen={createDisclosure.isOpen}
        onClose={createDisclosure.onClose}
      />
    </>
  );
}
