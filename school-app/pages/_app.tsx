import { ChakraProvider } from '@chakra-ui/react';
import type { AppProps } from 'next/app';
import Layout from '@/src/components/Layout';
import { calmTheme } from '@/src/lib/theme';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ChakraProvider theme={calmTheme}>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </ChakraProvider>
  );
}
