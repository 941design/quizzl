import { ChakraProvider } from '@chakra-ui/react';
import type { AppProps } from 'next/app';
import Layout from '@/src/components/Layout';
import { LanguageProvider } from '@/src/context/LanguageContext';
import { AppThemeProvider, useAppTheme } from '@/src/hooks/useMoodTheme';

function AppShell({ Component, pageProps }: AppProps) {
  const { activeTheme } = useAppTheme();

  return (
    <ChakraProvider theme={activeTheme}>
      <LanguageProvider>
        <Layout>
          <Component {...pageProps} />
        </Layout>
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
