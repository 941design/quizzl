import React from 'react';
import { Icon } from '@iconify/react';
import { useAppTheme } from '@/src/hooks/useMoodTheme';

/**
 * Maps semantic icon names to icon identifiers per visual style.
 *
 * - "pixel" uses pixelarticons (MIT, 24x24 pixel art style)
 * - "toy" uses ph:*-fill (Phosphor filled, playful weight)
 * - default uses ph:*-bold (Phosphor bold, clean line style)
 */
const ICON_MAP: Record<string, Record<string, string>> = {
  heart: {
    pixel: 'pixelarticons:heart',
    toy: 'ph:heart-fill',
    default: 'ph:heart-bold',
  },
  check: {
    pixel: 'pixelarticons:check',
    toy: 'ph:check-circle-fill',
    default: 'ph:check-circle-bold',
  },
  close: {
    pixel: 'pixelarticons:close',
    toy: 'ph:x-circle-fill',
    default: 'ph:x-circle-bold',
  },
  home: {
    pixel: 'pixelarticons:home',
    toy: 'ph:house-fill',
    default: 'ph:house-bold',
  },
  settings: {
    pixel: 'pixelarticons:sliders',
    toy: 'ph:gear-fill',
    default: 'ph:gear-bold',
  },
  clock: {
    pixel: 'pixelarticons:clock',
    toy: 'ph:clock-fill',
    default: 'ph:clock-bold',
  },
  prev: {
    pixel: 'pixelarticons:chevron-left',
    toy: 'ph:caret-left-fill',
    default: 'ph:caret-left-bold',
  },
  next: {
    pixel: 'pixelarticons:chevron-right',
    toy: 'ph:caret-right-fill',
    default: 'ph:caret-right-bold',
  },
  bell: {
    pixel: 'pixelarticons:notification',
    toy: 'ph:bell-ringing-fill',
    default: 'ph:bell-bold',
  },
  person: {
    pixel: 'pixelarticons:user',
    toy: 'ph:user-circle-fill',
    default: 'ph:user-circle-bold',
  },
};

type ThemeIconProps = {
  name: string;
  size?: number | string;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean;
};

export default function ThemeIcon({
  name,
  size = 20,
  color,
  className,
  style,
  'aria-hidden': ariaHidden = true,
}: ThemeIconProps) {
  const { activeThemeDefinition } = useAppTheme();
  const vs = activeThemeDefinition.visualStyle;

  const iconSet = ICON_MAP[name];
  if (!iconSet) {
    return null;
  }

  const iconId = iconSet[vs] ?? iconSet.default;

  return (
    <Icon
      icon={iconId}
      width={size}
      height={size}
      color={color}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden={ariaHidden}
    />
  );
}

/** Get the raw icon identifier for use in non-React contexts */
export function getThemeIconId(name: string, visualStyle: string): string {
  const iconSet = ICON_MAP[name];
  if (!iconSet) return '';
  return iconSet[visualStyle] ?? iconSet.default;
}
