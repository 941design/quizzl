import { ChakraProvider } from '@chakra-ui/react';
import type { AppProps } from 'next/app';
import Layout from '@/src/components/Layout';
import { useMoodTheme } from '@/src/hooks/useMoodTheme';

export default function App({ Component, pageProps }: AppProps) {
  const { activeTheme } = useMoodTheme();

  return (
    <ChakraProvider theme={activeTheme}>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </ChakraProvider>
  );
}
