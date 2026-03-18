import { extendTheme, type ThemeConfig, type ThemeOverride } from '@chakra-ui/react';
import type { AppThemeName } from '@/src/types';

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
};

type ThemeTextKey = 'calm' | 'playful' | 'lego' | 'minecraft';
type ThemeDescriptionKey =
  | 'calmDescription'
  | 'playfulDescription'
  | 'legoDescription'
  | 'minecraftDescription';
type ThemeColorScheme = 'brand' | 'success' | 'warning' | 'danger';
type ThemeVisualStyle = 'soft' | 'rounded' | 'toy' | 'pixel';

type ColorScale = Record<number, string>;

type ThemeBuildInput = {
  brandScale: ColorScale;
  successScale: ColorScale;
  warningScale: ColorScale;
  dangerScale: ColorScale;
  neutralScale: ColorScale;
  fonts?: { heading: string; body: string };
  radii?: Record<string, string>;
  buttonColorScheme: ThemeColorScheme;
  appBg: string;
  surfaceBg: string;
  surfaceMutedBg: string;
  surfaceRaisedBg: string;
  borderSubtle: string;
  borderStrong: string;
  textMuted: string;
  textStrong: string;
  successBg: string;
  successBorder: string;
  successText: string;
  warningBg: string;
  warningBorder: string;
  warningText: string;
  dangerBg: string;
  dangerBorder: string;
  dangerText: string;
  backgroundImage?: string;
};

export type AppThemeDefinition = {
  id: AppThemeName;
  labelKey: ThemeTextKey;
  descriptionKey: ThemeDescriptionKey;
  previewColorScheme: ThemeColorScheme;
  visualStyle: ThemeVisualStyle;
  backgroundImage?: string;
  surfacePattern?: string;
  fontFamily?: string;
  buttonVariant?: 'solid' | 'outline';
  chakraTheme: ThemeOverride;
};

function createScale(values: string[]): ColorScale {
  return {
    50: values[0],
    100: values[1],
    200: values[2],
    300: values[3],
    400: values[4],
    500: values[5],
    600: values[6],
    700: values[7],
    800: values[8],
    900: values[9],
  };
}

function createTheme(input: ThemeBuildInput) {
  const {
    brandScale,
    successScale,
    warningScale,
    dangerScale,
    neutralScale,
    fonts,
    radii,
    buttonColorScheme,
    appBg,
    surfaceBg,
    surfaceMutedBg,
    surfaceRaisedBg,
    borderSubtle,
    borderStrong,
    textMuted,
    textStrong,
    successBg,
    successBorder,
    successText,
    warningBg,
    warningBorder,
    warningText,
    dangerBg,
    dangerBorder,
    dangerText,
    backgroundImage,
  } = input;

  return extendTheme({
    config,
    colors: {
      brand: brandScale,
      success: successScale,
      warning: warningScale,
      danger: dangerScale,
      neutral: neutralScale,
    },
    semanticTokens: {
      colors: {
        appBg: appBg,
        surfaceBg: surfaceBg,
        surfaceMutedBg: surfaceMutedBg,
        surfaceRaisedBg: surfaceRaisedBg,
        borderSubtle: borderSubtle,
        borderStrong: borderStrong,
        textMuted: textMuted,
        textStrong: textStrong,
        successBg: successBg,
        successBorder: successBorder,
        successText: successText,
        warningBg: warningBg,
        warningBorder: warningBorder,
        warningText: warningText,
        dangerBg: dangerBg,
        dangerBorder: dangerBorder,
        dangerText: dangerText,
      },
    },
    fonts: fonts ?? {
      heading: 'system-ui, sans-serif',
      body: 'system-ui, sans-serif',
    },
    radii,
    styles: {
      global: {
        body: {
          bg: 'appBg',
          color: 'textStrong',
          backgroundImage,
          backgroundAttachment: backgroundImage ? 'fixed' : undefined,
          backgroundPosition: backgroundImage ? 'center top' : undefined,
          backgroundRepeat: backgroundImage ? 'repeat' : undefined,
          backgroundSize: backgroundImage ? 'auto' : undefined,
        },
      },
    },
    components: {
      Button: {
        defaultProps: {
          colorScheme: buttonColorScheme,
        },
      },
      Tabs: {
        defaultProps: {
          colorScheme: 'brand',
        },
      },
      Progress: {
        defaultProps: {
          colorScheme: 'brand',
        },
      },
      Badge: {
        defaultProps: {
          colorScheme: 'brand',
        },
      },
      Tag: {
        defaultProps: {
          colorScheme: 'brand',
        },
      },
      Checkbox: {
        defaultProps: {
          colorScheme: 'brand',
        },
      },
      Radio: {
        defaultProps: {
          colorScheme: 'brand',
        },
      },
    },
  });
}

