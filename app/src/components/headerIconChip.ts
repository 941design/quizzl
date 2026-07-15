// Shared chip styling for every symbol in the header (contacts, groups, info,
// bell, settings). They all sit on the same permanently-filled 40x40 square so
// the row reads as one set of controls rather than bare glyphs floating on the
// banner art. Hover shifts the icon to the brand color — the background can no
// longer signal hover now that it is always on.
//
// Lives outside Layout.tsx because NotificationBell consumes it too, and Layout
// imports NotificationBell (importing back would be a cycle).
export const headerIconChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  w: 10,
  h: 10,
  borderRadius: 'md',
  position: 'relative',
  bg: 'surfaceMutedBg',
  _hover: { color: 'brand.500', textDecoration: 'none' },
  _focusVisible: { boxShadow: 'outline' },
} as const;
