import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Image,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  SimpleGrid,
  Text,
  VStack,
  Wrap,
  WrapItem,
} from '@chakra-ui/react';
import avatarManifest from '@/src/data/avatarManifest.json';
import { AVATAR_BROWSER_CONFIG } from '@/src/config/profile';
import type { ProfileAvatar } from '@/src/types';
import { useCopy, useLanguage } from '@/src/context/LanguageContext';

type AvatarBrowserModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (avatar: ProfileAvatar) => void;
  initialAvatar: ProfileAvatar | null;
};

/**
 * Catalog item shape from avatarManifest.json. `subject`/`accessories` exist
 * only to power the browse filters here — they are not persisted on the
 * selected {@link ProfileAvatar}, which carries just `imageUrl`.
 */
type AvatarCatalogItem = {
  id: string;
  imageUrl: string;
  subject: string;
  accessories: string[];
  sortOrder: number;
};

type AvatarManifest = {
  subjects: string[];
  accessories: string[];
  items: AvatarCatalogItem[];
};

const manifest = avatarManifest as AvatarManifest;

export default function AvatarBrowserModal({
  isOpen,
  onClose,
  onSelect,
  initialAvatar,
}: AvatarBrowserModalProps) {
  const copy = useCopy();
  const { language } = useLanguage();
  const [selectedSubject, setSelectedSubject] = useState<string>(AVATAR_BROWSER_CONFIG.defaultSubject);

  // Fruit labels are ordered alphabetically by their *localized* name, so the
  // list re-sorts when the language changes (e.g. "Apple" vs "Ananas").
  const sortedSubjects = useMemo(() => {
    const label = (subject: string) => copy.settings.fruitNames[subject] ?? subject;
    return [...manifest.subjects].sort((left, right) =>
      label(left).localeCompare(label(right), language)
    );
  }, [copy, language]);
  const [visibleCount, setVisibleCount] = useState<number>(AVATAR_BROWSER_CONFIG.resultPageSize);

  useEffect(() => {
    if (!isOpen) return;

    setSelectedSubject(AVATAR_BROWSER_CONFIG.defaultSubject);
    setVisibleCount(AVATAR_BROWSER_CONFIG.resultPageSize);
  }, [isOpen]);

  const matchingAvatars = useMemo(() => {
    const filtered = manifest.items.filter((item) => item.subject === selectedSubject);

    return filtered.sort((left, right) => left.sortOrder - right.sortOrder);
  }, [selectedSubject]);

  const visibleAvatars = matchingAvatars.slice(0, visibleCount);

  function selectSubject(subject: string) {
    setSelectedSubject(subject);
    setVisibleCount(AVATAR_BROWSER_CONFIG.resultPageSize);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent data-testid="avatar-browser-modal">
        <ModalHeader>{copy.settings.avatarModalTitle}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={6} align="stretch">
            {/* Single-select fruit filter (radio behaviour): exactly one fruit is
                active at a time, and clicking a label swaps the active fruit. */}
            <Wrap spacing={2}>
              {sortedSubjects.map((subject) => (
                <WrapItem key={subject}>
                  <Button
                    size="sm"
                    variant={selectedSubject === subject ? 'solid' : 'outline'}
                    onClick={() => selectSubject(subject)}
                  >
                    {copy.settings.fruitNames[subject] ?? subject}
                  </Button>
                </WrapItem>
              ))}
            </Wrap>

            <Box
              p={4}
              borderWidth="1px"
              borderRadius="lg"
              borderColor="borderSubtle"
              bg="surfaceMutedBg"
            >
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
                        borderColor={
                          initialAvatar?.imageUrl === avatar.imageUrl ? 'brand.500' : 'borderSubtle'
                        }
                        cursor="pointer"
                        _hover={{ borderColor: 'brand.400' }}
                        onClick={() => onSelect({ imageUrl: avatar.imageUrl })}
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
      </ModalContent>
    </Modal>
  );
}
