// GENERATED FILE — DO NOT EDIT BY HAND.
// Produced by `node app/scripts/capture-theme-baseline.mjs`, which captures a
// fixed ALLOWLIST of subtrees from the pre-refactor `getChakraTheme(id)` export
// in app/src/lib/theme.ts (colors, semanticTokens, fonts, fontSizes, radii,
// styles, config, and components.<Name>.defaultProps for
// Button/Tabs/Progress/Badge/Tag/Checkbox/Radio).
//
// This is the frozen AC-PARITY-1 parity fixture: story S2 asserts the
// refactored theme output still deep-equals these subtrees. Regenerating this
// file after S1 lands would silently erase that guarantee — do not re-run the
// capture script against a post-refactor theme.ts. If the fixture ever needs a
// deliberate, reviewed update, that is a conscious decision, not routine codegen.
//
// IMPORTANT — parity assertion must use `toEqual`, NEVER `toStrictEqual`:
// this file is a JSON literal, so it cannot represent own-enumerable keys
// whose value is `undefined` (e.g. `styles.global.body.backgroundImage:
// undefined` and its sibling background* keys, present for the calm/playful
// themes — see theme.ts's `styles.global.body`). `toEqual` treats an
// undefined-valued key as equal to an absent key, so this fixture round-trips
// safely under it. `toStrictEqual` does NOT make that allowance and WOULD
// spuriously fail for every theme carrying such a key. The S2 AC-PARITY-1
// assertion (`expect(pick(getChakraTheme(id), ALLOWLIST)).toEqual(baseline[id])`)
// MUST use `toEqual` and MUST NOT use `toStrictEqual`.

export type ThemeBaselineAllowlist = {
  colors: unknown;
  semanticTokens: unknown;
  fonts: unknown;
  fontSizes: unknown;
  radii: unknown;
  styles: unknown;
  config: unknown;
  components: {
    Button: { defaultProps: unknown };
    Tabs: { defaultProps: unknown };
    Progress: { defaultProps: unknown };
    Badge: { defaultProps: unknown };
    Tag: { defaultProps: unknown };
    Checkbox: { defaultProps: unknown };
    Radio: { defaultProps: unknown };
  };
};

export type ThemeBaselineId = 'calm' | 'playful' | 'lego' | 'minecraft' | 'flower';

