// pages/theme-preview.tsx
//
// DEV-ONLY themed-component gallery ("kitchen sink"). Renders every semantic
// color token and the real constellations they appear in across the app, so
// you can see exactly where a token like `surfaceMutedBg` surfaces.
//
// This page is NOT part of the product. It returns null in production builds,
// so it is blank in the static export / on the deployed site and is only
// usable via `make dev` locally. Because it never reaches users, its copy is
// intentionally plain developer English (exempt from the i18n rule that
// governs shipped UI).
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Heading,
  HStack,
  Input,
  Select,
  SimpleGrid,
  Switch,
  Tag,
  Text,
  Textarea,
  UnorderedList,
  ListItem,
  VStack,
  Wrap,
} from '@chakra-ui/react';
import Head from 'next/head';
import ThemeIcon from '@/src/components/ThemeIcon';
import HeroAccents from '@/src/components/HeroAccents';
import { useCopy } from '@/src/context/LanguageContext';
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import { useThemeStyles } from '@/src/hooks/useThemeStyles';
import { listThemes } from '@/src/lib/theme';
import type { AppThemeName } from '@/src/types';

/** Small caption that names which token(s) a block is demonstrating. */
function TokenLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text as="code" fontSize="xs" color="textMuted" fontFamily="mono">
      {children}
    </Text>
  );
}

/** Section wrapper with a heading. */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Box as="section" w="full">
      <Heading as="h2" size="md" mb={1}>
        {title}
      </Heading>
      {subtitle && (
        <Text color="textMuted" fontSize="sm" mb={4}>
          {subtitle}
        </Text>
      )}
      {!subtitle && <Box mb={4} />}
      {children}
    </Box>
  );
}

/** A single color swatch labeled with its token name + resolved value. */
function Swatch({ token, note }: { token: string; note?: string }) {
  return (
    <VStack align="stretch" spacing={1}>
      <Box
        h="56px"
        borderRadius="md"
        bg={token}
        borderWidth="1px"
        borderColor="borderStrong"
      />
      <TokenLabel>{token}</TokenLabel>
      {note && (
        <Text fontSize="xs" color="textMuted">
          {note}
        </Text>
      )}
    </VStack>
  );
}

