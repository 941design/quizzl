import React, { useState } from 'react';
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Button,
  Divider,
  Badge,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  Alert,
  AlertIcon,
  AlertDescription,
} from '@chakra-ui/react';
import Head from 'next/head';
import { useMoodTheme } from '@/src/hooks/useMoodTheme';
import { resetAllData } from '@/src/lib/storage';

export default function SettingsPage() {
  const { mood, setTheme } = useMoodTheme();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [resetDone, setResetDone] = useState(false);

  function handleReset() {
    resetAllData();
    setResetDone(true);
    onClose();
  }

  return (
    <>
      <Head>
        <title>Settings - GroupLearn</title>
      </Head>
      <Box data-testid="settings-page">
        <Heading as="h1" size="xl" mb={2}>
          Settings
        </Heading>
        <Text color="gray.600" mb={6}>
          Customize your learning experience.
        </Text>

        {resetDone && (
          <Alert status="success" borderRadius="md" mb={6} data-testid="reset-success-banner">
            <AlertIcon />
            <AlertDescription>All data has been reset. Start fresh!</AlertDescription>
          </Alert>
        )}

        <VStack spacing={6} align="stretch">
          {/* Mood Theme Section */}
          <Box>
            <Heading as="h2" size="md" mb={1}>
              Mood Theme
            </Heading>
            <Text fontSize="sm" color="gray.500" mb={4}>
              Choose a visual style that matches your study mood.
            </Text>

            <HStack spacing={4} flexWrap="wrap">
              <Button
                variant={mood === 'calm' ? 'solid' : 'outline'}
                colorScheme="teal"
                onClick={() => setTheme('calm')}
                data-testid="theme-calm-btn"
                size="lg"
                leftIcon={mood === 'calm' ? <span>✓</span> : undefined}
              >
                Calm
                {mood === 'calm' && (
                  <Badge colorScheme="teal" ml={2} fontSize="xs">
                    Active
                  </Badge>
                )}
              </Button>

              <Button
                variant={mood === 'playful' ? 'solid' : 'outline'}
                colorScheme="orange"
                onClick={() => setTheme('playful')}
                data-testid="theme-playful-btn"
                size="lg"
                leftIcon={mood === 'playful' ? <span>✓</span> : undefined}
              >
                Playful
                {mood === 'playful' && (
                  <Badge colorScheme="orange" ml={2} fontSize="xs">
                    Active
                  </Badge>
                )}
              </Button>
            </HStack>

            <Box mt={4} p={3} borderRadius="md" bg="gray.50" data-testid="theme-preview">
              <Text fontSize="sm" color="gray.600">
                Current theme:{' '}
                <Text as="span" fontWeight="semibold" textTransform="capitalize">
                  {mood}
                </Text>
              </Text>
              <Text fontSize="xs" color="gray.400" mt={1}>
                {mood === 'calm'
                  ? 'Muted blues and greens, minimal animations.'
                  : 'Warm oranges and purples, rounded corners.'}
              </Text>
            </Box>
          </Box>

          <Divider />

          {/* Reset Section */}
          <Box>
            <Heading as="h2" size="md" mb={1}>
              Reset All Data
            </Heading>
            <Text fontSize="sm" color="gray.500" mb={4}>
              Clear all your progress, notes, study sessions, and settings. This cannot be undone.
            </Text>

            <Button
              colorScheme="red"
              variant="outline"
              onClick={onOpen}
              data-testid="reset-data-btn"
            >
              Reset All Data
            </Button>
          </Box>
        </VStack>
      </Box>

      {/* Reset Confirmation Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered data-testid="reset-modal">
        <ModalOverlay />
        <ModalContent data-testid="reset-modal-content">
          <ModalHeader>Reset All Data?</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              This will permanently delete all your quiz answers, notes, study sessions, and
              settings. This action cannot be undone.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose} data-testid="reset-cancel-btn">
              Cancel
            </Button>
            <Button colorScheme="red" onClick={handleReset} data-testid="reset-confirm-btn">
              Yes, Reset Everything
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
