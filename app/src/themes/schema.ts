// app/src/themes/schema.ts
//
// zod ThemeManifestSchema + inferred `ThemeManifest` type + validateManifest().
//
// This is the ONLY module in app/src/themes/ allowed a RUNTIME import of `zod`
// (architecture.md Boundary Rules; AC-BOUND-1). Every other client-bundle-
// reachable module in this tree must import `ThemeManifest` as a TYPE ONLY
// (`import type { ThemeManifest } from './schema'`), never at runtime, so
// `zod` never enters the client bundle.
//
// The manifest itself is pure data per spec.md §6.2: no Chakra import, no
// functions, fully serializable/zod-validatable. Enum-like fields
// (ElevationName, SurfacePatternName, IconSetName, ContentPanelName) are
// declared as literal unions INLINE here rather than imported from
// treatments/* — architecture.md's Boundary Rules do not grant schema.ts an
// edge to treatments/*, so the same literal values are independently
// declared in both places. They must be kept in sync by hand; see the
// authoring guide (S5) for the canonical treatment catalog.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitive schemas
// ---------------------------------------------------------------------------

/** A localized string: English required, German optional (falls back to `en`). */
const LocalizedStringSchema = z
  .object({
    en: z.string().min(1),
    de: z.string().min(1).optional(),
  })
  .strict();

/**
 * A 10-step color scale expressed as an ordered tuple of hex/CSS color
 * strings, corresponding to steps [50, 100, 200, 300, 400, 500, 600, 700,
 * 800, 900] in that order. `createScale()` in buildChakraTheme.ts expands
 * this tuple into the `Record<number, string>` shape Chakra's `colors` theme
 * slot expects — kept as a flat tuple here (rather than pre-expanded) so
 * manifests can copy the same literal array style `theme.ts`'s themes used
 * pre-refactor (byte-identical migration, spec.md §6.8).
 */
const Scale10Schema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
]);

const ThemeColorSchemeSchema = z.enum(['brand', 'success', 'warning', 'danger']);

const ColorsSchema = z
  .object({
    brand: Scale10Schema,
    success: Scale10Schema,
    warning: Scale10Schema,
    danger: Scale10Schema,
    neutral: Scale10Schema,
    appBg: z.string(),
    backgroundImage: z.string().optional(),
    surfaceBg: z.string(),
    surfaceMutedBg: z.string(),
    surfaceRaisedBg: z.string(),
    borderSubtle: z.string(),
    borderStrong: z.string(),
    textMuted: z.string(),
    textStrong: z.string(),
    successBg: z.string(),
    successBorder: z.string(),
    successText: z.string(),
    warningBg: z.string(),
    warningBorder: z.string(),
    warningText: z.string(),
    dangerBg: z.string(),
    dangerBorder: z.string(),
    dangerText: z.string(),
    buttonColorScheme: ThemeColorSchemeSchema,
  })
  .strict();

/**
 * FontLoad — sufficient to reproduce a Google Fonts CSS2 request line for one
 * family (see fontUnion.ts's `buildFontLinkHref`). Structurally duplicated
 * here (not imported) because schema.ts has no declared dependency edge to
 * fontUnion.ts.
 */
const FontLoadSchema = z
  .object({
    family: z.string().min(1),
    weights: z.array(z.number().int().positive()).optional(),
    ital: z.boolean().optional(),
    subset: z.string().optional(),
  })
  .strict();

const TypographySchema = z
  .object({
    fonts: z
      .object({
        heading: z.string().min(1),
        body: z.string().min(1),
        display: z.string().optional(),
      })
      .strict(),
    fontLoad: z.array(FontLoadSchema),
    fontSizes: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const ShapeSchema = z
  .object({
    radii: z.record(z.string(), z.string()).optional(),
    borderWidths: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/** Matches treatments/elevation.ts's ElevationName (kept in sync by hand). */
const ElevationNameSchema = z.enum(['flat', 'softDrop', 'hardDrop', 'pixelBevel', 'floralGlow']);
/** Matches treatments/patterns.ts's SurfacePatternName. */
const SurfacePatternNameSchema = z.enum(['none', 'studs', 'grid', 'petals']);
/** Matches treatments/iconSets.ts's IconSetName. */
const IconSetNameSchema = z.enum(['line', 'filled', 'pixel']);
/** Matches treatments/elevation.ts's ContentPanelName. */
const ContentPanelNameSchema = z.enum(['panel']);

/**
 * Raw Chakra prop escape hatch, keyed by the surface it overrides. Left
 * permissive (`z.record(z.string(), z.unknown())` per surface) since zod
 * cannot meaningfully validate arbitrary Chakra style-prop shapes; the
 * authoring guide (S5) documents this escape hatch's stated limits (§3).
 */
const RawOverridesSchema = z
  .object({
    card: z.record(z.string(), z.unknown()).optional(),
    button: z.record(z.string(), z.unknown()).optional(),
    nav: z.record(z.string(), z.unknown()).optional(),
    surface: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const TreatmentsSchema = z
  .object({
    card: ElevationNameSchema,
    button: ElevationNameSchema,
    nav: ElevationNameSchema,
    surface: SurfacePatternNameSchema,
    iconSet: IconSetNameSchema,
    banner: z.string(),
    contentPanel: ContentPanelNameSchema.optional(),
    overrides: RawOverridesSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// ThemeManifest
// ---------------------------------------------------------------------------

/**
 * The full per-theme manifest shape. `.strict()` at every object level
 * rejects unexpected/extra keys rather than silently passing them through
 * (so a typo'd or stray field fails loudly at `validateManifest()` time).
 */
export const ThemeManifestSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, 'id must match ^[a-z][a-z0-9-]*$ and equal the folder basename'),
    order: z.number().int().positive(),
    label: LocalizedStringSchema,
    description: LocalizedStringSchema,
    previewColorScheme: ThemeColorSchemeSchema,
    author: z.string().optional(),
    license: z.string().optional(),
    status: z.enum(['stable', 'experimental', 'hidden']).optional(),
    colorScheme: z.enum(['light', 'dark']),
    colors: ColorsSchema,
    typography: TypographySchema,
    shape: ShapeSchema.optional(),
    treatments: TreatmentsSchema,
    contentSurface: z.boolean().optional(),
  })
  .strict();

export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

/**
 * Parses and validates raw data against `ThemeManifestSchema`. Throws
 * (zod's `ZodError`) on any missing/mistyped/extra field rather than
 * silently returning a partially-valid object — callers that want a
 * non-throwing result should use `ThemeManifestSchema.safeParse` directly.
 */
export function validateManifest(data: unknown): ThemeManifest {
  return ThemeManifestSchema.parse(data);
}
