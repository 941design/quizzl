import { extendTheme, type ThemeConfig } from '@chakra-ui/react';

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
};

export const calmTheme = extendTheme({
  config,
  colors: {
    brand: {
      50: '#e6f4f1',
      100: '#c0e3db',
      200: '#96d0c3',
      300: '#6bbcab',
      400: '#4aad9a',
      500: '#2a9d8a',
      600: '#259080',
      700: '#1f8073',
      800: '#177065',
      900: '#0d5450',
    },
  },
  fonts: {
    heading: 'system-ui, sans-serif',
    body: 'system-ui, sans-serif',
  },
  components: {
    Button: {
      defaultProps: {
        colorScheme: 'teal',
      },
    },
  },
});

export const playfulTheme = extendTheme({
  config,
  colors: {
    brand: {
      50: '#fef3e2',
      100: '#fde0b5',
      200: '#fbcc84',
      300: '#f9b852',
      400: '#f8a930',
      500: '#f79a0d',
      600: '#e58d09',
      700: '#ce7d06',
      800: '#b76e04',
      900: '#8f5300',
    },
  },
  fonts: {
    heading: 'system-ui, sans-serif',
    body: 'system-ui, sans-serif',
  },
  radii: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '20px',
    '2xl': '28px',
    full: '9999px',
  },
  components: {
    Button: {
      defaultProps: {
        colorScheme: 'orange',
      },
    },
  },
});

export default calmTheme;