const calmTheme = createTheme({
  brandScale: createScale([
    '#e6f4f1',
    '#c0e3db',
    '#96d0c3',
    '#6bbcab',
    '#4aad9a',
    '#2a9d8a',
    '#259080',
    '#1f8073',
    '#177065',
    '#0d5450',
  ]),
  successScale: createScale([
    '#e6f7ef',
    '#c2ead3',
    '#9bdeb8',
    '#71d19b',
    '#50c785',
    '#32bb71',
    '#27aa66',
    '#1d9658',
    '#137f4a',
    '#045a33',
  ]),
  warningScale: createScale([
    '#fff6df',
    '#fde7b1',
    '#fbd77f',
    '#f8c84b',
    '#f5bb24',
    '#e6a700',
    '#cd9500',
    '#b28200',
    '#966f00',
    '#6a4f00',
  ]),
  dangerScale: createScale([
    '#fdeceb',
    '#f8c7c3',
    '#f1a09b',
    '#ea7873',
    '#e45b57',
    '#d93a3f',
    '#bf2d33',
    '#a0252c',
    '#821c24',
    '#5d1118',
  ]),
  neutralScale: createScale([
    '#f7f8f8',
    '#ecefef',
    '#dce1e1',
    '#c8d0cf',
    '#aeb8b7',
    '#8b9796',
    '#697877',
    '#526261',
    '#394847',
    '#202d2c',
  ]),
  buttonColorScheme: 'brand',
  appBg: '#f3f7f8',
  surfaceBg: '#ffffff',
  surfaceMutedBg: '#eef5f4',
  surfaceRaisedBg: '#ffffff',
  borderSubtle: '#d7e3e0',
  borderStrong: '#98b5af',
  textMuted: '#5f6f6c',
  textStrong: '#203230',
  successBg: '#eaf7ef',
  successBorder: '#9bdeb8',
  successText: '#1d6b49',
  warningBg: '#fff4d7',
  warningBorder: '#f2c86c',
  warningText: '#7e5c00',
  dangerBg: '#fdeeed',
  dangerBorder: '#efb0ab',
  dangerText: '#8b2430',
});

const playfulTheme = createTheme({
  brandScale: createScale([
    '#fef3e2',
    '#fde0b5',
    '#fbcc84',
    '#f9b852',
    '#f8a930',
    '#f79a0d',
    '#e58d09',
    '#ce7d06',
    '#b76e04',
    '#8f5300',
  ]),
  successScale: createScale([
    '#e7fbef',
    '#c6f2d3',
    '#a2e8b6',
    '#79dc98',
    '#57d27f',
    '#33c867',
    '#26b65b',
    '#1d9f4f',
    '#168743',
    '#085f2c',
  ]),
  warningScale: createScale([
    '#fff2dc',
    '#ffdca7',
    '#ffc36e',
    '#ffae36',
    '#ff9c14',
    '#f38600',
    '#da7400',
    '#bc6200',
    '#9d5000',
    '#6f3700',
  ]),
  dangerScale: createScale([
    '#ffe8ed',
    '#ffc1ce',
    '#ff97ad',
    '#ff6c8c',
    '#fb4f78',
    '#ef2e62',
    '#d41e53',
    '#b21645',
    '#910e37',
    '#630422',
  ]),
  neutralScale: createScale([
    '#fffaf3',
    '#f8efdf',
    '#eedec1',
    '#e1cba1',
    '#cfb57c',
    '#b5985a',
    '#8e7543',
    '#6d5831',
    '#4d3c21',
    '#2f2212',
  ]),
  buttonColorScheme: 'brand',
  appBg: '#fff7ec',
  surfaceBg: '#ffffff',
  surfaceMutedBg: '#fff0d8',
  surfaceRaisedBg: '#fffaf2',
  borderSubtle: '#f3d4a2',
  borderStrong: '#d89d49',
  textMuted: '#7a664c',
  textStrong: '#35230f',
  successBg: '#ebfbef',
  successBorder: '#92e0ae',
  successText: '#16673d',
  warningBg: '#fff1d9',
  warningBorder: '#f5b560',
  warningText: '#8c5300',
  dangerBg: '#ffeaf0',
  dangerBorder: '#f8a2b7',
  dangerText: '#97214a',
  radii: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '20px',
    '2xl': '28px',
    full: '9999px',
  },
});

