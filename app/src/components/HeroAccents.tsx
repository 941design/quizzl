// app/src/components/HeroAccents.tsx
//
// A FEW large, soft, themed watercolor blobs used as decorative accents behind
// a hero/landing section — NOT a full-cover wash. Only the active theme's
// COLOUR identity + a transparent base are pinned; zones and every shape
// parameter are left to the ink library's own randomizeParams(), so each blob
// differs in zone count and shape. Client-only (SSR renders nothing until the
// blobs are generated on mount / theme change).
//
// The parent MUST be `position: relative; overflow: hidden` — the blobs are
// absolutely positioned and bleed past the edges (clipped by the parent).
// Shared by the real start page (pages/index.tsx) and the dev theme-preview
// hero so both render identically.
import { useEffect, useState } from 'react';
import { Box } from '@chakra-ui/react';
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import { DYNAMIC_GENERATORS } from '@/src/themes/treatments/dynamicVisuals';

/**
 * Wraps an SVG string as a CSS `url(...)` data-URI. Base64 (not
 * percent-encoding) because a watercolor SVG contains raw `)`, `#`, `,`
 * (e.g. `filter: url(#edge-…)`) that break CSS `url()` parsing. SSR-safe.
 */
function svgToDataUri(svg: string): string {
  const base64 =
    typeof window !== 'undefined'
      ? window.btoa(unescape(encodeURIComponent(svg)))
      : Buffer.from(svg, 'utf8').toString('base64');
  return `url("data:image/svg+xml;base64,${base64}")`;
}

// Fade the square canvas edges to transparency so each accent reads as a soft
// organic blob rather than a tinted square.
const BLOB_MASK = 'radial-gradient(circle at center, #000 42%, transparent 70%)';

// Placement of the (up to) three accents around the section corners, matching
// the theme-preview hero.
const ACCENTS = [
  { size: { base: '220px', md: '400px' }, pos: { top: '-26%', left: '-12%' } },
  { size: { base: '280px', md: '500px' }, pos: { bottom: '-28%', right: '-12%' } },
  { size: { base: '260px', md: '300px' }, pos: { bottom: '-24%', left: '-8%' }, mdOnly: true },
] as const;

export default function HeroAccents() {
  const { themeName, activeThemeDefinition } = useAppTheme();
  const [blobs, setBlobs] = useState<string[]>([]);

  useEffect(() => {
    const dyn = activeThemeDefinition.treatments.dynamic?.banner;
    if (!dyn) {
      setBlobs([]);
      return;
    }
    const transparentBase = `${activeThemeDefinition.colors.appBg}00`;
    try {
      setBlobs(
        [0, 1, 2].map(() =>
          DYNAMIC_GENERATORS.watercolor(dyn.style, 'banner', {
            baseColor: transparentBase, // soft accents, not an opaque square
            width: 600,
            height: 600,
          }),
        ),
      );
    } catch {
      setBlobs([]);
    }
  }, [themeName, activeThemeDefinition]);

  return (
    <>
      {ACCENTS.map((a, i) =>
        blobs[i] ? (
          <Box
            key={i}
            aria-hidden
            position="absolute"
            pointerEvents="none"
            opacity={0.6}
            w={a.size}
            h={a.size}
            display={'mdOnly' in a && a.mdOnly ? { base: 'none', md: 'block' } : undefined}
            {...a.pos}
            style={{
              backgroundImage: svgToDataUri(blobs[i]),
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              mixBlendMode: 'multiply',
              maskImage: BLOB_MASK,
              WebkitMaskImage: BLOB_MASK,
            }}
          />
        ) : null,
      )}
    </>
  );
}