export default function ThemePreviewPage() {
  // Hard gate: never render outside local dev.
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const copy = useCopy();
  const { themeName, setTheme } = useAppTheme();
  const { cardStyle, surfaceStyle, buttonStyle } = useThemeStyles();

  // buttonStyle is a BoxProps bag (elevation treatment); Chakra's Button typing
  // rejects a few DOM-handler keys (e.g. onToggle) from a raw BoxProps spread,
  // so funnel it through `sx` for the preview rather than spreading it.
  const buttonSx = buttonStyle as Record<string, unknown>;
  const themes = listThemes();

  return (
    <>
      <Head>
        <title>Theme preview (dev)</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <VStack align="stretch" spacing={12} py={8} maxW="1100px" mx="auto">
        {/* ---- Theme switcher (the very first element) --------------- */}
        <Box>
          <Heading as="h1" size="lg" mb={1}>
            Theme preview
          </Heading>
          <Text color="textMuted" fontSize="sm" mb={4}>
            Dev-only gallery. Active theme: <b>{themeName}</b>. Switch below — every
            block updates live.
          </Text>
          <Wrap spacing={2}>
            {themes.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={t.id === themeName ? 'solid' : 'outline'}
                colorScheme={t.previewColorScheme}
                onClick={() => setTheme(t.id as AppThemeName)}
              >
                {t.label.en}
                {t.status !== 'stable' && (
                  <Badge ml={2} fontSize="0.6em" colorScheme="gray">
                    {t.status}
                  </Badge>
                )}
              </Button>
            ))}
          </Wrap>
        </Box>

        {/* ---- Start-page preview (heading + sub-heading + 2 bullets + 2
             cards) over a FEW large themed watercolor accents ---------- */}
        <Box
          as="section"
          data-testid="theme-preview-hero"
          position="relative"
          overflow="hidden"
          w="full"
          bg="appBg"
          minH={{ base: '460px', md: '520px' }}
          borderRadius="2xl"
          borderWidth="1px"
          borderColor="borderSubtle"
          px={{ base: 6, md: 12 }}
          py={{ base: 10, md: 16 }}
        >
          {/* A few large soft themed watercolor blobs framing the section
              (shared with the real start page — see HeroAccents). */}
          <HeroAccents />

          <VStack position="relative" spacing={8} maxW="680px" mx="auto" textAlign="center">
            <VStack spacing={5}>
              <Heading as="h1" size="2xl">
                {copy.home.title}
              </Heading>
              <VStack spacing={3}>
                <Heading as="h2" size="lg">
                  {copy.home.subheadingLead}
                </Heading>
                <UnorderedList spacing={2} textAlign="left">
                  {/* Start page shows the full list; the preview shows just two. */}
                  {copy.home.subheadingPoints.slice(0, 2).map((point) => (
                    <ListItem key={point} color="textMuted" fontSize="lg">
                      {point}
                    </ListItem>
                  ))}
                </UnorderedList>
              </VStack>
            </VStack>
            <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={5} w="full">
              {[
                { title: copy.home.contactsTitle, subtitle: copy.home.contactsSubtitle },
                { title: copy.home.groupsTitle, subtitle: copy.home.groupsSubtitle },
              ].map((tile) => (
                <Box
                  key={tile.title}
                  as="article"
                  p={6}
                  bg="surfaceBg"
                  borderRadius="xl"
                  shadow="sm"
                  borderWidth="1px"
                  borderColor="borderSubtle"
                  textAlign="left"
                  {...cardStyle}
                >
                  <Heading as="h3" size="md" mb={2}>
                    {tile.title}
                  </Heading>
                  <Text color="textMuted">{tile.subtitle}</Text>
                </Box>
              ))}
            </SimpleGrid>
          </VStack>
        </Box>

        <Divider />

        {/* ---- Token map --------------------------------------------- */}
        <Section
          title="Background & surface tokens"
          subtitle="The backgrounds the app layers. This is where surfaceMutedBg lives."
        >
          <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4}>
            <Swatch token="appBg" note="Page canvas (behind everything)" />
            <Swatch token="surfaceBg" note="Cards, header, popovers" />
            {/* surfaceRaisedBg commented out — the token appears nowhere in the
                app (no raised surface / menu is rendered anywhere). */}
            {/* <Swatch token="surfaceRaisedBg" note="Raised surfaces / menus" /> */}
            <Swatch token="surfaceMutedBg" note="Hover + selected + muted panels" />
          </SimpleGrid>
        </Section>

        <Section title="Text & border tokens">
          <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
            <Swatch token="textStrong" note="Primary text" />
            <Swatch token="textMuted" note="Secondary text" />
            <Swatch token="borderSubtle" note="Card / divider borders" />
            <Swatch token="borderStrong" note="Emphasized borders" />
          </SimpleGrid>
        </Section>

        <Section title="Status tokens" subtitle="Used by alerts and status chips.">
          <SimpleGrid columns={{ base: 3, md: 3 }} spacing={6}>
            <VStack align="stretch" spacing={1}>
              <Swatch token="successBg" />
              <Swatch token="successBorder" />
              <Swatch token="successText" />
            </VStack>
            <VStack align="stretch" spacing={1}>
              <Swatch token="warningBg" />
              <Swatch token="warningBorder" />
              <Swatch token="warningText" />
            </VStack>
            <VStack align="stretch" spacing={1}>
              <Swatch token="dangerBg" />
              <Swatch token="dangerBorder" />
              <Swatch token="dangerText" />
            </VStack>
          </SimpleGrid>
        </Section>

        <Section title="Color scales">
          {(['brand', 'success', 'warning', 'danger', 'neutral'] as const).map((scale) => (
            <Box key={scale} mb={3}>
              <TokenLabel>{scale}</TokenLabel>
              <Flex mt={1} borderRadius="md" overflow="hidden">
                {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => (
                  <Box key={step} flex="1" h="32px" bg={`${scale}.${step}`} />
                ))}
              </Flex>
            </Box>
          ))}
        </Section>

        <Divider />

        {/* ---- Real constellations ----------------------------------- */}
        <Section
          title="Home tiles"
          subtitle="Exactly the index-page cards: surfaceBg + borderSubtle + the theme's card treatment."
        >
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
            {['Contacts', 'Groups', 'Profile'].map((title) => (
              <Box
                key={title}
                as="article"
                p={6}
                bg="surfaceBg"
                borderRadius="xl"
                shadow="sm"
                borderWidth="1px"
                borderColor="borderSubtle"
                {...cardStyle}
              >
                <Heading as="h3" size="md" mb={2}>
                  {title}
                </Heading>
                <Text color="textMuted">Message the people you know directly.</Text>
                <Box mt={3}>
                  <TokenLabel>bg=surfaceBg · border=borderSubtle · cardStyle</TokenLabel>
                </Box>
              </Box>
            ))}
          </SimpleGrid>
        </Section>

        <Section
          title="List rows — hover & selected"
          subtitle="Nav items, contact rows, notification rows. surfaceMutedBg is the hover + selected background."
        >
          <Box bg="surfaceBg" borderRadius="lg" borderWidth="1px" borderColor="borderSubtle" overflow="hidden">
            {[
              { name: 'Alice', selected: false },
              { name: 'Bob (selected)', selected: true },
              { name: 'Carol', selected: false },
            ].map((row, i) => (
              <Flex
                key={row.name}
                align="center"
                gap={3}
                px={4}
                py={3}
                borderTopWidth={i === 0 ? '0' : '1px'}
                borderColor="borderSubtle"
                bg={row.selected ? 'surfaceMutedBg' : 'transparent'}
                _hover={{ bg: 'surfaceMutedBg' }}
                cursor="pointer"
              >
                <ThemeIcon name="person" size={20} aria-hidden />
                <Text flex="1">{row.name}</Text>
                <Badge colorScheme="brand">3</Badge>
              </Flex>
            ))}
          </Box>
          <Box mt={2}>
            <TokenLabel>selected/hover bg = surfaceMutedBg · row border = borderSubtle</TokenLabel>
          </Box>
        </Section>

        <Section
          title="Profile summary panel"
          subtitle="The muted inset panel (also used by the avatar picker). This is a static use of surfaceMutedBg."
        >
          <Flex
            align="center"
            gap={4}
            p={4}
            bg="surfaceMutedBg"
            borderRadius="lg"
          >
            <Box
              w="48px"
              h="48px"
              borderRadius="full"
              bg="brand.500"
              display="flex"
              alignItems="center"
              justifyContent="center"
              color="white"
              fontWeight="bold"
            >
              A
            </Box>
            <VStack align="start" spacing={0}>
              <Text fontWeight="bold">Anonymous</Text>
              <Text color="textMuted" fontSize="sm">
                npub1abc…xyz
              </Text>
            </VStack>
          </Flex>
          <Box mt={2}>
            <TokenLabel>panel bg = surfaceMutedBg · avatar = brand.500</TokenLabel>
          </Box>
        </Section>

        {/* COMMENTED OUT — not present anywhere in the app: there are no Menu
            or Popover components (no notification popover / dropdown menu), and
            the `surfaceRaisedBg` token + `surfaceStyle` treatment are otherwise
            unused. Kept here (disabled) so it's ready if a raised surface is
            introduced later.
        <Section
          title="Raised surface (popover / menu)"
          subtitle="Notification popover, dropdown menus — surfaceRaisedBg with muted hover rows."
        >
          <Box
            maxW="320px"
            bg="surfaceRaisedBg"
            borderRadius="lg"
            borderWidth="1px"
            borderColor="borderSubtle"
            shadow="lg"
            overflow="hidden"
            {...surfaceStyle}
          >
            <Flex align="center" gap={2} px={4} py={3} borderBottomWidth="1px" borderColor="borderSubtle">
              <ThemeIcon name="bell" size={18} aria-hidden />
              <Text fontWeight="semibold">Notifications</Text>
            </Flex>
            {['New message from Bob', 'Alice joined a group'].map((n) => (
              <Box key={n} px={4} py={3} _hover={{ bg: 'surfaceMutedBg' }} cursor="pointer">
                <Text fontSize="sm">{n}</Text>
              </Box>
            ))}
          </Box>
          <Box mt={2}>
            <TokenLabel>bg = surfaceRaisedBg · hover row = surfaceMutedBg · surfaceStyle</TokenLabel>
          </Box>
        </Section>
        */}

        <Section title="Buttons" subtitle="The theme's buttonColorScheme drives the default solid button in the app.">
          <VStack align="stretch" spacing={4}>
            {/* 'success' commented out — no colorScheme="success" button exists
                anywhere in the app (green semantics use colorScheme="green"). */}
            {(['brand', /* 'success', */ 'warning', 'danger'] as const).map((scheme) => (
              <Wrap key={scheme} spacing={3} align="center">
                <Box w="70px">
                  <TokenLabel>{scheme}</TokenLabel>
                </Box>
                <Button colorScheme={scheme} sx={buttonSx}>
                  Solid
                </Button>
                <Button colorScheme={scheme} variant="outline">
                  Outline
                </Button>
                <Button colorScheme={scheme} variant="ghost">
                  Ghost
                </Button>
                <Button colorScheme={scheme} isDisabled sx={buttonSx}>
                  Disabled
                </Button>
              </Wrap>
            ))}
          </VStack>
        </Section>

        <Section title="Badges">
          <Wrap spacing={3}>
            {/* 'success' commented out — no colorScheme="success" badge exists
                anywhere in the app. */}
            {(['brand', /* 'success', */ 'warning', 'danger', 'gray'] as const).map((c) => (
              <Badge key={c} colorScheme={c}>
                {c}
              </Badge>
            ))}
            {/* COMMENTED OUT — the Chakra <Tag> component is not used anywhere in
                the app. Kept here (disabled) for future use.
            <Tag colorScheme="brand">Tag</Tag>
            <Tag colorScheme="brand" variant="solid">
              Solid tag
            </Tag>
            */}
          </Wrap>
        </Section>

        <Section title="Alerts" subtitle="successBg / warningBg / dangerBg + matching border & text tokens.">
          <VStack align="stretch" spacing={3}>
            <Alert status="success" borderRadius="md">
              <AlertIcon />
              Saved successfully.
            </Alert>
            <Alert status="warning" borderRadius="md">
              <AlertIcon />
              Heads up — this can't be undone.
            </Alert>
            <Alert status="error" borderRadius="md">
              <AlertIcon />
              Something went wrong.
            </Alert>
            <Alert status="info" borderRadius="md">
              <AlertIcon />
              For your information.
            </Alert>
          </VStack>
        </Section>

        <Section title="Form controls">
          <VStack align="stretch" spacing={3} maxW="480px">
            <Input placeholder="Text input" />
            <Select placeholder="Select an option">
              <option>Option A</option>
              <option>Option B</option>
            </Select>
            <Textarea placeholder="Textarea" rows={3} />
            <HStack>
              <Switch colorScheme="brand" defaultChecked />
              <Text>Toggle</Text>
            </HStack>
          </VStack>
        </Section>

        <Section title="Typography">
          <VStack align="start" spacing={2}>
            <Heading size="2xl">Heading 2xl</Heading>
            <Heading size="lg">Heading lg</Heading>
            <Text fontSize="lg">Body large — the quick brown fox.</Text>
            <Text>Body default — the quick brown fox jumps over the lazy dog.</Text>
            <Text color="textMuted">Muted text — secondary information.</Text>
          </VStack>
        </Section>
      </VStack>
    </>
  );
}
