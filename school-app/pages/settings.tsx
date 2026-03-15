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
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import { resetAllData } from '@/src/lib/storage';
import { APP_THEMES } from '@/src/lib/theme';

export default function SettingsPage() {
  const { language, setLanguage } = useLanguage();
  const copy = useCopy();
  const { themeName, setTheme, activeThemeDefinition } = useAppTheme();
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
        <Text color="textMuted" mb={6}>
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
            <Text fontSize="sm" color="textMuted" mb={4}>
              {copy.settings.languageDescription}
            </Text>

            <HStack spacing={4} flexWrap="wrap">
              {(['en', 'de'] as const).map((option) => (
                <Button
                  key={option}
                  variant={language === option ? 'solid' : 'outline'}
                  onClick={() => setLanguage(option)}
                  size="lg"
                >
                  {copy.languageNames[option]}
                  {language === option && (
                    <Badge ml={2} fontSize="xs">
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
              {copy.settings.themeHeading}
            </Heading>
            <Text fontSize="sm" color="textMuted" mb={4}>
              {copy.settings.themeDescription}
            </Text>

            <HStack spacing={4} flexWrap="wrap">
              {Object.values(APP_THEMES).map((themeOption) => {
                const isActive = themeName === themeOption.id;

                return (
                  <Button
                    key={themeOption.id}
                    variant={isActive ? 'solid' : 'outline'}
                    colorScheme={themeOption.previewColorScheme}
                    onClick={() => setTheme(themeOption.id)}
                    data-testid={`theme-${themeOption.id}-btn`}
                    size="lg"
                    leftIcon={isActive ? <span>✓</span> : undefined}
                  >
                    {copy.settings[themeOption.labelKey]}
                    {isActive && (
                      <Badge colorScheme={themeOption.previewColorScheme} ml={2} fontSize="xs">
                        {copy.settings.active}
                      </Badge>
                    )}
                  </Button>
                );
              })}
            </HStack>

            <Box
              mt={4}
              p={3}
              borderRadius="md"
              bg="surfaceMutedBg"
              borderWidth="1px"
              borderColor="borderSubtle"
              backgroundImage={activeThemeDefinition.backgroundImage}
              backgroundSize={activeThemeDefinition.backgroundImage ? '120px 120px' : undefined}
              data-testid="theme-preview"
            >
              <Text fontSize="sm" color="textMuted">
                {copy.settings.currentTheme}:{' '}
                <Text as="span" fontWeight="semibold" textTransform="capitalize">
                  {copy.settings[activeThemeDefinition.labelKey]}
                </Text>
              </Text>
              <Text fontSize="xs" color="textMuted" mt={1}>
                {copy.settings[activeThemeDefinition.descriptionKey]}
              </Text>
            </Box>
          </Box>

          <Divider />

          {/* Reset Section */}
          <Box>
            <Heading as="h2" size="md" mb={1}>
              {copy.settings.resetHeading}
            </Heading>
            <Text fontSize="sm" color="textMuted" mb={4}>
              {copy.settings.resetDescription}
            </Text>

            <Button
              colorScheme="danger"
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
            <Button colorScheme="danger" onClick={handleReset} data-testid="reset-confirm-btn">
              {copy.settings.confirmReset}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
