import React from 'react';
import {
  Box,
  Flex,
  HStack,
  Link,
  Text,
  Container,
  useColorModeValue,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { useRouter } from 'next/router';
import StorageWarning from '@/src/components/StorageWarning';

type NavItem = {
  label: string;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Topics', href: '/topics' },
  { label: 'Leaderboard', href: '/leaderboard' },
  { label: 'Study Times', href: '/study-times' },
  { label: 'Settings', href: '/settings' },
];

type LayoutProps = {
  children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const bg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  return (
    <Box minH="100vh" bg={useColorModeValue('gray.50', 'gray.900')}>
      {/* Navigation Bar */}
      <Box
        as="nav"
        bg={bg}
        borderBottomWidth="1px"
        borderBottomColor={borderColor}
        position="sticky"
        top={0}
        zIndex={10}
        aria-label="Main navigation"
      >
        <Container maxW="container.xl">
          <Flex h={16} align="center" justify="space-between">
            <NextLink href="/" passHref legacyBehavior>
              <Link _hover={{ textDecoration: 'none' }}>
                <Text fontWeight="bold" fontSize="lg" color="brand.500">
                  GroupLearn
                </Text>
              </Link>
            </NextLink>

            <HStack
              as="ul"
              spacing={{ base: 2, md: 6 }}
              listStyleType="none"
              display={{ base: 'none', md: 'flex' }}
            >
              {NAV_ITEMS.map((item) => {
                const isActive = router.pathname === item.href;
                return (
                  <Box as="li" key={item.href}>
                    <NextLink href={item.href} passHref legacyBehavior>
                      <Link
                        fontWeight={isActive ? 'semibold' : 'normal'}
                        color={isActive ? 'brand.500' : 'gray.600'}
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
          </Flex>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxW="container.xl" py={8} as="main">
        <StorageWarning />
        {children}
      </Container>
    </Box>
  );
}
