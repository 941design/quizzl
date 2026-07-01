// app/scripts/generate-theme-registry.mjs
//
// Structural-only codegen for app/src/themes/registry.generated.ts
// (architecture.md Module Map + Implementation Constraint 8). Plain Node
// ESM — imports only node:fs/promises, node:path, node:url. NEVER imports
// or evaluates TypeScript: the emitted file's `APP_THEMES`/`THEME_FONTS`
// are computed by the hand-written helpers (order-sort + `buildThemeFonts`)
// *inside the emitted TS itself*, at bundler/vitest evaluation time — this
// script only detects which folders exist and are structurally valid, and
// stitches together the import/union/array boilerplate around them.
//
// Structural checks (the ONLY checks a plain filesystem glob can perform):
//   - the folder contains a manifest.ts file
//   - the folder name matches ^[a-z][a-z0-9-]*$
// All VALUE-level checks (id === folder, contrast, order uniqueness,
// font-URL parity, zod boundary, ...) run in
// app/tests/unit/themes-validation.test.ts, which imports TypeScript
// natively via vitest and therefore CAN evaluate the manifests. Wiring:
// app/package.json's `prebuild` runs this script, then that vitest suite,
// before `next build` (AC-DEP-1/AC-DEP-2).
//
// `--check` mode regenerates the file in memory and exits non-zero if it
// differs from the committed `registry.generated.ts` (AC-STRUCT-3
// idempotence gate for CI) — it never writes in this mode.
//
// Every function below is parameterized on `themesDir`/`outputPath` (rather
// than hardcoding the real app/src/themes path) and exported, so
// themes-validation.test.ts's AC-STRUCT-4 fixture tests can drive the real
// generator logic against a temporary folder set without ever touching the
// committed registry (see that test file for the add-a-folder /
// remove-a-folder assertions). The CLI entry point at the bottom of this
// file is guarded to run only when this script is executed directly (`node
// scripts/generate-theme-registry.mjs`), never as a side effect of being
// imported by a test.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..');
export const DEFAULT_THEMES_DIR = path.join(APP_ROOT, 'src', 'themes');
export const DEFAULT_OUTPUT_PATH = path.join(DEFAULT_THEMES_DIR, 'registry.generated.ts');