const legoThemeBackground =
  'linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(180deg, #ffe36e 0%, #ffd44c 100%)';

const legoTheme = createTheme({
  brandScale: createScale([
    '#fff3d6',
    '#ffe8a5',
    '#ffda73',
    '#ffcc42',
    '#ffc21f',
    '#f4b400',
    '#d89d00',
    '#ba8600',
    '#9c6f00',
    '#6f5000',
  ]),
  successScale: createScale([
    '#effbe4',
    '#d3f4b5',
    '#b4ec83',
    '#96e250',
    '#7fd925',
    '#67c100',
    '#58a900',
    '#499000',
    '#397600',
    '#264f00',
  ]),
  warningScale: createScale([
    '#fff2dc',
    '#ffd8a7',
    '#ffbc6f',
    '#ff9f39',
    '#ff8916',
    '#f26d00',
    '#d35d00',
    '#b04d00',
    '#8c3c00',
    '#5d2600',
  ]),
  dangerScale: createScale([
    '#ffe8e3',
    '#ffc3b6',
    '#ff9986',
    '#ff6f58',
    '#ff4f33',
    '#f23b1f',
    '#d32f17',
    '#b02511',
    '#8d1b0b',
    '#5f1105',
  ]),
  neutralScale: createScale([
    '#fffef9',
    '#f4f0e2',
    '#e3dcc5',
    '#cfc4a5',
    '#b4a77e',
    '#927f58',
    '#6f5f40',
    '#53472f',
    '#392f1f',
    '#221b11',
  ]),
  buttonColorScheme: 'danger',
  appBg: '#ffd44c',
  surfaceBg: '#fff8dd',
  surfaceMutedBg: '#ffeaa0',
  surfaceRaisedBg: '#fffdf2',
  borderSubtle: '#d3980b',
  borderStrong: '#ad2900',
  textMuted: '#6d5306',
  textStrong: '#332100',
  successBg: '#f0fae7',
  successBorder: '#8fd943',
  successText: '#2d6b00',
  warningBg: '#fff0d9',
  warningBorder: '#ffb15a',
  warningText: '#8f4a00',
  dangerBg: '#ffe8e2',
  dangerBorder: '#ff8f75',
  dangerText: '#8f1f00',
  backgroundImage: legoThemeBackground,
  fonts: {
    heading: '"Fredoka", system-ui, sans-serif',
    body: '"Fredoka", system-ui, sans-serif',
  },
  radii: {
    sm: '4px',
    md: '6px',
    lg: '10px',
    xl: '14px',
    '2xl': '18px',
    full: '9999px',
  },
});

const minecraftThemeBackground =
  'linear-gradient(180deg, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.03) 50%), linear-gradient(90deg, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.03) 50%), linear-gradient(180deg, #7aa35a 0%, #5a7a3d 18%, #6b4b2a 18%, #6b4b2a 100%)';

