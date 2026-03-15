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
import { useCopy, useLanguage } from '@/src/context/LanguageContext';
import { useMoodTheme } from '@/src/hooks/useMoodTheme';
import { resetAllData } from '@/src/lib/storage';

export default function SettingsPage() {
  const { language, setLanguage } = useLanguage();
  const copy = useCopy();
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
        <title>{`${copy.settings.pageTitle} - ${copy.appName}`}</title>
      </Head>
      <Box data-testid="settings-page">
        <Heading as="h1" size="xl" mb={2}>
          {copy.settings.heading}
        </Heading>
        <Text color="gray.600" mb={6}>
          {copy.settings.description}
        </Text>

        {resetDone && (
          <Alert status="success" borderRadius="md" mb={6} data-testid="reset-success-banner">
            <AlertIcon />
            <AlertDescription>{copy.settings.resetSuccess}</AlertDescription>
          </Alert>
        )}

        <VStack spacing={6} align="stretch">
          <Box>
            <Heading as="h2" size="md" mb={1}>
              {copy.settings.languageHeading}
            </Heading>
            <Text fontSize="sm" color="gray.500" mb={4}>
              {copy.settings.languageDescription}
            </Text>

            <HStack spacing={4} flexWrap="wrap">
              {(['en', 'de'] as const).map((option) => (
                <Button
                  key={option}
                  variant={language === option ? 'solid' : 'outline'}
                  colorScheme="teal"
                  onClick={() => setLanguage(option)}
                  size="lg"
                >
                  {copy.languageNames[option]}
                  {language === option && (
                    <Badge colorScheme="teal" ml={2} fontSize="xs">
                      {copy.settings.active}
                    </Badge>
                  )}
                </Button>
              ))}
            </HStack>
          </Box>

          <Divider />

          {/* Mood Theme Section */}
          <Box>
            <Heading as="h2" size="md" mb={1}>
              {copy.settings.moodHeading}
            </Heading>
            <Text fontSize="sm" color="gray.500" mb={4}>
              {copy.settings.moodDescription}
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
                {copy.settings.calm}
                {mood === 'calm' && (
                  <Badge colorScheme="teal" ml={2} fontSize="xs">
                    {copy.settings.active}
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
                {copy.settings.playful}
                {mood === 'playful' && (
                  <Badge colorScheme="orange" ml={2} fontSize="xs">
                    {copy.settings.active}
                  </Badge>
                )}
              </Button>
            </HStack>

            <Box mt={4} p={3} borderRadius="md" bg="gray.50" data-testid="theme-preview">
              <Text fontSize="sm" color="gray.600">
                {copy.settings.currentTheme}:{' '}
                <Text as="span" fontWeight="semibold" textTransform="capitalize">
                  {mood === 'calm' ? copy.settings.calm : copy.settings.playful}
                </Text>
              </Text>
              <Text fontSize="xs" color="gray.400" mt={1}>
                {mood === 'calm'
                  ? copy.settings.calmDescription
                  : copy.settings.playfulDescription}
              </Text>
            </Box>
          </Box>

          <Divider />

          {/* Reset Section */}
          <Box>
            <Heading as="h2" size="md" mb={1}>
              {copy.settings.resetHeading}
            </Heading>
            <Text fontSize="sm" color="gray.500" mb={4}>
              {copy.settings.resetDescription}
            </Text>

            <Button
              colorScheme="red"
              variant="outline"
              onClick={onOpen}
              data-testid="reset-data-btn"
            >
              {copy.settings.resetButton}
            </Button>
          </Box>
        </VStack>
      </Box>

      {/* Reset Confirmation Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered data-testid="reset-modal">
        <ModalOverlay />
        <ModalContent data-testid="reset-modal-content">
          <ModalHeader>{copy.settings.resetModalTitle}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              {copy.settings.resetModalBody}
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose} data-testid="reset-cancel-btn">
              {copy.settings.cancel}
            </Button>
            <Button colorScheme="red" onClick={handleReset} data-testid="reset-confirm-btn">
              {copy.settings.confirmReset}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
