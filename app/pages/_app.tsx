import { ChakraProvider } from '@chakra-ui/react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import Layout from '@/src/components/Layout';
import { LanguageProvider } from '@/src/context/LanguageContext';
import { ProfileProvider } from '@/src/context/ProfileContext';
import { AppThemeProvider, useAppTheme } from '@/src/hooks/useMoodTheme';
import dynamic from 'next/dynamic';

// NostrIdentityContext and MarmotContext use heavy crypto packages (NDK, marmot-ts, ts-mls)
// that cannot be processed by Next.js SWC at build time. Load them as client-only imports.
const NostrIdentityProvider = dynamic(
  () => import('@/src/context/NostrIdentityContext').then((m) => ({ default: m.NostrIdentityProvider })),
  { ssr: false }
);

const MarmotProvider = dynamic(
  () => import('@/src/context/MarmotContext').then((m) => ({ default: m.MarmotProvider })),
  { ssr: false }
);

function AppShell({ Component, pageProps }: AppProps) {
  const { activeTheme } = useAppTheme();

  return (
    <ChakraProvider theme={activeTheme}>
      <Head>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <LanguageProvider>
        <ProfileProvider>
          <NostrIdentityProvider>
            <MarmotProvider>
              <Layout>
                <Component {...pageProps} />
              </Layout>
            </MarmotProvider>
          </NostrIdentityProvider>
        </ProfileProvider>
      </LanguageProvider>
    </ChakraProvider>
  );
}

export default function App(props: AppProps) {
  return (
    <AppThemeProvider>
      <AppShell {...props} />
    </AppThemeProvider>
  );
}