export const baseline: Record<ThemeBaselineId, ThemeBaselineAllowlist> = {
  calm: {
    "colors": {
      "transparent": "transparent",
      "current": "currentColor",
      "black": "#000000",
      "white": "#FFFFFF",
      "whiteAlpha": {
        "50": "rgba(255, 255, 255, 0.04)",
        "100": "rgba(255, 255, 255, 0.06)",
        "200": "rgba(255, 255, 255, 0.08)",
        "300": "rgba(255, 255, 255, 0.16)",
        "400": "rgba(255, 255, 255, 0.24)",
        "500": "rgba(255, 255, 255, 0.36)",
        "600": "rgba(255, 255, 255, 0.48)",
        "700": "rgba(255, 255, 255, 0.64)",
        "800": "rgba(255, 255, 255, 0.80)",
        "900": "rgba(255, 255, 255, 0.92)"
      },
      "blackAlpha": {
        "50": "rgba(0, 0, 0, 0.04)",
        "100": "rgba(0, 0, 0, 0.06)",
        "200": "rgba(0, 0, 0, 0.08)",
        "300": "rgba(0, 0, 0, 0.16)",
        "400": "rgba(0, 0, 0, 0.24)",
        "500": "rgba(0, 0, 0, 0.36)",
        "600": "rgba(0, 0, 0, 0.48)",
        "700": "rgba(0, 0, 0, 0.64)",
        "800": "rgba(0, 0, 0, 0.80)",
        "900": "rgba(0, 0, 0, 0.92)"
      },
      "gray": {
        "50": "#F7FAFC",
        "100": "#EDF2F7",
        "200": "#E2E8F0",
        "300": "#CBD5E0",
        "400": "#A0AEC0",
        "500": "#718096",
        "600": "#4A5568",
        "700": "#2D3748",
        "800": "#1A202C",
        "900": "#171923"
      },
      "red": {
        "50": "#FFF5F5",
        "100": "#FED7D7",
        "200": "#FEB2B2",
        "300": "#FC8181",
        "400": "#F56565",
        "500": "#E53E3E",
        "600": "#C53030",
        "700": "#9B2C2C",
        "800": "#822727",
        "900": "#63171B"
      },
      "orange": {
        "50": "#FFFAF0",
        "100": "#FEEBC8",
        "200": "#FBD38D",
        "300": "#F6AD55",
        "400": "#ED8936",
        "500": "#DD6B20",
        "600": "#C05621",
        "700": "#9C4221",
        "800": "#7B341E",
        "900": "#652B19"
      },
      "yellow": {
        "50": "#FFFFF0",
        "100": "#FEFCBF",
        "200": "#FAF089",
        "300": "#F6E05E",
        "400": "#ECC94B",
        "500": "#D69E2E",
        "600": "#B7791F",
        "700": "#975A16",
        "800": "#744210",
        "900": "#5F370E"
      },
      "green": {
        "50": "#F0FFF4",
        "100": "#C6F6D5",
        "200": "#9AE6B4",
        "300": "#68D391",
        "400": "#48BB78",
        "500": "#38A169",
        "600": "#2F855A",
        "700": "#276749",
        "800": "#22543D",
        "900": "#1C4532"
      },
      "teal": {
        "50": "#E6FFFA",
        "100": "#B2F5EA",
        "200": "#81E6D9",
        "300": "#4FD1C5",
        "400": "#38B2AC",
        "500": "#319795",
        "600": "#2C7A7B",
        "700": "#285E61",
        "800": "#234E52",
        "900": "#1D4044"
      },
      "blue": {
        "50": "#ebf8ff",
        "100": "#bee3f8",
        "200": "#90cdf4",
        "300": "#63b3ed",
        "400": "#4299e1",
        "500": "#3182ce",
        "600": "#2b6cb0",
        "700": "#2c5282",
        "800": "#2a4365",
        "900": "#1A365D"
      },
      "cyan": {
        "50": "#EDFDFD",
        "100": "#C4F1F9",
        "200": "#9DECF9",
        "300": "#76E4F7",
        "400": "#0BC5EA",
        "500": "#00B5D8",
        "600": "#00A3C4",
        "700": "#0987A0",
        "800": "#086F83",
        "900": "#065666"
      },
      "purple": {
        "50": "#FAF5FF",
        "100": "#E9D8FD",
        "200": "#D6BCFA",
        "300": "#B794F4",
        "400": "#9F7AEA",
        "500": "#805AD5",
        "600": "#6B46C1",
        "700": "#553C9A",
        "800": "#44337A",
        "900": "#322659"
      },
      "pink": {
        "50": "#FFF5F7",
        "100": "#FED7E2",
        "200": "#FBB6CE",
        "300": "#F687B3",
        "400": "#ED64A6",
        "500": "#D53F8C",
        "600": "#B83280",
        "700": "#97266D",
        "800": "#702459",
        "900": "#521B41"
      },
      "brand": {
        "50": "#e6f4f1",
        "100": "#c0e3db",
        "200": "#96d0c3",
        "300": "#6bbcab",
        "400": "#4aad9a",
        "500": "#2a9d8a",
        "600": "#259080",
        "700": "#1f8073",
        "800": "#177065",
        "900": "#0d5450"
      },
      "success": {
        "50": "#e6f7ef",
        "100": "#c2ead3",
        "200": "#9bdeb8",
        "300": "#71d19b",
        "400": "#50c785",
        "500": "#32bb71",
        "600": "#27aa66",
        "700": "#1d9658",
        "800": "#137f4a",
        "900": "#045a33"
      },
      "warning": {
        "50": "#fff6df",
        "100": "#fde7b1",
        "200": "#fbd77f",
        "300": "#f8c84b",
        "400": "#f5bb24",
        "500": "#e6a700",
        "600": "#cd9500",
        "700": "#b28200",
        "800": "#966f00",
        "900": "#6a4f00"
      },
      "danger": {
        "50": "#fdeceb",
        "100": "#f8c7c3",
        "200": "#f1a09b",
        "300": "#ea7873",
        "400": "#e45b57",
        "500": "#d93a3f",
        "600": "#bf2d33",
        "700": "#a0252c",
        "800": "#821c24",
        "900": "#5d1118"
      },
      "neutral": {
        "50": "#f7f8f8",
        "100": "#ecefef",
        "200": "#dce1e1",
        "300": "#c8d0cf",
        "400": "#aeb8b7",
        "500": "#8b9796",
        "600": "#697877",
        "700": "#526261",
        "800": "#394847",
        "900": "#202d2c"
      }
    },
    "semanticTokens": {
      "colors": {
        "chakra-body-text": {
          "_light": "gray.800",
          "_dark": "whiteAlpha.900"
        },
        "chakra-body-bg": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-border-color": {
          "_light": "gray.200",
          "_dark": "whiteAlpha.300"
        },
        "chakra-inverse-text": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-subtle-bg": {
          "_light": "gray.100",
          "_dark": "gray.700"
        },
        "chakra-subtle-text": {
          "_light": "gray.600",
          "_dark": "gray.400"
        },
        "chakra-placeholder-color": {
          "_light": "gray.500",
          "_dark": "whiteAlpha.400"
        },
        "appBg": "#f3f7f8",
        "surfaceBg": "#ffffff",
        "surfaceMutedBg": "#eef5f4",
        "surfaceRaisedBg": "#ffffff",
        "borderSubtle": "#d7e3e0",
        "borderStrong": "#98b5af",
        "textMuted": "#5f6f6c",
        "textStrong": "#203230",
        "successBg": "#eaf7ef",
        "successBorder": "#9bdeb8",
        "successText": "#1d6b49",
        "warningBg": "#fff4d7",
        "warningBorder": "#f2c86c",
        "warningText": "#7e5c00",
        "dangerBg": "#fdeeed",
        "dangerBorder": "#efb0ab",
        "dangerText": "#8b2430"
      }
    },
    "fonts": {
      "heading": "system-ui, sans-serif",
      "body": "system-ui, sans-serif",
      "mono": "SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace"
    },
    "fontSizes": {
      "3xs": "0.45rem",
      "2xs": "0.625rem",
      "xs": "0.75rem",
      "sm": "0.875rem",
      "md": "1rem",
      "lg": "1.125rem",
      "xl": "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem",
      "6xl": "3.75rem",
      "7xl": "4.5rem",
      "8xl": "6rem",
      "9xl": "8rem"
    },
    "radii": {
      "none": "0",
      "sm": "0.125rem",
      "base": "0.25rem",
      "md": "0.375rem",
      "lg": "0.5rem",
      "xl": "0.75rem",
      "2xl": "1rem",
      "3xl": "1.5rem",
      "full": "9999px"
    },
    "styles": {
      "global": {
        "body": {
          "fontFamily": "body",
          "color": "textStrong",
          "bg": "appBg",
          "transitionProperty": "background-color",
          "transitionDuration": "normal",
          "lineHeight": "base"
        },
        "*::placeholder": {
          "color": "chakra-placeholder-color"
        },
        "*, *::before, &::after": {
          "borderColor": "chakra-border-color"
        }
      }
    },
    "config": {
      "useSystemColorMode": false,
      "initialColorMode": "light",
      "cssVarPrefix": "chakra"
    },
    "components": {
      "Button": {
        "defaultProps": {
          "variant": "solid",
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Tabs": {
        "defaultProps": {
          "size": "md",
          "variant": "line",
          "colorScheme": "brand"
        }
      },
      "Progress": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Badge": {
        "defaultProps": {
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Tag": {
        "defaultProps": {
          "size": "md",
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Checkbox": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Radio": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      }
    }
  },
  playful: {
    "colors": {
      "transparent": "transparent",
      "current": "currentColor",
      "black": "#000000",
      "white": "#FFFFFF",
      "whiteAlpha": {
        "50": "rgba(255, 255, 255, 0.04)",
        "100": "rgba(255, 255, 255, 0.06)",
        "200": "rgba(255, 255, 255, 0.08)",
        "300": "rgba(255, 255, 255, 0.16)",
        "400": "rgba(255, 255, 255, 0.24)",
        "500": "rgba(255, 255, 255, 0.36)",
        "600": "rgba(255, 255, 255, 0.48)",
        "700": "rgba(255, 255, 255, 0.64)",
        "800": "rgba(255, 255, 255, 0.80)",
        "900": "rgba(255, 255, 255, 0.92)"
      },
      "blackAlpha": {
        "50": "rgba(0, 0, 0, 0.04)",
        "100": "rgba(0, 0, 0, 0.06)",
        "200": "rgba(0, 0, 0, 0.08)",
        "300": "rgba(0, 0, 0, 0.16)",
        "400": "rgba(0, 0, 0, 0.24)",
        "500": "rgba(0, 0, 0, 0.36)",
        "600": "rgba(0, 0, 0, 0.48)",
        "700": "rgba(0, 0, 0, 0.64)",
        "800": "rgba(0, 0, 0, 0.80)",
        "900": "rgba(0, 0, 0, 0.92)"
      },
      "gray": {
        "50": "#F7FAFC",
        "100": "#EDF2F7",
        "200": "#E2E8F0",
        "300": "#CBD5E0",
        "400": "#A0AEC0",
        "500": "#718096",
        "600": "#4A5568",
        "700": "#2D3748",
        "800": "#1A202C",
        "900": "#171923"
      },
      "red": {
        "50": "#FFF5F5",
        "100": "#FED7D7",
        "200": "#FEB2B2",
        "300": "#FC8181",
        "400": "#F56565",
        "500": "#E53E3E",
        "600": "#C53030",
        "700": "#9B2C2C",
        "800": "#822727",
        "900": "#63171B"
      },
      "orange": {
        "50": "#FFFAF0",
        "100": "#FEEBC8",
        "200": "#FBD38D",
        "300": "#F6AD55",
        "400": "#ED8936",
        "500": "#DD6B20",
        "600": "#C05621",
        "700": "#9C4221",
        "800": "#7B341E",
        "900": "#652B19"
      },
      "yellow": {
        "50": "#FFFFF0",
        "100": "#FEFCBF",
        "200": "#FAF089",
        "300": "#F6E05E",
        "400": "#ECC94B",
        "500": "#D69E2E",
        "600": "#B7791F",
        "700": "#975A16",
        "800": "#744210",
        "900": "#5F370E"
      },
      "green": {
        "50": "#F0FFF4",
        "100": "#C6F6D5",
        "200": "#9AE6B4",
        "300": "#68D391",
        "400": "#48BB78",
        "500": "#38A169",
        "600": "#2F855A",
        "700": "#276749",
        "800": "#22543D",
        "900": "#1C4532"
      },
      "teal": {
        "50": "#E6FFFA",
        "100": "#B2F5EA",
        "200": "#81E6D9",
        "300": "#4FD1C5",
        "400": "#38B2AC",
        "500": "#319795",
        "600": "#2C7A7B",
        "700": "#285E61",
        "800": "#234E52",
        "900": "#1D4044"
      },
      "blue": {
        "50": "#ebf8ff",
        "100": "#bee3f8",
        "200": "#90cdf4",
        "300": "#63b3ed",
        "400": "#4299e1",
        "500": "#3182ce",
        "600": "#2b6cb0",
        "700": "#2c5282",
        "800": "#2a4365",
        "900": "#1A365D"
      },
      "cyan": {
        "50": "#EDFDFD",
        "100": "#C4F1F9",
        "200": "#9DECF9",
        "300": "#76E4F7",
        "400": "#0BC5EA",
        "500": "#00B5D8",
        "600": "#00A3C4",
        "700": "#0987A0",
        "800": "#086F83",
        "900": "#065666"
      },
      "purple": {
        "50": "#FAF5FF",
        "100": "#E9D8FD",
        "200": "#D6BCFA",
        "300": "#B794F4",
        "400": "#9F7AEA",
        "500": "#805AD5",
        "600": "#6B46C1",
        "700": "#553C9A",
        "800": "#44337A",
        "900": "#322659"
      },
      "pink": {
        "50": "#FFF5F7",
        "100": "#FED7E2",
        "200": "#FBB6CE",
        "300": "#F687B3",
        "400": "#ED64A6",
        "500": "#D53F8C",
        "600": "#B83280",
        "700": "#97266D",
        "800": "#702459",
        "900": "#521B41"
      },
      "brand": {
        "50": "#fef3e2",
        "100": "#fde0b5",
        "200": "#fbcc84",
        "300": "#f9b852",
        "400": "#f8a930",
        "500": "#f79a0d",
        "600": "#e58d09",
        "700": "#ce7d06",
        "800": "#b76e04",
        "900": "#8f5300"
      },
      "success": {
        "50": "#e7fbef",
        "100": "#c6f2d3",
        "200": "#a2e8b6",
        "300": "#79dc98",
        "400": "#57d27f",
        "500": "#33c867",
        "600": "#26b65b",
        "700": "#1d9f4f",
        "800": "#168743",
        "900": "#085f2c"
      },
      "warning": {
        "50": "#fff2dc",
        "100": "#ffdca7",
        "200": "#ffc36e",
        "300": "#ffae36",
        "400": "#ff9c14",
        "500": "#f38600",
        "600": "#da7400",
        "700": "#bc6200",
        "800": "#9d5000",
        "900": "#6f3700"
      },
      "danger": {
        "50": "#ffe8ed",
        "100": "#ffc1ce",
        "200": "#ff97ad",
        "300": "#ff6c8c",
        "400": "#fb4f78",
        "500": "#ef2e62",
        "600": "#d41e53",
        "700": "#b21645",
        "800": "#910e37",
        "900": "#630422"
      },
      "neutral": {
        "50": "#fffaf3",
        "100": "#f8efdf",
        "200": "#eedec1",
        "300": "#e1cba1",
        "400": "#cfb57c",
        "500": "#b5985a",
        "600": "#8e7543",
        "700": "#6d5831",
        "800": "#4d3c21",
        "900": "#2f2212"
      }
    },
    "semanticTokens": {
      "colors": {
        "chakra-body-text": {
          "_light": "gray.800",
          "_dark": "whiteAlpha.900"
        },
        "chakra-body-bg": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-border-color": {
          "_light": "gray.200",
          "_dark": "whiteAlpha.300"
        },
        "chakra-inverse-text": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-subtle-bg": {
          "_light": "gray.100",
          "_dark": "gray.700"
        },
        "chakra-subtle-text": {
          "_light": "gray.600",
          "_dark": "gray.400"
        },
        "chakra-placeholder-color": {
          "_light": "gray.500",
          "_dark": "whiteAlpha.400"
        },
        "appBg": "#fff7ec",
        "surfaceBg": "#ffffff",
        "surfaceMutedBg": "#fff0d8",
        "surfaceRaisedBg": "#fffaf2",
        "borderSubtle": "#f3d4a2",
        "borderStrong": "#d89d49",
        "textMuted": "#7a664c",
        "textStrong": "#35230f",
        "successBg": "#ebfbef",
        "successBorder": "#92e0ae",
        "successText": "#16673d",
        "warningBg": "#fff1d9",
        "warningBorder": "#f5b560",
        "warningText": "#8c5300",
        "dangerBg": "#ffeaf0",
        "dangerBorder": "#f8a2b7",
        "dangerText": "#97214a"
      }
    },
    "fonts": {
      "heading": "system-ui, sans-serif",
      "body": "system-ui, sans-serif",
      "mono": "SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace"
    },
    "fontSizes": {
      "3xs": "0.45rem",
      "2xs": "0.625rem",
      "xs": "0.75rem",
      "sm": "0.875rem",
      "md": "1rem",
      "lg": "1.125rem",
      "xl": "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem",
      "6xl": "3.75rem",
      "7xl": "4.5rem",
      "8xl": "6rem",
      "9xl": "8rem"
    },
    "radii": {
      "none": "0",
      "sm": "6px",
      "base": "0.25rem",
      "md": "10px",
      "lg": "16px",
      "xl": "20px",
      "2xl": "28px",
      "3xl": "1.5rem",
      "full": "9999px"
    },
    "styles": {
      "global": {
        "body": {
          "fontFamily": "body",
          "color": "textStrong",
          "bg": "appBg",
          "transitionProperty": "background-color",
          "transitionDuration": "normal",
          "lineHeight": "base"
        },
        "*::placeholder": {
          "color": "chakra-placeholder-color"
        },
        "*, *::before, &::after": {
          "borderColor": "chakra-border-color"
        }
      }
    },
    "config": {
      "useSystemColorMode": false,
      "initialColorMode": "light",
      "cssVarPrefix": "chakra"
    },
    "components": {
      "Button": {
        "defaultProps": {
          "variant": "solid",
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Tabs": {
        "defaultProps": {
          "size": "md",
          "variant": "line",
          "colorScheme": "brand"
        }
      },
      "Progress": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Badge": {
        "defaultProps": {
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Tag": {
        "defaultProps": {
          "size": "md",
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Checkbox": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Radio": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      }
    }
  },
  lego: {
    "colors": {
      "transparent": "transparent",
      "current": "currentColor",
      "black": "#000000",
      "white": "#FFFFFF",
      "whiteAlpha": {
        "50": "rgba(255, 255, 255, 0.04)",
        "100": "rgba(255, 255, 255, 0.06)",
        "200": "rgba(255, 255, 255, 0.08)",
        "300": "rgba(255, 255, 255, 0.16)",
        "400": "rgba(255, 255, 255, 0.24)",
        "500": "rgba(255, 255, 255, 0.36)",
        "600": "rgba(255, 255, 255, 0.48)",
        "700": "rgba(255, 255, 255, 0.64)",
        "800": "rgba(255, 255, 255, 0.80)",
        "900": "rgba(255, 255, 255, 0.92)"
      },
      "blackAlpha": {
        "50": "rgba(0, 0, 0, 0.04)",
        "100": "rgba(0, 0, 0, 0.06)",
        "200": "rgba(0, 0, 0, 0.08)",
        "300": "rgba(0, 0, 0, 0.16)",
        "400": "rgba(0, 0, 0, 0.24)",
        "500": "rgba(0, 0, 0, 0.36)",
        "600": "rgba(0, 0, 0, 0.48)",
        "700": "rgba(0, 0, 0, 0.64)",
        "800": "rgba(0, 0, 0, 0.80)",
        "900": "rgba(0, 0, 0, 0.92)"
      },
      "gray": {
        "50": "#F7FAFC",
        "100": "#EDF2F7",
        "200": "#E2E8F0",
        "300": "#CBD5E0",
        "400": "#A0AEC0",
        "500": "#718096",
        "600": "#4A5568",
        "700": "#2D3748",
        "800": "#1A202C",
        "900": "#171923"
      },
      "red": {
        "50": "#FFF5F5",
        "100": "#FED7D7",
        "200": "#FEB2B2",
        "300": "#FC8181",
        "400": "#F56565",
        "500": "#E53E3E",
        "600": "#C53030",
        "700": "#9B2C2C",
        "800": "#822727",
        "900": "#63171B"
      },
      "orange": {
        "50": "#FFFAF0",
        "100": "#FEEBC8",
        "200": "#FBD38D",
        "300": "#F6AD55",
        "400": "#ED8936",
        "500": "#DD6B20",
        "600": "#C05621",
        "700": "#9C4221",
        "800": "#7B341E",
        "900": "#652B19"
      },
      "yellow": {
        "50": "#FFFFF0",
        "100": "#FEFCBF",
        "200": "#FAF089",
        "300": "#F6E05E",
        "400": "#ECC94B",
        "500": "#D69E2E",
        "600": "#B7791F",
        "700": "#975A16",
        "800": "#744210",
        "900": "#5F370E"
      },
      "green": {
        "50": "#F0FFF4",
        "100": "#C6F6D5",
        "200": "#9AE6B4",
        "300": "#68D391",
        "400": "#48BB78",
        "500": "#38A169",
        "600": "#2F855A",
        "700": "#276749",
        "800": "#22543D",
        "900": "#1C4532"
      },
      "teal": {
        "50": "#E6FFFA",
        "100": "#B2F5EA",
        "200": "#81E6D9",
        "300": "#4FD1C5",
        "400": "#38B2AC",
        "500": "#319795",
        "600": "#2C7A7B",
        "700": "#285E61",
        "800": "#234E52",
        "900": "#1D4044"
      },
      "blue": {
        "50": "#ebf8ff",
        "100": "#bee3f8",
        "200": "#90cdf4",
        "300": "#63b3ed",
        "400": "#4299e1",
        "500": "#3182ce",
        "600": "#2b6cb0",
        "700": "#2c5282",
        "800": "#2a4365",
        "900": "#1A365D"
      },
      "cyan": {
        "50": "#EDFDFD",
        "100": "#C4F1F9",
        "200": "#9DECF9",
        "300": "#76E4F7",
        "400": "#0BC5EA",
        "500": "#00B5D8",
        "600": "#00A3C4",
        "700": "#0987A0",
        "800": "#086F83",
        "900": "#065666"
      },
      "purple": {
        "50": "#FAF5FF",
        "100": "#E9D8FD",
        "200": "#D6BCFA",
        "300": "#B794F4",
        "400": "#9F7AEA",
        "500": "#805AD5",
        "600": "#6B46C1",
        "700": "#553C9A",
        "800": "#44337A",
        "900": "#322659"
      },
      "pink": {
        "50": "#FFF5F7",
        "100": "#FED7E2",
        "200": "#FBB6CE",
        "300": "#F687B3",
        "400": "#ED64A6",
        "500": "#D53F8C",
        "600": "#B83280",
        "700": "#97266D",
        "800": "#702459",
        "900": "#521B41"
      },
      "brand": {
        "50": "#fff3d6",
        "100": "#ffe8a5",
        "200": "#ffda73",
        "300": "#ffcc42",
        "400": "#ffc21f",
        "500": "#f4b400",
        "600": "#d89d00",
        "700": "#ba8600",
        "800": "#9c6f00",
        "900": "#6f5000"
      },
      "success": {
        "50": "#effbe4",
        "100": "#d3f4b5",
        "200": "#b4ec83",
        "300": "#96e250",
        "400": "#7fd925",
        "500": "#67c100",
        "600": "#58a900",
        "700": "#499000",
        "800": "#397600",
        "900": "#264f00"
      },
      "warning": {
        "50": "#fff2dc",
        "100": "#ffd8a7",
        "200": "#ffbc6f",
        "300": "#ff9f39",
        "400": "#ff8916",
        "500": "#f26d00",
        "600": "#d35d00",
        "700": "#b04d00",
        "800": "#8c3c00",
        "900": "#5d2600"
      },
      "danger": {
        "50": "#ffe8e3",
        "100": "#ffc3b6",
        "200": "#ff9986",
        "300": "#ff6f58",
        "400": "#ff4f33",
        "500": "#f23b1f",
        "600": "#d32f17",
        "700": "#b02511",
        "800": "#8d1b0b",
        "900": "#5f1105"
      },
      "neutral": {
        "50": "#fffef9",
        "100": "#f4f0e2",
        "200": "#e3dcc5",
        "300": "#cfc4a5",
        "400": "#b4a77e",
        "500": "#927f58",
        "600": "#6f5f40",
        "700": "#53472f",
        "800": "#392f1f",
        "900": "#221b11"
      }
    },
    "semanticTokens": {
      "colors": {
        "chakra-body-text": {
          "_light": "gray.800",
          "_dark": "whiteAlpha.900"
        },
        "chakra-body-bg": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-border-color": {
          "_light": "gray.200",
          "_dark": "whiteAlpha.300"
        },
        "chakra-inverse-text": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-subtle-bg": {
          "_light": "gray.100",
          "_dark": "gray.700"
        },
        "chakra-subtle-text": {
          "_light": "gray.600",
          "_dark": "gray.400"
        },
        "chakra-placeholder-color": {
          "_light": "gray.500",
          "_dark": "whiteAlpha.400"
        },
        "appBg": "#ffd44c",
        "surfaceBg": "#fff8dd",
        "surfaceMutedBg": "#ffeaa0",
        "surfaceRaisedBg": "#fffdf2",
        "borderSubtle": "#d3980b",
        "borderStrong": "#ad2900",
        "textMuted": "#6d5306",
        "textStrong": "#332100",
        "successBg": "#f0fae7",
        "successBorder": "#8fd943",
        "successText": "#2d6b00",
        "warningBg": "#fff0d9",
        "warningBorder": "#ffb15a",
        "warningText": "#8f4a00",
        "dangerBg": "#ffe8e2",
        "dangerBorder": "#ff8f75",
        "dangerText": "#8f1f00"
      }
    },
    "fonts": {
      "heading": "\"Fredoka\", system-ui, sans-serif",
      "body": "\"Fredoka\", system-ui, sans-serif",
      "mono": "SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace"
    },
    "fontSizes": {
      "3xs": "0.45rem",
      "2xs": "0.625rem",
      "xs": "0.75rem",
      "sm": "0.875rem",
      "md": "1rem",
      "lg": "1.125rem",
      "xl": "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem",
      "6xl": "3.75rem",
      "7xl": "4.5rem",
      "8xl": "6rem",
      "9xl": "8rem"
    },
    "radii": {
      "none": "0",
      "sm": "4px",
      "base": "0.25rem",
      "md": "6px",
      "lg": "10px",
      "xl": "14px",
      "2xl": "18px",
      "3xl": "1.5rem",
      "full": "9999px"
    },
    "styles": {
      "global": {
        "body": {
          "fontFamily": "body",
          "color": "textStrong",
          "bg": "appBg",
          "transitionProperty": "background-color",
          "transitionDuration": "normal",
          "lineHeight": "base",
          "backgroundImage": "linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(180deg, #ffe36e 0%, #ffd44c 100%)",
          "backgroundAttachment": "fixed",
          "backgroundPosition": "center top",
          "backgroundRepeat": "repeat",
          "backgroundSize": "auto"
        },
        "*::placeholder": {
          "color": "chakra-placeholder-color"
        },
        "*, *::before, &::after": {
          "borderColor": "chakra-border-color"
        }
      }
    },
    "config": {
      "useSystemColorMode": false,
      "initialColorMode": "light",
      "cssVarPrefix": "chakra"
    },
    "components": {
      "Button": {
        "defaultProps": {
          "variant": "solid",
          "size": "md",
          "colorScheme": "danger"
        }
      },
      "Tabs": {
        "defaultProps": {
          "size": "md",
          "variant": "line",
          "colorScheme": "brand"
        }
      },
      "Progress": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Badge": {
        "defaultProps": {
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Tag": {
        "defaultProps": {
          "size": "md",
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Checkbox": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Radio": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      }
    }
  },
  minecraft: {
    "colors": {
      "transparent": "transparent",
      "current": "currentColor",
      "black": "#000000",
      "white": "#FFFFFF",
      "whiteAlpha": {
        "50": "rgba(255, 255, 255, 0.04)",
        "100": "rgba(255, 255, 255, 0.06)",
        "200": "rgba(255, 255, 255, 0.08)",
        "300": "rgba(255, 255, 255, 0.16)",
        "400": "rgba(255, 255, 255, 0.24)",
        "500": "rgba(255, 255, 255, 0.36)",
        "600": "rgba(255, 255, 255, 0.48)",
        "700": "rgba(255, 255, 255, 0.64)",
        "800": "rgba(255, 255, 255, 0.80)",
        "900": "rgba(255, 255, 255, 0.92)"
      },
      "blackAlpha": {
        "50": "rgba(0, 0, 0, 0.04)",
        "100": "rgba(0, 0, 0, 0.06)",
        "200": "rgba(0, 0, 0, 0.08)",
        "300": "rgba(0, 0, 0, 0.16)",
        "400": "rgba(0, 0, 0, 0.24)",
        "500": "rgba(0, 0, 0, 0.36)",
        "600": "rgba(0, 0, 0, 0.48)",
        "700": "rgba(0, 0, 0, 0.64)",
        "800": "rgba(0, 0, 0, 0.80)",
        "900": "rgba(0, 0, 0, 0.92)"
      },
      "gray": {
        "50": "#F7FAFC",
        "100": "#EDF2F7",
        "200": "#E2E8F0",
        "300": "#CBD5E0",
        "400": "#A0AEC0",
        "500": "#718096",
        "600": "#4A5568",
        "700": "#2D3748",
        "800": "#1A202C",
        "900": "#171923"
      },
      "red": {
        "50": "#FFF5F5",
        "100": "#FED7D7",
        "200": "#FEB2B2",
        "300": "#FC8181",
        "400": "#F56565",
        "500": "#E53E3E",
        "600": "#C53030",
        "700": "#9B2C2C",
        "800": "#822727",
        "900": "#63171B"
      },
      "orange": {
        "50": "#FFFAF0",
        "100": "#FEEBC8",
        "200": "#FBD38D",
        "300": "#F6AD55",
        "400": "#ED8936",
        "500": "#DD6B20",
        "600": "#C05621",
        "700": "#9C4221",
        "800": "#7B341E",
        "900": "#652B19"
      },
      "yellow": {
        "50": "#FFFFF0",
        "100": "#FEFCBF",
        "200": "#FAF089",
        "300": "#F6E05E",
        "400": "#ECC94B",
        "500": "#D69E2E",
        "600": "#B7791F",
        "700": "#975A16",
        "800": "#744210",
        "900": "#5F370E"
      },
      "green": {
        "50": "#F0FFF4",
        "100": "#C6F6D5",
        "200": "#9AE6B4",
        "300": "#68D391",
        "400": "#48BB78",
        "500": "#38A169",
        "600": "#2F855A",
        "700": "#276749",
        "800": "#22543D",
        "900": "#1C4532"
      },
      "teal": {
        "50": "#E6FFFA",
        "100": "#B2F5EA",
        "200": "#81E6D9",
        "300": "#4FD1C5",
        "400": "#38B2AC",
        "500": "#319795",
        "600": "#2C7A7B",
        "700": "#285E61",
        "800": "#234E52",
        "900": "#1D4044"
      },
      "blue": {
        "50": "#ebf8ff",
        "100": "#bee3f8",
        "200": "#90cdf4",
        "300": "#63b3ed",
        "400": "#4299e1",
        "500": "#3182ce",
        "600": "#2b6cb0",
        "700": "#2c5282",
        "800": "#2a4365",
        "900": "#1A365D"
      },
      "cyan": {
        "50": "#EDFDFD",
        "100": "#C4F1F9",
        "200": "#9DECF9",
        "300": "#76E4F7",
        "400": "#0BC5EA",
        "500": "#00B5D8",
        "600": "#00A3C4",
        "700": "#0987A0",
        "800": "#086F83",
        "900": "#065666"
      },
      "purple": {
        "50": "#FAF5FF",
        "100": "#E9D8FD",
        "200": "#D6BCFA",
        "300": "#B794F4",
        "400": "#9F7AEA",
        "500": "#805AD5",
        "600": "#6B46C1",
        "700": "#553C9A",
        "800": "#44337A",
        "900": "#322659"
      },
      "pink": {
        "50": "#FFF5F7",
        "100": "#FED7E2",
        "200": "#FBB6CE",
        "300": "#F687B3",
        "400": "#ED64A6",
        "500": "#D53F8C",
        "600": "#B83280",
        "700": "#97266D",
        "800": "#702459",
        "900": "#521B41"
      },
      "brand": {
        "50": "#edf5e1",
        "100": "#d8e7bf",
        "200": "#c0d69a",
        "300": "#a4c26f",
        "400": "#8eb04d",
        "500": "#759a2f",
        "600": "#648526",
        "700": "#536f1e",
        "800": "#425917",
        "900": "#2b3b0c"
      },
      "success": {
        "50": "#ebf7e7",
        "100": "#cfe8c5",
        "200": "#b2d8a2",
        "300": "#93c87d",
        "400": "#79b962",
        "500": "#5f9d47",
        "600": "#52883b",
        "700": "#46722f",
        "800": "#385c24",
        "900": "#243a14"
      },
      "warning": {
        "50": "#fdf2db",
        "100": "#f2ddb0",
        "200": "#e5c682",
        "300": "#d7ae54",
        "400": "#ca9a31",
        "500": "#b48014",
        "600": "#9c6f0f",
        "700": "#835d0a",
        "800": "#6b4b06",
        "900": "#442e00"
      },
      "danger": {
        "50": "#f8e8e0",
        "100": "#e9c2b0",
        "200": "#d89a80",
        "300": "#c67253",
        "400": "#b95234",
        "500": "#a53c1b",
        "600": "#8f3315",
        "700": "#782a10",
        "800": "#61220b",
        "900": "#3f1404"
      },
      "neutral": {
        "50": "#f3f0eb",
        "100": "#ddd3c5",
        "200": "#c3b49f",
        "300": "#a89379",
        "400": "#8b755a",
        "500": "#6d583f",
        "600": "#584731",
        "700": "#453726",
        "800": "#32271b",
        "900": "#211811"
      }
    },
    "semanticTokens": {
      "colors": {
        "chakra-body-text": {
          "_light": "gray.800",
          "_dark": "whiteAlpha.900"
        },
        "chakra-body-bg": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-border-color": {
          "_light": "gray.200",
          "_dark": "whiteAlpha.300"
        },
        "chakra-inverse-text": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-subtle-bg": {
          "_light": "gray.100",
          "_dark": "gray.700"
        },
        "chakra-subtle-text": {
          "_light": "gray.600",
          "_dark": "gray.400"
        },
        "chakra-placeholder-color": {
          "_light": "gray.500",
          "_dark": "whiteAlpha.400"
        },
        "appBg": "#6b4b2a",
        "surfaceBg": "#f3efe8",
        "surfaceMutedBg": "#ded5c5",
        "surfaceRaisedBg": "#fff9f0",
        "borderSubtle": "#8b755a",
        "borderStrong": "#4a351f",
        "textMuted": "#5d4d3d",
        "textStrong": "#25170a",
        "successBg": "#edf7e7",
        "successBorder": "#9dc77a",
        "successText": "#30561c",
        "warningBg": "#f8ecd2",
        "warningBorder": "#caa04c",
        "warningText": "#6a4708",
        "dangerBg": "#f7e9e2",
        "dangerBorder": "#c9886e",
        "dangerText": "#6e2410"
      }
    },
    "fonts": {
      "heading": "\"Press Start 2P\", \"Trebuchet MS\", monospace",
      "body": "\"VT323\", \"Trebuchet MS\", monospace",
      "mono": "SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace"
    },
    "fontSizes": {
      "3xs": "0.45rem",
      "2xs": "0.625rem",
      "xs": "0.8rem",
      "sm": "0.95rem",
      "md": "1.12rem",
      "lg": "1.25rem",
      "xl": "1.35rem",
      "2xl": "1.5rem",
      "3xl": "1.8rem",
      "4xl": "2.1rem",
      "5xl": "3rem",
      "6xl": "3.75rem",
      "7xl": "4.5rem",
      "8xl": "6rem",
      "9xl": "8rem"
    },
    "radii": {
      "none": "0",
      "sm": "2px",
      "base": "0.25rem",
      "md": "4px",
      "lg": "6px",
      "xl": "8px",
      "2xl": "10px",
      "3xl": "1.5rem",
      "full": "9999px"
    },
    "styles": {
      "global": {
        "body": {
          "fontFamily": "body",
          "color": "textStrong",
          "bg": "appBg",
          "transitionProperty": "background-color",
          "transitionDuration": "normal",
          "lineHeight": "base",
          "backgroundImage": "linear-gradient(180deg, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.03) 50%), linear-gradient(90deg, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.03) 50%), linear-gradient(180deg, #7aa35a 0%, #5a7a3d 18%, #6b4b2a 18%, #6b4b2a 100%)",
          "backgroundAttachment": "fixed",
          "backgroundPosition": "center top",
          "backgroundRepeat": "repeat",
          "backgroundSize": "auto"
        },
        "*::placeholder": {
          "color": "chakra-placeholder-color"
        },
        "*, *::before, &::after": {
          "borderColor": "chakra-border-color"
        }
      }
    },
    "config": {
      "useSystemColorMode": false,
      "initialColorMode": "light",
      "cssVarPrefix": "chakra"
    },
    "components": {
      "Button": {
        "defaultProps": {
          "variant": "solid",
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Tabs": {
        "defaultProps": {
          "size": "md",
          "variant": "line",
          "colorScheme": "brand"
        }
      },
      "Progress": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Badge": {
        "defaultProps": {
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Tag": {
        "defaultProps": {
          "size": "md",
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Checkbox": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Radio": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      }
    }
  },
  flower: {
    "colors": {
      "transparent": "transparent",
      "current": "currentColor",
      "black": "#000000",
      "white": "#FFFFFF",
      "whiteAlpha": {
        "50": "rgba(255, 255, 255, 0.04)",
        "100": "rgba(255, 255, 255, 0.06)",
        "200": "rgba(255, 255, 255, 0.08)",
        "300": "rgba(255, 255, 255, 0.16)",
        "400": "rgba(255, 255, 255, 0.24)",
        "500": "rgba(255, 255, 255, 0.36)",
        "600": "rgba(255, 255, 255, 0.48)",
        "700": "rgba(255, 255, 255, 0.64)",
        "800": "rgba(255, 255, 255, 0.80)",
        "900": "rgba(255, 255, 255, 0.92)"
      },
      "blackAlpha": {
        "50": "rgba(0, 0, 0, 0.04)",
        "100": "rgba(0, 0, 0, 0.06)",
        "200": "rgba(0, 0, 0, 0.08)",
        "300": "rgba(0, 0, 0, 0.16)",
        "400": "rgba(0, 0, 0, 0.24)",
        "500": "rgba(0, 0, 0, 0.36)",
        "600": "rgba(0, 0, 0, 0.48)",
        "700": "rgba(0, 0, 0, 0.64)",
        "800": "rgba(0, 0, 0, 0.80)",
        "900": "rgba(0, 0, 0, 0.92)"
      },
      "gray": {
        "50": "#F7FAFC",
        "100": "#EDF2F7",
        "200": "#E2E8F0",
        "300": "#CBD5E0",
        "400": "#A0AEC0",
        "500": "#718096",
        "600": "#4A5568",
        "700": "#2D3748",
        "800": "#1A202C",
        "900": "#171923"
      },
      "red": {
        "50": "#FFF5F5",
        "100": "#FED7D7",
        "200": "#FEB2B2",
        "300": "#FC8181",
        "400": "#F56565",
        "500": "#E53E3E",
        "600": "#C53030",
        "700": "#9B2C2C",
        "800": "#822727",
        "900": "#63171B"
      },
      "orange": {
        "50": "#FFFAF0",
        "100": "#FEEBC8",
        "200": "#FBD38D",
        "300": "#F6AD55",
        "400": "#ED8936",
        "500": "#DD6B20",
        "600": "#C05621",
        "700": "#9C4221",
        "800": "#7B341E",
        "900": "#652B19"
      },
      "yellow": {
        "50": "#FFFFF0",
        "100": "#FEFCBF",
        "200": "#FAF089",
        "300": "#F6E05E",
        "400": "#ECC94B",
        "500": "#D69E2E",
        "600": "#B7791F",
        "700": "#975A16",
        "800": "#744210",
        "900": "#5F370E"
      },
      "green": {
        "50": "#F0FFF4",
        "100": "#C6F6D5",
        "200": "#9AE6B4",
        "300": "#68D391",
        "400": "#48BB78",
        "500": "#38A169",
        "600": "#2F855A",
        "700": "#276749",
        "800": "#22543D",
        "900": "#1C4532"
      },
      "teal": {
        "50": "#E6FFFA",
        "100": "#B2F5EA",
        "200": "#81E6D9",
        "300": "#4FD1C5",
        "400": "#38B2AC",
        "500": "#319795",
        "600": "#2C7A7B",
        "700": "#285E61",
        "800": "#234E52",
        "900": "#1D4044"
      },
      "blue": {
        "50": "#ebf8ff",
        "100": "#bee3f8",
        "200": "#90cdf4",
        "300": "#63b3ed",
        "400": "#4299e1",
        "500": "#3182ce",
        "600": "#2b6cb0",
        "700": "#2c5282",
        "800": "#2a4365",
        "900": "#1A365D"
      },
      "cyan": {
        "50": "#EDFDFD",
        "100": "#C4F1F9",
        "200": "#9DECF9",
        "300": "#76E4F7",
        "400": "#0BC5EA",
        "500": "#00B5D8",
        "600": "#00A3C4",
        "700": "#0987A0",
        "800": "#086F83",
        "900": "#065666"
      },
      "purple": {
        "50": "#FAF5FF",
        "100": "#E9D8FD",
        "200": "#D6BCFA",
        "300": "#B794F4",
        "400": "#9F7AEA",
        "500": "#805AD5",
        "600": "#6B46C1",
        "700": "#553C9A",
        "800": "#44337A",
        "900": "#322659"
      },
      "pink": {
        "50": "#FFF5F7",
        "100": "#FED7E2",
        "200": "#FBB6CE",
        "300": "#F687B3",
        "400": "#ED64A6",
        "500": "#D53F8C",
        "600": "#B83280",
        "700": "#97266D",
        "800": "#702459",
        "900": "#521B41"
      },
      "brand": {
        "50": "#fff1f7",
        "100": "#ffdbe9",
        "200": "#ffc3db",
        "300": "#ffa7cb",
        "400": "#ff8abc",
        "500": "#f468a8",
        "600": "#db4d8f",
        "700": "#bd3977",
        "800": "#98285d",
        "900": "#68153d"
      },
      "success": {
        "50": "#eef9ea",
        "100": "#d7efcb",
        "200": "#bce4aa",
        "300": "#9fd988",
        "400": "#84cd68",
        "500": "#69c149",
        "600": "#57aa39",
        "700": "#46912d",
        "800": "#367221",
        "900": "#214713"
      },
      "warning": {
        "50": "#fff7e5",
        "100": "#ffe8bd",
        "200": "#ffd893",
        "300": "#ffc968",
        "400": "#ffbb47",
        "500": "#f3a723",
        "600": "#d78f16",
        "700": "#b7760f",
        "800": "#915c09",
        "900": "#603906"
      },
      "danger": {
        "50": "#ffecef",
        "100": "#ffcfd9",
        "200": "#ffb0c1",
        "300": "#ff91aa",
        "400": "#f87595",
        "500": "#ea557d",
        "600": "#cd3f67",
        "700": "#ab3154",
        "800": "#862542",
        "900": "#5a162b"
      },
      "neutral": {
        "50": "#fffdfc",
        "100": "#f9f1ef",
        "200": "#f0e3e0",
        "300": "#e4d2cf",
        "400": "#cfb8b4",
        "500": "#b19894",
        "600": "#8c7572",
        "700": "#6a5754",
        "800": "#473a38",
        "900": "#2a2120"
      }
    },
    "semanticTokens": {
      "colors": {
        "chakra-body-text": {
          "_light": "gray.800",
          "_dark": "whiteAlpha.900"
        },
        "chakra-body-bg": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-border-color": {
          "_light": "gray.200",
          "_dark": "whiteAlpha.300"
        },
        "chakra-inverse-text": {
          "_light": "white",
          "_dark": "gray.800"
        },
        "chakra-subtle-bg": {
          "_light": "gray.100",
          "_dark": "gray.700"
        },
        "chakra-subtle-text": {
          "_light": "gray.600",
          "_dark": "gray.400"
        },
        "chakra-placeholder-color": {
          "_light": "gray.500",
          "_dark": "whiteAlpha.400"
        },
        "appBg": "#fff3f7",
        "surfaceBg": "#fffdfc",
        "surfaceMutedBg": "#ffe7f0",
        "surfaceRaisedBg": "#fffaf4",
        "borderSubtle": "#f1c6d8",
        "borderStrong": "#d96a9d",
        "textMuted": "#7b5c69",
        "textStrong": "#41222f",
        "successBg": "#eef8eb",
        "successBorder": "#a8d791",
        "successText": "#2f6b28",
        "warningBg": "#fff5df",
        "warningBorder": "#f0c36b",
        "warningText": "#8a5a0f",
        "dangerBg": "#ffeef2",
        "dangerBorder": "#f3a1b8",
        "dangerText": "#94284c"
      }
    },
    "fonts": {
      "heading": "\"DM Serif Display\", Georgia, serif",
      "body": "\"Nunito\", system-ui, sans-serif",
      "mono": "SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace"
    },
    "fontSizes": {
      "3xs": "0.45rem",
      "2xs": "0.625rem",
      "xs": "0.75rem",
      "sm": "0.875rem",
      "md": "1rem",
      "lg": "1.125rem",
      "xl": "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem",
      "6xl": "3.75rem",
      "7xl": "4.5rem",
      "8xl": "6rem",
      "9xl": "8rem"
    },
    "radii": {
      "none": "0",
      "sm": "10px",
      "base": "0.25rem",
      "md": "16px",
      "lg": "22px",
      "xl": "28px",
      "2xl": "34px",
      "3xl": "1.5rem",
      "full": "9999px"
    },
    "styles": {
      "global": {
        "body": {
          "fontFamily": "body",
          "color": "textStrong",
          "bg": "appBg",
          "transitionProperty": "background-color",
          "transitionDuration": "normal",
          "lineHeight": "base",
          "backgroundImage": "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.55) 0 14px, transparent 15px), radial-gradient(circle at 80% 24%, rgba(255,255,255,0.45) 0 12px, transparent 13px), radial-gradient(circle at 30% 78%, rgba(255,255,255,0.4) 0 10px, transparent 11px), linear-gradient(180deg, #ffe7f1 0%, #ffd6e7 45%, #ffecc7 100%)",
          "backgroundAttachment": "fixed",
          "backgroundPosition": "center top",
          "backgroundRepeat": "repeat",
          "backgroundSize": "auto"
        },
        "*::placeholder": {
          "color": "chakra-placeholder-color"
        },
        "*, *::before, &::after": {
          "borderColor": "chakra-border-color"
        }
      }
    },
    "config": {
      "useSystemColorMode": false,
      "initialColorMode": "light",
      "cssVarPrefix": "chakra"
    },
    "components": {
      "Button": {
        "defaultProps": {
          "variant": "solid",
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Tabs": {
        "defaultProps": {
          "size": "md",
          "variant": "line",
          "colorScheme": "brand"
        }
      },
      "Progress": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Badge": {
        "defaultProps": {
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Tag": {
        "defaultProps": {
          "size": "md",
          "variant": "subtle",
          "colorScheme": "brand"
        }
      },
      "Checkbox": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      },
      "Radio": {
        "defaultProps": {
          "size": "md",
          "colorScheme": "brand"
        }
      }
    }
  },
};