const minecraftTheme = createTheme({
  brandScale: createScale([
    '#edf5e1',
    '#d8e7bf',
    '#c0d69a',
    '#a4c26f',
    '#8eb04d',
    '#759a2f',
    '#648526',
    '#536f1e',
    '#425917',
    '#2b3b0c',
  ]),
  successScale: createScale([
    '#ebf7e7',
    '#cfe8c5',
    '#b2d8a2',
    '#93c87d',
    '#79b962',
    '#5f9d47',
    '#52883b',
    '#46722f',
    '#385c24',
    '#243a14',
  ]),
  warningScale: createScale([
    '#fdf2db',
    '#f2ddb0',
    '#e5c682',
    '#d7ae54',
    '#ca9a31',
    '#b48014',
    '#9c6f0f',
    '#835d0a',
    '#6b4b06',
    '#442e00',
  ]),
  dangerScale: createScale([
    '#f8e8e0',
    '#e9c2b0',
    '#d89a80',
    '#c67253',
    '#b95234',
    '#a53c1b',
    '#8f3315',
    '#782a10',
    '#61220b',
    '#3f1404',
  ]),
  neutralScale: createScale([
    '#f3f0eb',
    '#ddd3c5',
    '#c3b49f',
    '#a89379',
    '#8b755a',
    '#6d583f',
    '#584731',
    '#453726',
    '#32271b',
    '#211811',
  ]),
  buttonColorScheme: 'brand',
  appBg: '#6b4b2a',
  surfaceBg: '#f3efe8',
  surfaceMutedBg: '#ded5c5',
  surfaceRaisedBg: '#fff9f0',
  borderSubtle: '#8b755a',
  borderStrong: '#4a351f',
  textMuted: '#5d4d3d',
  textStrong: '#25170a',
  successBg: '#edf7e7',
  successBorder: '#9dc77a',
  successText: '#30561c',
  warningBg: '#f8ecd2',
  warningBorder: '#caa04c',
  warningText: '#6a4708',
  dangerBg: '#f7e9e2',
  dangerBorder: '#c9886e',
  dangerText: '#6e2410',
  backgroundImage: minecraftThemeBackground,
  fonts: {
    heading: '"Press Start 2P", "Trebuchet MS", monospace',
    body: '"VT323", "Trebuchet MS", monospace',
  },
  radii: {
    sm: '2px',
    md: '4px',
    lg: '6px',
    xl: '8px',
    '2xl': '10px',
    full: '9999px',
  },
});

export const APP_THEMES: Record<AppThemeName, AppThemeDefinition> = {
  calm: {
    id: 'calm',
    labelKey: 'calm',
    descriptionKey: 'calmDescription',
    previewColorScheme: 'brand',
    visualStyle: 'soft',
    buttonVariant: 'solid',
    chakraTheme: calmTheme,
  },
  playful: {
    id: 'playful',
    labelKey: 'playful',
    descriptionKey: 'playfulDescription',
    previewColorScheme: 'brand',
    visualStyle: 'rounded',
    buttonVariant: 'solid',
    chakraTheme: playfulTheme,
  },
  lego: {
    id: 'lego',
    labelKey: 'lego',
    descriptionKey: 'legoDescription',
    previewColorScheme: 'danger',
    visualStyle: 'toy',
    backgroundImage: legoThemeBackground,
    surfacePattern: 'studs',
    fontFamily: '"Fredoka", system-ui, sans-serif',
    buttonVariant: 'solid',
    chakraTheme: legoTheme,
  },
  minecraft: {
    id: 'minecraft',
    labelKey: 'minecraft',
    descriptionKey: 'minecraftDescription',
    previewColorScheme: 'brand',
    visualStyle: 'pixel',
    backgroundImage: minecraftThemeBackground,
    surfacePattern: 'grid',
    fontFamily: '"Press Start 2P", "Trebuchet MS", monospace',
    buttonVariant: 'solid',
    chakraTheme: minecraftTheme,
  },
};

export const DEFAULT_THEME_NAME: AppThemeName = 'calm';

export function isAppThemeName(value: string): value is AppThemeName {
  return value in APP_THEMES;
}

export function normalizeThemeName(value: string | null | undefined): AppThemeName {
  return value && isAppThemeName(value) ? value : DEFAULT_THEME_NAME;
}

export function getThemeDefinition(themeName: AppThemeName) {
  return APP_THEMES[themeName];
}

export function getChakraTheme(themeName: AppThemeName) {
  return getThemeDefinition(themeName).chakraTheme;
}

export default calmTheme;
