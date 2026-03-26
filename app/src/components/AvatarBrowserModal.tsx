import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  HStack,
  Image,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Text,
  VStack,
  Wrap,
  WrapItem,
} from '@chakra-ui/react';
import avatarManifest from '@/src/data/avatarManifest.json';
import { AVATAR_BROWSER_CONFIG } from '@/src/config/profile';
import type { ProfileAvatar } from '@/src/types';
import { useCopy } from '@/src/context/LanguageContext';

type AvatarBrowserModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (avatar: ProfileAvatar) => void;
  initialAvatar: ProfileAvatar | null;
};

type AvatarManifest = {
  subjects: string[];
  accessories: string[];
  items: Array<ProfileAvatar & { sortOrder: number }>;
};

const manifest = avatarManifest as AvatarManifest;

export default function AvatarBrowserModal({
  isOpen,
  onClose,
  onSelect,
  initialAvatar,
}: AvatarBrowserModalProps) {
  const copy = useCopy();
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState<number>(AVATAR_BROWSER_CONFIG.resultPageSize);

  useEffect(() => {
    if (!isOpen) return;

    setSelectedSubject(initialAvatar?.subject ?? AVATAR_BROWSER_CONFIG.defaultSubjects[0] ?? '');
    setSelectedAccessories(initialAvatar?.accessories ?? []);
    setVisibleCount(AVATAR_BROWSER_CONFIG.resultPageSize);
  }, [initialAvatar, isOpen]);

  const matchingAvatars = useMemo(() => {
    const filtered = manifest.items.filter((item) => {
      if (selectedSubject && item.subject !== selectedSubject) {
        return false;
      }

      if (selectedAccessories.length === 0) {
        return true;
      }

      return selectedAccessories.some((accessory) => item.accessories.includes(accessory));
    });

    return filtered.sort((left, right) => left.sortOrder - right.sortOrder);
  }, [selectedAccessories, selectedSubject]);

  const visibleAvatars = matchingAvatars.slice(0, visibleCount);

  function toggleAccessory(accessory: string) {
    setVisibleCount(AVATAR_BROWSER_CONFIG.resultPageSize);
    setSelectedAccessories((current) =>
      current.includes(accessory)
        ? current.filter((item) => item !== accessory)
        : [...current, accessory]
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent data-testid="avatar-browser-modal">
        <ModalHeader>{copy.settings.avatarModalTitle}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={6} align="stretch">
            <Text color="textMuted">{copy.settings.avatarModalDescription}</Text>

            <Box>
              <Text fontWeight="semibold" mb={2}>
                {copy.settings.avatarSubjectLabel}
              </Text>
              <HStack spacing={2} flexWrap="wrap" mb={3}>
                {AVATAR_BROWSER_CONFIG.defaultSubjects.map((subject) => (
                  <Button
                    key={subject}
                    size="sm"
                    variant={selectedSubject === subject ? 'solid' : 'outline'}
                    onClick={() => {
                      setSelectedSubject(subject);
                      setVisibleCount(AVATAR_BROWSER_CONFIG.resultPageSize);
                    }}
                  >
                    {subject}
                  </Button>
                ))}
              </HStack>
              <Select
                value={selectedSubject}
                onChange={(event) => {
                  setSelectedSubject(event.target.value);
                  setVisibleCount(AVATAR_BROWSER_CONFIG.resultPageSize);
                }}
                bg="surfaceBg"
              >
                {manifest.subjects.map((subject) => (
                  <option key={subject} value={subject}>
                    {subject}
                  </option>
                ))}
              </Select>
            </Box>

            <Box>
              <HStack justify="space-between" align="baseline" mb={2}>
                <Text fontWeight="semibold">{copy.settings.avatarAccessoryLabel}</Text>
                {selectedAccessories.length > 0 && (
                  <Button size="xs" variant="ghost" onClick={() => setSelectedAccessories([])}>
                    {copy.settings.clearFilters}
                  </Button>
                )}
              </HStack>
              <Wrap spacing={2}>
                {manifest.accessories.map((accessory) => {
                  const isActive = selectedAccessories.includes(accessory);
                  return (
                    <WrapItem key={accessory}>
                      <Button
                        size="sm"
                        variant={isActive ? 'solid' : 'outline'}
                        onClick={() => toggleAccessory(accessory)}
                      >
                        {accessory}
                      </Button>
                    </WrapItem>
                  );
                })}
              </Wrap>
            </Box>

            <Box
              p={4}
              borderWidth="1px"
              borderRadius="lg"
              borderColor="borderSubtle"
              bg="surfaceMutedBg"
            >
              <HStack justify="space-between" align="center" mb={4}>
                <Text fontWeight="semibold">
                  {copy.settings.avatarResults(matchingAvatars.length)}
                </Text>
                <Badge>{selectedSubject}</Badge>
              </HStack>

              {visibleAvatars.length === 0 ? (
                <Text color="textMuted">{copy.settings.avatarNoResults}</Text>
              ) : (
                <VStack spacing={4} align="stretch">
                  <SimpleGrid columns={{ base: 2, md: 3, xl: 6 }} spacing={4}>
                    {visibleAvatars.map((avatar) => (
                      <Box
                        key={avatar.id}
                        borderWidth="1px"
                        borderRadius="xl"
                        overflow="hidden"
                        bg="surfaceBg"
                        borderColor={initialAvatar?.id === avatar.id ? 'brand.500' : 'borderSubtle'}
                        cursor="pointer"
                        _hover={{ borderColor: 'brand.400' }}
                        onClick={() => onSelect(avatar)}
                        data-testid={`avatar-card-${avatar.id}`}
                      >
                        <Box p={3}>
                          <Image
                            src={avatar.imageUrl}
                            alt={copy.settings.avatarOptionAlt}
                            w="100%"
                            aspectRatio={1}
                            objectFit="contain"
                            bg="white"
                            borderRadius="lg"
                            loading="lazy"
                          />
                        </Box>
                        <VStack align="stretch" spacing={3} p={3} pt={0}>
                          <Text fontSize="xs" color="textMuted" noOfLines={2}>
                            {avatar.accessories.length > 0
                              ? avatar.accessories.join(', ')
                              : copy.settings.avatarNoAccessories}
                          </Text>
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(avatar);
                            }}
                            data-testid={`select-avatar-${avatar.id}`}
                          >
                            {copy.settings.useThisAvatar}
                          </Button>
                        </VStack>
                      </Box>
                    ))}
                  </SimpleGrid>

                  {matchingAvatars.length > visibleAvatars.length && (
                    <Button
                      alignSelf="center"
                      variant="outline"
                      onClick={() =>
                        setVisibleCount((current) => current + AVATAR_BROWSER_CONFIG.resultPageSize)
                      }
                    >
                      {copy.settings.showMoreAvatars}
                    </Button>
                  )}
                </VStack>
              )}
            </Box>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            {copy.settings.cancel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
