import React from 'react';
import {
  Box,
  Flex,
  HStack,
  VStack,
  Link,
  Text,
  Container,
  useDisclosure,
  Collapse,
  IconButton,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useRouter } from 'next/router';
import { useCopy } from '@/src/context/LanguageContext';
import ProfileSummary from '@/src/components/ProfileSummary';
import { useProfile } from '@/src/context/ProfileContext';
import StorageWarning from '@/src/components/StorageWarning';
import { useThemeStyles } from '@/src/hooks/useThemeStyles';
import ThemeIcon from '@/src/components/ThemeIcon';

type LayoutProps = {
  children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const { profile } = useProfile();
  const copy = useCopy();
  const { isOpen, onToggle } = useDisclosure();
  const { navStyle, surfaceStyle, bannerDecorStyle } = useThemeStyles();
  const navItems = [
    { label: copy.layout.nav.home, href: '/' },
    { label: copy.layout.nav.topics, href: '/topics' },
    { label: copy.layout.nav.leaderboard, href: '/leaderboard' },
    { label: copy.layout.nav.groups, href: '/groups' },
    { label: copy.layout.nav.studyTimes, href: '/study-times' },
  ];

  return (
    <Box minH="100vh" bg="appBg">
      {/* Navigation Bar */}
      <Box
        as="nav"
        bg="surfaceBg"
        borderBottomWidth="1px"
        borderBottomColor="borderSubtle"
        position="sticky"
        top={0}
        zIndex={10}
        aria-label="Main navigation"
        {...navStyle}
      >
        {bannerDecorStyle && (
          <Box
            data-testid="nav-banner-decor"
            {...bannerDecorStyle.boxProps}
            style={bannerDecorStyle.style}
          />
        )}
        <Container maxW="container.xl" position="relative" zIndex={1}>
          <Flex h={16} align="center" justify="space-between">
            <NextLink href="/" passHref legacyBehavior>
              <Link _hover={{ textDecoration: 'none' }}>
                <Text fontWeight="bold" fontSize="lg" color="brand.500">
                  {copy.appName}
                </Text>
              </Link>
            </NextLink>

            {/* Desktop nav */}
            <HStack spacing={6} display={{ base: 'none', md: 'flex' }}>
              <HStack as="ul" spacing={{ base: 2, md: 6 }} listStyleType="none">
                {navItems.map((item) => {
                  const isActive = router.pathname === item.href;
                  return (
                    <Box as="li" key={item.href}>
                      <NextLink href={item.href} passHref legacyBehavior>
                        <Link
                          fontWeight={isActive ? 'semibold' : 'normal'}
                          color={isActive ? 'brand.500' : 'textMuted'}
                          _hover={{ color: 'brand.500', textDecoration: 'none' }}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          {item.label}
                        </Link>
                      </NextLink>
                    </Box>
                  );
                })}
              </HStack>
              <NextLink href="/settings" passHref legacyBehavior>
                <Link _hover={{ textDecoration: 'none' }}>
                  <Box
                    px={2}
                    py={1}
                    borderWidth="1px"
                    borderRadius="full"
                    borderColor="borderSubtle"
                    bg="surfaceMutedBg"
                    data-testid="header-profile-chip"
                  >
                    <ProfileSummary
                      profile={profile}
                      fallbackName={copy.layout.profileFallbackName}
                      size="sm"
                    />
                  </Box>
                </Link>
              </NextLink>
              <NextLink href="/settings" passHref legacyBehavior>
                <Link
                  aria-label={copy.layout.nav.settings}
                  display="inline-flex"
                  alignItems="center"
                  justifyContent="center"
                  w={10}
                  h={10}
                  borderRadius="md"
                  color={router.pathname === '/settings' ? 'brand.500' : 'textMuted'}
                  _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                  _focusVisible={{ boxShadow: 'outline' }}
                  data-testid="header-settings-link"
                >
                  <ThemeIcon name="settings" size={20} aria-hidden />
                </Link>
              </NextLink>
            </HStack>

            {/* Mobile actions */}
            <HStack spacing={1} display={{ base: 'flex', md: 'none' }}>
              <NextLink href="/settings" passHref legacyBehavior>
                <Link
                  aria-label={copy.layout.nav.settings}
                  display="inline-flex"
                  alignItems="center"
                  justifyContent="center"
                  w={10}
                  h={10}
                  borderRadius="md"
                  color={router.pathname === '/settings' ? 'brand.500' : 'textMuted'}
                  _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                  _focusVisible={{ boxShadow: 'outline' }}
                  data-testid="mobile-header-settings-link"
                >
                  <ThemeIcon name="settings" size={20} aria-hidden />
                </Link>
              </NextLink>
              <IconButton
                onClick={onToggle}
                variant="ghost"
                aria-label={copy.layout.mobileMenuLabel}
                data-testid="mobile-menu-btn"
                icon={
                  <Text fontSize="xl" lineHeight="1">
                    {isOpen ? '\u2715' : '\u2630'}
                  </Text>
                }
              />
            </HStack>
          </Flex>

          {/* Mobile nav dropdown */}
          <Collapse in={isOpen} animateOpacity>
            <VStack
              as="ul"
              listStyleType="none"
              spacing={0}
              pb={4}
              display={{ base: 'flex', md: 'none' }}
              data-testid="mobile-nav"
            >
              <Box w="100%" px={3} pb={3}>
                <NextLink href="/settings" passHref legacyBehavior>
                  <Link
                    display="block"
                    mb={3}
                    p={3}
                    borderRadius="lg"
                    bg="surfaceMutedBg"
                    data-testid="mobile-header-profile-chip"
                    _hover={{ textDecoration: 'none' }}
                    onClick={onToggle}
                  >
                    <ProfileSummary
                      profile={profile}
                      fallbackName={copy.layout.profileFallbackName}
                      size="sm"
                    />
                  </Link>
                </NextLink>
              </Box>
              {navItems.map((item) => {
                const isActive = router.pathname === item.href;
                return (
                  <Box as="li" key={item.href} w="100%">
                    <NextLink href={item.href} passHref legacyBehavior>
                      <Link
                        display="block"
                        py={2}
                        px={3}
                        borderRadius="md"
                        fontWeight={isActive ? 'semibold' : 'normal'}
                        color={isActive ? 'brand.500' : 'textMuted'}
                        bg={isActive ? 'surfaceMutedBg' : 'transparent'}
                        _hover={{ bg: 'surfaceMutedBg', textDecoration: 'none' }}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={onToggle}
                      >
                        {item.label}
                      </Link>
                    </NextLink>
                  </Box>
                );
              })}
            </VStack>
          </Collapse>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxW="container.xl" py={8} as="main" {...surfaceStyle}>
        <StorageWarning />
        {children}
      </Container>
    </Box>
  );
}