/** Folder names (and therefore `id`s) must match this — the same regex `schema.ts`'s `id` field enforces. */
export const FOLDER_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Scans `themesDir` for immediate subfolders containing a `manifest.ts`
 * file (excludes `treatments/`, and any non-directory or manifest-less
 * entry — `index.ts`, `schema.ts`, `registry.generated.ts`, `README.md`
 * live directly in `themesDir`, not in a subfolder, so they are never
 * candidates). Returns folder names sorted alphabetically (deterministic,
 * filesystem-derived order — NOT the `order` field, which this script never
 * reads; the emitted file's `_sorted` re-sorts by `order` at eval time
 * regardless of this array's declaration order).
 */
export async function findThemeFolders(themesDir = DEFAULT_THEMES_DIR) {
  const entries = await fs.readdir(themesDir, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  const themeFolders = [];
  for (const folder of folders) {
    const manifestPath = path.join(themesDir, folder, 'manifest.ts');
    try {
      await fs.access(manifestPath);
    } catch {
      continue; // no manifest.ts -> not a theme folder
    }
    themeFolders.push(folder);
  }

  return themeFolders.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Throws if any folder name fails the structural `id`/folder-name regex. */
export function validateFolderNames(folders) {
  const invalid = folders.filter((name) => !FOLDER_NAME_PATTERN.test(name));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid theme folder name(s) — must match ${FOLDER_NAME_PATTERN}: ${invalid.join(', ')}`
    );
  }
}

/** camelCase local identifier for a (possibly dashed) folder name, e.g. "my-theme" -> "myTheme". */
export function toIdentifier(folderName) {
  return folderName.replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
}

/**
 * Renders the full `registry.generated.ts` source for a given (already
 * validated, alphabetically sorted) folder-name list. Pure string
 * templating — no filesystem access.
 */
export function renderRegistrySource(folders) {
  const imports = folders
    .map((folder) => `import { manifest as ${toIdentifier(folder)}Manifest } from './${folder}/manifest';`)
    .join('\n');

  const unionType = folders.map((folder) => `'${folder}'`).join(' | ');

  const allEntries = folders.map((folder) => `  ${toIdentifier(folder)}Manifest,`).join('\n');

  return `// app/src/themes/registry.generated.ts
//
// GENERATED FILE — DO NOT EDIT BY HAND.
// Produced by app/scripts/generate-theme-registry.mjs from the set of
// app/src/themes/*/ folders containing a manifest.ts (architecture.md
// Module Map + Implementation Constraint 8). Re-run
// \`node scripts/generate-theme-registry.mjs\` after adding or removing a
// theme folder — the \`prebuild\` npm script does this automatically before
// every build (app/package.json).
//
// This file performs only the structural scaffold: one static import per
// theme, the \`AppThemeName\` union derived from folder names, an \`_all\`
// array, and wiring that calls the hand-written helpers (\`buildThemeFonts\`,
// order-sort) AT EVALUATION TIME. \`APP_THEMES\`/\`THEME_FONTS\` are therefore
// computed here in this emitted TS, not by the generator script itself — the
// generator never imports or evaluates TypeScript (Implementation
// Constraint 8).
//
// Boundary Rules: registry.generated -> manifests (static import), schema
// (TYPE ONLY), fontUnion (\`buildThemeFonts\` value import). No edge to
// buildChakraTheme.ts — the registry carries data only.
${imports}
import type { ThemeManifest } from './schema';
import { buildThemeFonts, type FontLoad } from './fontUnion';

/**
 * The \`AppThemeName\` union, derived mechanically from the theme folder
 * names present under app/src/themes/ at generation time.
 */
export type AppThemeName = ${unionType};

/**
 * One entry per theme folder, in generator-scan (alphabetical folder-name)
 * order — NOT order-sorted; see \`_sorted\` below.
 */
const _all: ThemeManifest[] = [
${allEntries}
];

/**
 * \`order\`-ascending sort, computed here at eval time (not by the generator
 * — Implementation Constraint 8).
 */
const _sorted: ThemeManifest[] = [..._all].sort((a, b) => a.order - b.order);

/**
 * \`Record<AppThemeName, ThemeManifest>\`, keyed by each manifest's own
 * \`id\`, insertion-ordered by \`order\` ascending. Contains ALL themes,
 * including any \`status: 'hidden'\` entry — filtering for display is
 * \`listThemes()\` (architecture.md Implementation Constraint 14).
 */
export const APP_THEMES: Record<AppThemeName, ThemeManifest> = Object.fromEntries(
  _sorted.map((m) => [m.id, m])
) as Record<AppThemeName, ThemeManifest>;

/**
 * The deduplicated \`FontLoad[]\` union across all manifests, computed from
 * the \`order\`-sorted manifest list via \`fontUnion.ts\`'s \`buildThemeFonts\`
 * (Implementation Constraint 8). Consumed directly by \`_document.tsx\`.
 */
export const THEME_FONTS: FontLoad[] = buildThemeFonts(_sorted);
`;
}

/**
 * Runs the full generate (or `--check`) flow against `themesDir`/
 * `outputPath`. Returns `{ folders, source }` on success (both write mode
 * and check mode); throws on any structural violation, on an empty theme
 * set, or (check mode only) on a diff against the committed file.
 */
export async function generate({ themesDir = DEFAULT_THEMES_DIR, outputPath = DEFAULT_OUTPUT_PATH, check = false } = {}) {
  const folders = await findThemeFolders(themesDir);
  if (folders.length === 0) {
    throw new Error(`No theme folders (containing manifest.ts) found under ${themesDir}`);
  }

  validateFolderNames(folders);

  const source = renderRegistrySource(folders);

  if (check) {
    let committed;
    try {
      committed = await fs.readFile(outputPath, 'utf8');
    } catch {
      throw new Error(`--check: no committed file at ${outputPath}`);
    }
    if (committed !== source) {
      throw new Error(
        `--check: generated output differs from committed ${outputPath}. Run without --check to regenerate.`
      );
    }
    return { folders, source };
  }

  await fs.writeFile(outputPath, source, 'utf8');
  return { folders, source };
}

// --- CLI entry point -------------------------------------------------------
// Guarded to run only when this file is executed directly (not when
// imported, e.g. by themes-validation.test.ts's AC-STRUCT-4 fixture tests —
// an unguarded top-level call would otherwise overwrite the real committed
// registry.generated.ts as a side effect of merely importing this module).
const isMainModule =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const check = process.argv.includes('--check');
  generate({ check })
    .then(({ folders }) => {
      if (check) {
        console.log(`registry.generated.ts is up to date (${folders.length} themes: ${folders.join(', ')}).`);
      } else {
        console.log(`Wrote ${DEFAULT_OUTPUT_PATH} (${folders.length} themes: ${folders.join(', ')}).`);
      }
    })
    .catch((error) => {
      console.error(error.message ?? error);
      process.exitCode = 1;
    });
}
