# app/src/themes/

This directory holds the app's pluggable theme system: one self-contained
`<id>/manifest.ts` folder per theme, plus the shared schema, contrast checker,
treatment catalog (`treatments/`), font-union helper, Chakra theme builder, and
the generated registry that wires them all together. To add a new theme, drop a
folder with a `manifest.ts` here — no shared file needs editing.

**Full authoring reference:** see
[`docs/themes/authoring-guide.md`](../../../docs/themes/authoring-guide.md) for the
complete `ThemeManifest` field reference, the treatment catalog, contrast
requirements, typography/font declaration, localization, `status` behavior, how to
run validation locally, and a fully worked sample theme.
