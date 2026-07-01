// app/src/components/ThemeIcon.tsx
//
// Renders a themed icon by resolving `manifest.treatments.iconSet`
// (canonical path — architecture.md's Implementation Constraint 10) against
// `treatments/iconSets.ts`'s icon-name -> iconify-id maps (S1 moved
// `ICON_MAP` there, renamed to `ICON_SETS`, and renamed its sub-keys to the
// manifest vocabulary: `default` -> `line`, `toy` -> `filled`, `pixel` ->
// `pixel`). Every currently-mapped icon name resolves to the same iconify id
// per theme as the pre-refactor `ICON_MAP` (AC-UX-2 / AC11).
//
// Boundary Rules: ThemeIcon -> treatments/iconSets (value), lib/theme (type
// only for the hook's definition shape, sourced indirectly via useAppTheme).
import React from 'react';
import { Icon } from '@iconify/react';
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import { resolveIconId, type IconSetName } from '@/src/themes/treatments/iconSets';

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
  const iconId = resolveIconId(name, activeThemeDefinition.treatments.iconSet);

  if (!iconId) {
    return null;
  }

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

/** Get the raw icon identifier for use in non-React contexts. */
export function getThemeIconId(name: string, iconSet: IconSetName): string {
  return resolveIconId(name, iconSet);
}
