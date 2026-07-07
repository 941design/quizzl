// app/tests/unit/themes-validation.test.ts
//
// Story S3 ("Generator + validation gate") — the full VALUE-level validation
// gate for the pluggable-themes epic. Vitest imports TypeScript natively, so
// every zod/contrast/drift/order/font/boundary check that needs to evaluate
// real manifest data lives here (the generator script itself,
// app/scripts/generate-theme-registry.mjs, performs only structural
// filesystem checks — see that file's header). Wired into `npm run prebuild`
// (app/package.json), which runs the generator then this suite before every
// `next build` (AC-DEP-1/AC-DEP-2).
//
// Section map (one describe block per AC):
//   AC-VAL-2    schema/id validation
//   AC-VAL-1    contrast gate (hardened — real hex values only)
//   AC-VAL-3    folder-set drift (clause 1 only; order-position sub-clause retired)
//   AC-VAL-4    order uniqueness
//   AC-FONT-1   font-URL parity (hardened) + _document.tsx wiring
//   AC-STRUCT-2 lib/theme.ts has no inline theme object definitions
//   AC-STRUCT-4 generator/registry structural relationship (temp-folder fixtures)
//   AC-BOUND-1  zod boundary (hardened) + enum-catalog/treatment sync + FontLoadSchema pin
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ThemeManifestSchema } from '@/src/themes/schema';
import { evaluateThemeContrast, WCAG_AA_THRESHOLD, type ContrastFailure } from '@/src/themes/contrast';
import { buildFontLinkHref, type FontLoad } from '@/src/themes/fontUnion';
import {
  APP_THEMES as REGISTRY_APP_THEMES,
  THEME_FONTS,
  type AppThemeName,
} from '@/src/themes/registry.generated';
import { CARD_ELEVATION, CONTENT_PANEL_STYLES } from '@/src/themes/treatments/elevation';
import { SURFACE_PATTERNS } from '@/src/themes/treatments/patterns';
import { ICON_SETS } from '@/src/themes/treatments/iconSets';
import { DYNAMIC_GENERATORS } from '@/src/themes/treatments/dynamicVisuals';

// The generator's pure, exported functions (structural scaffold only — see
// generate-theme-registry.mjs's header). Reused directly rather than
// reimplemented, per the S3 spawn brief.
import {
  findThemeFolders,
  generate,
} from '../../scripts/generate-theme-registry.mjs';

// --- path resolution (from THIS test module, never process.cwd() — vitest
// runs from app/, so a cwd-relative resolution would be an accident of the
// invoking shell rather than a stable anchor) -------------------------------
const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(TEST_FILE_DIR, '..', '..'); // app/tests/unit -> app/
const THEMES_DIR = path.join(APP_ROOT, 'src', 'themes');

const THEME_IDS: AppThemeName[] = ['calm', 'playful', 'lego', 'minecraft', 'flower', 'aquarelle'];

// ===========================================================================
// AC-VAL-2 (spec AC7): schema/id validation
// ===========================================================================
describe('AC-VAL-2: schema/id validation', () => {
  let folders: string[];

  beforeAll(async () => {
    folders = await findThemeFolders(THEMES_DIR);
  });

  it.each(THEME_IDS)('%s manifest passes ThemeManifestSchema.parse', (id) => {
    expect(() => ThemeManifestSchema.parse(REGISTRY_APP_THEMES[id])).not.toThrow();
  });

  it.each(THEME_IDS)('%s manifest id equals its registry key (folder basename)', (id) => {
    expect(REGISTRY_APP_THEMES[id].id).toBe(id);
  });

  // --- Direct id===folder guard (Stage-1 review finding, severity 3) --------
  // REGISTRY_APP_THEMES is built `Object.fromEntries(_sorted.map(m => [m.id,
  // m]))` — keyed BY manifest.id. That means `REGISTRY_APP_THEMES[id].id ===
  // id` above is true BY CONSTRUCTION and can never fail regardless of
  // whether a manifest's id actually matches its folder name: it only proves
  // object lookup by key works. The invariant this AC is actually meant to
  // pin — "each folder's manifest declares an id equal to that folder's
  // name" — must be checked from the FOLDER side, independent of how the
  // registry indexes its map. Do not "simplify" this back to an id-keyed
  // lookup; that would silently re-introduce the tautology.
  it('every real theme folder has a corresponding REGISTRY_APP_THEMES entry whose id equals the folder name (direct, non-tautological AC-VAL-2 guard)', () => {
    expect(folders.length).toBeGreaterThan(0); // sanity: beforeAll populated it
    for (const folderName of folders) {
      expect(Object.keys(REGISTRY_APP_THEMES), `no registry entry for folder "${folderName}"`).toContain(
        folderName
      );
      expect(
        REGISTRY_APP_THEMES[folderName as AppThemeName]?.id,
        `REGISTRY_APP_THEMES["${folderName}"].id does not equal its own folder name`
      ).toBe(folderName);
    }
  });

  it('the direct id===folder guard above has teeth: a folder->id mismatch fixture (isolated from the real registry) fails the identical assertion logic', () => {
    // Simulates the exact failure mode a real drift would produce: a
    // registry object keyed by folder name "calm" whose manifest.id is
    // "playful" (a valid id per the regex, but wrong for this folder — the
    // regex alone cannot catch this). Exercised against a small isolated
    // fixture map, never by mutating the real REGISTRY_APP_THEMES, so this
    // proves the assertion shape discriminates without touching real files.
    const mismatchedRegistry: Record<string, { id: string }> = {
      calm: { id: 'playful' },
    };
    const checkFolderMatchesId = (registry: Record<string, { id: string }>, folderName: string): boolean =>
      registry[folderName]?.id === folderName;

    expect(checkFolderMatchesId(mismatchedRegistry, 'calm')).toBe(false);
    // Sanity: the same check logic passes for a correctly-matched entry.
    expect(checkFolderMatchesId({ calm: { id: 'calm' } }, 'calm')).toBe(true);
  });

  it('rejects an id with an uppercase letter (fails the ^[a-z][a-z0-9-]*$ regex)', () => {
    const fixture = { ...REGISTRY_APP_THEMES.calm, id: 'Calm' };
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('rejects an id with a leading digit (fails the ^[a-z][a-z0-9-]*$ regex)', () => {
    const fixture = { ...REGISTRY_APP_THEMES.calm, id: '1calm' };
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('flags an id that differs from its folder via an explicit id === folder assertion (zod regex alone cannot catch a valid-but-wrong id)', () => {
    // 'playful' is a perfectly valid id per the regex, but wrong for the
    // 'calm' folder — this is exactly the case the regex cannot catch and
    // the explicit id===folder assertion exists for.
    const fixture = { ...REGISTRY_APP_THEMES.calm, id: 'playful' };
    const folder = 'calm';
    expect(() => ThemeManifestSchema.parse(fixture)).not.toThrow();
    expect(fixture.id === folder).toBe(false);
  });
});

// ===========================================================================
// AC-VAL-1 (spec AC6, hardened): contrast gate — real hex values only
// ===========================================================================
describe('AC-VAL-1: contrast gate (computed from real hex values only, never colorScheme/contentSurface as a shortcut)', () => {
  it.each(THEME_IDS)('%s: evaluateThemeContrast passes with zero failures', (id) => {
    const result = evaluateThemeContrast(REGISTRY_APP_THEMES[id]);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('a failing pair reports theme id + failing (text, surface) token pair + computed ratio', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      colors: { ...REGISTRY_APP_THEMES.calm.colors, textStrong: '#999999', surfaceBg: '#aaaaaa' },
    };
    const result = evaluateThemeContrast(fixture);
    expect(result.pass).toBe(false);
    const failure = result.failures.find(
      (f: ContrastFailure) => f.textToken === 'textStrong' && f.surfaceToken === 'surfaceBg'
    );
    expect(failure).toBeDefined();
    expect(failure!.ratio).toBeLessThan(WCAG_AA_THRESHOLD);
    // The shape contrast.ts already returns is exactly "theme id + pair +
    // ratio" — assert a caller can format a report that surfaces all three.
    const report = `theme "${fixture.id}": (${failure!.textToken}, ${failure!.surfaceToken}) ratio ${failure!.ratio.toFixed(2)} < ${WCAG_AA_THRESHOLD}`;
    expect(report).toContain('calm');
    expect(report).toContain('textStrong');
    expect(report).toContain('surfaceBg');
  });

  it('never trusts colorScheme as a shortcut: colorScheme "light" with real low-contrast hex values still fails', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      colorScheme: 'light' as const,
      // Near-white on white: passes no eyeball "light theme" assumption,
      // fails on the actual computed ratio.
      colors: { ...REGISTRY_APP_THEMES.calm.colors, textStrong: '#f0f0f0', surfaceBg: '#ffffff' },
    };
    const result = evaluateThemeContrast(fixture);
    expect(result.pass).toBe(false);
  });

  it('treats a non-hex named CSS color token as a gate FAILURE, never a silent pass (fail-loud contract)', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      colors: { ...REGISTRY_APP_THEMES.calm.colors, textStrong: 'red' },
    };
    const result = evaluateThemeContrast(fixture);
    expect(result.pass).toBe(false);
    const failure = result.failures.find((f: ContrastFailure) => f.textToken === 'textStrong');
    expect(failure?.reason).toBeDefined();
    expect(failure?.reason).toMatch(/unparseable/);
  });

  it('treats an rgb() color token as a gate FAILURE too (not just named colors)', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      colors: { ...REGISTRY_APP_THEMES.calm.colors, textStrong: 'rgb(0,0,0)' },
    };
    const result = evaluateThemeContrast(fixture);
    expect(result.pass).toBe(false);
    const failure = result.failures.find((f: ContrastFailure) => f.textToken === 'textStrong');
    expect(failure?.reason).toMatch(/unparseable/);
  });
});

// ===========================================================================
// AC-VAL-3 (spec AC8, amended): folder-set drift — clause 1 only.
//
// The order-sorted-position sub-clause of AC-VAL-3 was retired 2026-07-01
// (spec.md ## Amendments) — see AC-FONT-1 (font drift) and AC-VAL-4
// (order-collision) below for the surviving metadata-drift coverage.
// ===========================================================================
describe('AC-VAL-3: folder-set drift (clause 1 only)', () => {
  let folders: string[];

  beforeAll(async () => {
    folders = await findThemeFolders(THEMES_DIR);
  });

  it('the folder set (containing manifest.ts) exactly equals Object.keys(APP_THEMES) from registry.generated.ts — the PURE registry, never themes/index.ts\'s compat-augmented map', () => {
    expect(new Set(folders)).toEqual(new Set(Object.keys(REGISTRY_APP_THEMES)));
  });

  // Drift-triggering fixture: rather than spinning up a temp-folder
  // generator fixture here (AC-STRUCT-4 below already exercises that path
  // for the generator itself), this asserts the SAME comparison the line
  // above performs would correctly flag a deliberately-wrong expected key
  // set as non-matching — i.e. the comparison has teeth, not just a
  // tautological self-equality.
  it('a deliberately-wrong expected key set (one real folder dropped) is correctly flagged as NOT matching', () => {
    const wrongExpected = folders.slice(1); // drop the first real folder
    expect(new Set(folders)).not.toEqual(new Set(wrongExpected));
  });

  it('a deliberately-wrong expected key set (one extra fake folder added) is correctly flagged as NOT matching', () => {
    const wrongExpected = [...folders, 'not-a-real-theme'];
    expect(new Set(folders)).not.toEqual(new Set(wrongExpected));
  });
});

// ===========================================================================
// AC-VAL-4 (spec AC8b, hardened): order uniqueness
// ===========================================================================
describe('AC-VAL-4: order uniqueness', () => {
  function hasUniqueOrders(manifests: Array<{ order: number }>): boolean {
    return new Set(manifests.map((m) => m.order)).size === manifests.length;
  }

  it('the six REAL manifests currently have unique order values (1..6, no duplicates)', () => {
    const manifests = THEME_IDS.map((id) => REGISTRY_APP_THEMES[id]);
    expect(hasUniqueOrders(manifests)).toBe(true);
    expect(new Set(manifests.map((m) => m.order))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('flags two fixture manifests sharing the same order value as a uniqueness violation', () => {
    const fixtures = [
      { ...REGISTRY_APP_THEMES.calm, order: 2 },
      { ...REGISTRY_APP_THEMES.playful, order: 2 },
      { ...REGISTRY_APP_THEMES.lego, order: 3 },
    ];
    expect(hasUniqueOrders(fixtures)).toBe(false);
  });

  it('does not flag three fixture manifests with distinct order values', () => {
    const fixtures = [
      { ...REGISTRY_APP_THEMES.calm, order: 10 },
      { ...REGISTRY_APP_THEMES.playful, order: 11 },
      { ...REGISTRY_APP_THEMES.lego, order: 12 },
    ];
    expect(hasUniqueOrders(fixtures)).toBe(true);
  });
});

// ===========================================================================
// AC-FONT-1 (spec AC14, hardened): font-URL parity + _document.tsx wiring
// ===========================================================================
describe('AC-FONT-1: font-URL parity (hardened)', () => {
  const EXPECTED_HREF =
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Serif+Display:ital@0;1&family=Fredoka:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Nunito:wght@400;600;700;800&family=Press+Start+2P&family=VT323&display=swap';

  it('buildFontLinkHref(THEME_FONTS) equals the committed Google Fonts URL byte-for-byte', () => {
    expect(buildFontLinkHref(THEME_FONTS)).toBe(EXPECTED_HREF);
  });

  it('_document.tsx renders href from buildFontLinkHref(THEME_FONTS), not a hardcoded URL literal', () => {
    const documentSource = fs.readFileSync(path.join(APP_ROOT, 'pages', '_document.tsx'), 'utf8');
    expect(documentSource).toMatch(/buildFontLinkHref\(\s*THEME_FONTS\s*\)/);
    expect(documentSource).not.toMatch(/https:\/\/fonts\.googleapis\.com\/css2\?family=DM\+Serif/);
  });
});

// ===========================================================================
// AC-STRUCT-2 (spec AC1): app/src/lib/theme.ts has no inline theme object
// definitions — locks the fact that S2 already made this file a thin
// re-export, so a future edit can't silently reintroduce inline definitions.
// ===========================================================================
describe('AC-STRUCT-2: app/src/lib/theme.ts is a thin re-export with no inline theme definitions', () => {
  const LIB_THEME_PATH = path.join(APP_ROOT, 'src', 'lib', 'theme.ts');

  it('references @/src/themes/index and contains no const/object-literal/extendTheme( definitions', () => {
    const source = fs.readFileSync(LIB_THEME_PATH, 'utf8');
    expect(source).toContain("from '@/src/themes/index'");
    // Scan CODE ONLY, not comments (Stage-1 review finding, severity 2): the
    // raw source previously included comment lines in the const/extendTheme(
    // scan, so a future comment like "use a const assertion" or "no
    // extendTheme( calls here" would spuriously fail this test even though
    // lib/theme.ts is a clean re-export. Strip `//` comment lines first,
    // reusing the same skip pattern the sibling assertion below already
    // applies, then scan only the remaining code lines. This must still fail
    // on a REAL inline `const ...` or `extendTheme(` call.
    const codeOnly = source
      .split('\n')
      .filter((rawLine) => !rawLine.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toMatch(/\bconst\s+[A-Za-z_$]/);
    expect(codeOnly).not.toMatch(/extendTheme\(/);
  });

  it('the comment-stripped scan has teeth: a comment-only mention of "const"/"extendTheme(" is ignored, but a REAL inline const or extendTheme( call is still caught (isolated fixture, never the real file)', () => {
    const stripComments = (source: string): string =>
      source
        .split('\n')
        .filter((rawLine) => !rawLine.trim().startsWith('//'))
        .join('\n');

    // A comment merely mentioning these tokens must NOT trip the gate.
    const commentOnlyFixture = [
      "// use a const assertion here if you like",
      "// no extendTheme( calls in this file",
      "export { APP_THEMES } from '@/src/themes/index';",
    ].join('\n');
    const strippedCommentOnly = stripComments(commentOnlyFixture);
    expect(strippedCommentOnly).not.toMatch(/\bconst\s+[A-Za-z_$]/);
    expect(strippedCommentOnly).not.toMatch(/extendTheme\(/);

    // A REAL inline const declaration must still be caught.
    const realConstFixture = "const inlineTheme = { colors: {} };\n";
    expect(stripComments(realConstFixture)).toMatch(/\bconst\s+[A-Za-z_$]/);

    // A REAL extendTheme( call must still be caught.
    const realExtendThemeFixture = "export const theme = extendTheme({ colors: {} });\n";
    expect(stripComments(realExtendThemeFixture)).toMatch(/extendTheme\(/);
  });

  it('every non-comment, non-blank line is part of an export {...} / export type {...} re-export statement', () => {
    const source = fs.readFileSync(LIB_THEME_PATH, 'utf8');
    const lines = source.split('\n');
    // A line is allowed if it: starts a re-export (`export {` / `export type {`),
    // is a bare exported-identifier continuation line (e.g. "  APP_THEMES,"),
    // or closes the statement with the `from '...'` clause.
    const ALLOWED_LINE = /^(export\s*\{|export\s+type\s*\{|[A-Za-z_$][\w$]*,?\s*$|\}\s*from\s*['"][^'"]+['"];?\s*$)/;
    let sawExport = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '') continue;
      if (line.startsWith('//')) continue;
      expect(line, `unexpected non-re-export line in lib/theme.ts: "${line}"`).toMatch(ALLOWED_LINE);
      if (line.startsWith('export')) sawExport = true;
    }
    expect(sawExport).toBe(true);
  });
});

// ===========================================================================
// AC-STRUCT-3 (spec AC2): `--check` idempotence against the REAL committed
// registry.generated.ts. Added post-impl: the CLI-level `--check` behavior
// had been verified manually (`node scripts/generate-theme-registry.mjs
// --check`) but was not yet pinned by an automated regression test, so a
// future edit to the emitted-source template (renderRegistrySource) that
// silently drifts from the committed file would go undetected here.
// ===========================================================================
describe('AC-STRUCT-3: generator --check mode is idempotent against the committed registry.generated.ts', () => {
  it('generate({ check: true }) against the real themes dir/output path does not throw (committed file is up to date)', async () => {
    await expect(
      generate({ themesDir: THEMES_DIR, outputPath: path.join(THEMES_DIR, 'registry.generated.ts'), check: true })
    ).resolves.toBeDefined();
  });

  it('generate({ check: true }) throws when the committed file has drifted from what the generator would emit', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'theme-registry-check-fixture-'));
    try {
      await fsp.mkdir(path.join(tmpDir, 'alpha'), { recursive: true });
      await fsp.writeFile(path.join(tmpDir, 'alpha', 'manifest.ts'), 'export const manifest = {};\n', 'utf8');
      const outputPath = path.join(tmpDir, 'registry.generated.ts');
      // Write a stale/incorrect committed file, then add a second folder
      // AFTER writing it — --check must detect the mismatch and throw.
      await fsp.writeFile(outputPath, '// stale, does not match the generator output\n', 'utf8');
      await expect(generate({ themesDir: tmpDir, outputPath, check: true })).rejects.toThrow(/--check/);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STRUCT-4 (spec AC3, generator/registry half only — picker-visibility is
// S4's concern): the folder -> APP_THEMES relationship the generator
// guarantees, proven via temp fixture folders (never touching the real
// five themes).
// ===========================================================================
describe('AC-STRUCT-4: generator/registry structural relationship (folder set -> emitted APP_THEMES)', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function writeFixtureFolder(dir: string, name: string): Promise<void> {
    const folderPath = path.join(dir, name);
    await fsp.mkdir(folderPath, { recursive: true });
    // Content is irrelevant — the generator's structural functions never
    // evaluate TS, they only check the file exists and the folder name
    // matches the regex (see generate-theme-registry.mjs's header).
    await fsp.writeFile(path.join(folderPath, 'manifest.ts'), 'export const manifest = {};\n', 'utf8');
  }

  it('adding/removing fake theme folders is reflected in the emitted AppThemeName union with no other change needed', async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'theme-registry-fixture-'));
    await writeFixtureFolder(tmpDir, 'alpha');
    await writeFixtureFolder(tmpDir, 'beta');
    const outputPath = path.join(tmpDir, 'registry.generated.ts');

    const first = await generate({ themesDir: tmpDir, outputPath });
    expect(first.folders).toEqual(['alpha', 'beta']);
    expect(first.source).toContain(`export type AppThemeName = 'alpha' | 'beta';`);

    // Add a third fake folder — regenerate — new folder appears, nothing else changes structurally.
    await writeFixtureFolder(tmpDir, 'gamma');
    const second = await generate({ themesDir: tmpDir, outputPath });
    expect(second.folders).toEqual(['alpha', 'beta', 'gamma']);
    expect(second.source).toContain(`export type AppThemeName = 'alpha' | 'beta' | 'gamma';`);

    // Remove one fake folder — regenerate — it's gone from the output.
    await fsp.rm(path.join(tmpDir, 'beta'), { recursive: true, force: true });
    const third = await generate({ themesDir: tmpDir, outputPath });
    expect(third.folders).toEqual(['alpha', 'gamma']);
    expect(third.source).toContain(`export type AppThemeName = 'alpha' | 'gamma';`);
    expect(third.source).not.toContain(`'beta'`);
  });
});

// ===========================================================================
// AC-BOUND-1 (spec AC17, hardened): zod boundary — generalized resolved-
// target import scanner, self-tests, plus the carried enum-catalog/
// treatment-sync and FontLoadSchema-structural-parity guarantees.
// ===========================================================================

/** Matches a runtime import statement whose source is exactly `zod`. */
const RUNTIME_ZOD_IMPORT = /^\s*import\s+(?!type\s)[^;]*\sfrom\s+['"]zod['"]/m;

const SCHEMA_ABS_PATH = path.join(THEMES_DIR, 'schema.ts').replace(/\.ts$/, '');

/**
 * Resolves an import specifier found in `fromFileAbsPath` (an ABSOLUTE path
 * to the importing file) to an absolute, extension-normalized path.
 * Generalizes zodBoundary.test.ts's (S1-scoped) resolver, which only
 * resolved relative specifiers against `app/src/themes/` — this version
 * resolves relative specifiers against each importing file's OWN directory
 * (files under app/pages/, app/src/hooks/, app/src/components/ live at
 * different depths than the themes/ files) and the `@/` alias against the
 * app root, exactly as vitest.config.ts's `resolve.alias['@']` and
 * tsconfig.json's `@/*` path both define. Returns `null` for bare/package
 * specifiers this resolver has no rule for (e.g. `'zod'`, `'react'`).
 */
function resolveSpecifierAbs(specifier: string, fromFileAbsPath: string): string | null {
  let target: string;
  if (specifier.startsWith('.')) {
    target = path.resolve(path.dirname(fromFileAbsPath), specifier);
  } else if (specifier.startsWith('@/')) {
    target = path.resolve(APP_ROOT, specifier.slice(2));
  } else {
    return null;
  }
  return target.replace(/\.(ts|tsx)$/, '');
}

function resolvesToSchemaAbs(specifier: string, fromFileAbsPath: string): boolean {
  return resolveSpecifierAbs(specifier, fromFileAbsPath) === SCHEMA_ABS_PATH;
}

type ParsedImport = { specifier: string; isRuntime: boolean };

/** True when a `{ ... }` named-import clause pulls in at least one runtime (non-`type`-prefixed) binding. Ported from zodBoundary.test.ts's `isClauseRuntime`. */
function isClauseRuntime(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith('*')) {
    return true; // namespace import — no inline type-only form exists
  }
  const braceStart = trimmed.indexOf('{');
  if (braceStart === -1) {
    return true; // bare default import, e.g. `Default`
  }
  const beforeBrace = trimmed.slice(0, braceStart).replace(/,/g, '').trim();
  if (beforeBrace.length > 0) {
    return true; // `Default, { ... }` — the default binding alone is runtime
  }
  const braceEnd = trimmed.lastIndexOf('}');
  const bindings = trimmed
    .slice(braceStart + 1, braceEnd)
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  if (bindings.length === 0) {
    return false; // `import {} from 'x'` — degenerate, no runtime binding
  }
  return bindings.some((binding) => !/^type\s+/.test(binding));
}

/** Extracts every `import` statement from a TS source string and classifies each as runtime or type-only. Ported from zodBoundary.test.ts's `parseImports`. */
function parseImports(source: string): ParsedImport[] {
  const results: ParsedImport[] = [];
  const IMPORT_RE = /^[ \t]*import\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]|^[ \t]*import\s+['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const [, typeKeyword, clause, specifierFrom, specifierSideEffect] = match;
    if (specifierSideEffect !== undefined) {
      results.push({ specifier: specifierSideEffect, isRuntime: true });
      continue;
    }
    if (typeKeyword) {
      results.push({ specifier: specifierFrom, isRuntime: false });
      continue;
    }
    results.push({ specifier: specifierFrom, isRuntime: isClauseRuntime(clause) });
  }
  return results;
}

function hasRuntimeSchemaImportAbs(source: string, fromFileAbsPath: string): boolean {
  return parseImports(source).some((imp) => imp.isRuntime && resolvesToSchemaAbs(imp.specifier, fromFileAbsPath));
}

type BoundaryTarget = { label: string; absPath: string };

/**
 * Recursively collects every `.ts`/`.tsx` file under `dir`, excluding
 * `schema.ts` itself (the ONE module AC-BOUND-1 permits to import zod at
 * runtime) and any test file (`*.test.ts(x)` / `*.spec.ts(x)`).
 *
 * WHY derived, not hardcoded (AC-BOUND-1 residual-risk hardening): the
 * AC-BOUND-1 scan previously walked a MANUALLY-MAINTAINED list of
 * client-bundle-reachable modules. That list is correct today (verified:
 * zero runtime schema.ts imports, confirmed against a real `npm run build`
 * bundle grep — zod is absent from .next/static/chunks), but a future
 * client-reachable module added under `src/themes/` (a 6th theme folder in
 * S4/S5, a new `treatments/*.ts` file, a new top-level themes/ module)
 * could silently ESCAPE a hand-maintained list if nobody remembers to add
 * it — defeating the ongoing regression guard for the epic's core zod-
 * never-reaches-the-client-bundle promise. Deriving the set from the
 * filesystem means a new file is automatically in scope with no edit to
 * this test required.
 */
async function collectTsFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectTsFilesRecursive(entryPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    if (entryPath === path.join(THEMES_DIR, 'schema.ts')) continue; // the one allowed zod importer
    results.push(entryPath);
  }
  return results;
}

describe('AC-BOUND-1: no client-bundle-reachable module has a runtime import resolving to schema.ts', () => {
  let targets: BoundaryTarget[] = [];
  let derivedThemesFiles: string[] = [];

  beforeAll(async () => {
    // Derived set: every .ts/.tsx file under src/themes/ (recursively —
    // manifests, registry.generated.ts, buildChakraTheme.ts, contrast.ts,
    // fontUnion.ts, index.ts, treatments/*, and any future file), minus
    // schema.ts and test files. See collectTsFilesRecursive's doc comment
    // for why this must be filesystem-derived rather than hardcoded.
    derivedThemesFiles = (await collectTsFilesRecursive(THEMES_DIR)).sort();
    const themesTargets: BoundaryTarget[] = derivedThemesFiles.map((absPath) => ({
      label: path.relative(THEMES_DIR, absPath).split(path.sep).join('/'),
      absPath,
    }));

    // Cross-check against the generator's own findThemeFolders (already
    // reused by AC-VAL-2/AC-VAL-3 above, rather than duplicating folder-
    // enumeration logic here): every real theme folder's manifest.ts must
    // appear in the derived glob, tying the two enumeration paths together
    // instead of trusting the recursive walk in isolation.
    const folders = await findThemeFolders(THEMES_DIR);
    const derivedAbsPaths = new Set(derivedThemesFiles);
    for (const folder of folders) {
      const manifestAbsPath = path.join(THEMES_DIR, folder, 'manifest.ts');
      expect(
        derivedAbsPaths.has(manifestAbsPath),
        `derived glob missed ${folder}/manifest.ts — findThemeFolders/collectTsFilesRecursive disagree`
      ).toBe(true);
    }

    // The three known non-themes/ client consumers AC-BOUND-1 names
    // explicitly — files outside src/themes/ are out of scope for the glob
    // above by construction, so these stay an explicit list. Guarded by an
    // existence assertion so a rename can't silently drop coverage.
    const externalConsumers: BoundaryTarget[] = [
      { label: 'pages/_document.tsx', absPath: path.join(APP_ROOT, 'pages', '_document.tsx') },
      { label: 'src/hooks/useThemeStyles.ts', absPath: path.join(APP_ROOT, 'src', 'hooks', 'useThemeStyles.ts') },
      { label: 'src/components/ThemeIcon.tsx', absPath: path.join(APP_ROOT, 'src', 'components', 'ThemeIcon.tsx') },
    ];
    for (const consumer of externalConsumers) {
      expect(
        fs.existsSync(consumer.absPath),
        `expected external consumer file to exist (rename would silently drop AC-BOUND-1 coverage): ${consumer.label}`
      ).toBe(true);
    }

    targets = [...themesTargets, ...externalConsumers];
  });

  it('the derived scan set is non-empty and covers every themes/ .ts/.tsx file (glob has teeth: an empty/broken glob cannot make the guard vacuously pass)', () => {
    expect(derivedThemesFiles.length).toBeGreaterThan(0);
    expect(targets.length).toBeGreaterThan(10); // sanity: the beforeAll actually populated the full list
    const scannedAbsPaths = new Set(targets.map((t) => t.absPath));
    for (const absPath of derivedThemesFiles) {
      expect(scannedAbsPaths, `${absPath} was globbed but missing from the scanned target set`).toContain(absPath);
    }
    // schema.ts itself must never appear in the scanned set — it's the one
    // module AC-BOUND-1 permits to import zod at runtime.
    expect(scannedAbsPaths).not.toContain(path.join(THEMES_DIR, 'schema.ts'));
  });

  it('none of the scanned targets has a RUNTIME import that resolves to schema.ts', () => {
    expect(targets.length).toBeGreaterThan(10); // sanity: the beforeAll actually populated the list
    for (const target of targets) {
      const source = fs.readFileSync(target.absPath, 'utf8');
      expect(
        hasRuntimeSchemaImportAbs(source, target.absPath),
        `${target.label} has a runtime import resolving to schema.ts`
      ).toBe(false);
    }
  });

  it('manifests, registry.generated.ts, _document.tsx, useThemeStyles.ts, and ThemeIcon.tsx have no literal "zod" runtime import either (newly-in-scope files for S3 — contrast.ts/fontUnion.ts are already covered by zodBoundary.test.ts\'s S1 guard)', () => {
    const relevantLabels = new Set([
      ...targets.filter((t) => t.label.endsWith('/manifest.ts')).map((t) => t.label),
      'registry.generated.ts',
      'pages/_document.tsx',
      'src/hooks/useThemeStyles.ts',
      'src/components/ThemeIcon.tsx',
    ]);
    for (const target of targets) {
      if (!relevantLabels.has(target.label)) continue;
      const source = fs.readFileSync(target.absPath, 'utf8');
      expect(RUNTIME_ZOD_IMPORT.test(source), `${target.label} has a literal runtime zod import`).toBe(false);
    }
  });
});

describe('AC-BOUND-1: generalized resolved-target scanner self-test (proves the scanner discriminates, not just passes)', () => {
  // Synthetic module paths; never read from disk. Chosen at different
  // directory depths (themes root, a nested treatments/ dir, and a
  // completely different tree under pages/) specifically to prove the
  // generalized resolver — unlike the S1 zodBoundary.test.ts scanner it
  // extends — resolves relative specifiers against EACH file's own
  // directory rather than one shared base.
  const FIXTURE_ABS = path.join(THEMES_DIR, 'fixtureModule.ts');
  const FIXTURE_ABS_NESTED = path.join(THEMES_DIR, 'treatments', 'fixtureModule.ts');
  const FIXTURE_ABS_PAGES = path.join(APP_ROOT, 'pages', 'fixtureModule.tsx');

  it('flags a runtime named import of a schema.ts binding (the exact regression this scanner guards against)', () => {
    const fixture = `import { ThemeManifestSchema } from './schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(true);
  });

  it('does NOT flag a type-only import of a schema.ts binding', () => {
    const fixture = `import type { ThemeManifest } from './schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(false);
  });

  it('flags a mixed import where only one named binding carries an inline `type` modifier', () => {
    const fixture = `import { type ThemeManifest, ThemeManifestSchema } from './schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(true);
  });

  it('does NOT flag a named import where every binding carries an inline `type` modifier', () => {
    const fixture = `import { type ThemeManifest, type ThemeManifestSchema } from './schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(false);
  });

  it('flags a default import of schema.ts', () => {
    const fixture = `import schema from './schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(true);
  });

  it('flags a namespace import of schema.ts', () => {
    const fixture = `import * as schema from './schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(true);
  });

  it('flags a side-effect import of schema.ts', () => {
    const fixture = `import './schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(true);
  });

  it('flags a runtime import resolved via the `../schema` relative form from a nested module directory', () => {
    const fixture = `import { ThemeManifestSchema } from '../schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS_NESTED)).toBe(true);
  });

  it('flags a runtime import resolved via the repo `@/` path alias, from a module living in a completely different directory tree (pages/)', () => {
    const fixture = `import { ThemeManifestSchema } from '@/src/themes/schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS_PAGES)).toBe(true);
  });

  it('does NOT flag an import of an unrelated module (no false positive)', () => {
    const fixture = `import { extendTheme } from '@chakra-ui/react';\nimport type { ThemeConfig } from '@chakra-ui/react';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(false);
  });

  it('does NOT flag a `./schemaExtras`-like specifier that resolves to a DIFFERENT file (no substring false positive)', () => {
    const fixture = `import { Extra } from './schemaExtras';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS)).toBe(false);
  });

  it('flags a namespace/default-style import of schema.ts via the `@/` alias too', () => {
    const fixture = `import * as schema from '@/src/themes/schema';\n`;
    expect(hasRuntimeSchemaImportAbs(fixture, FIXTURE_ABS_PAGES)).toBe(true);
  });
});

describe('AC-BOUND-1 carried guarantee (enum-catalog-schema-treatment-sync): zod enum options exactly match the treatment module Record keys', () => {
  // zod v4.4.3 API used to read enum options back from a nested schema
  // shape: `ThemeManifestSchema.shape.treatments.shape.<field>.options`
  // (a plain `z.enum([...]).options` array). For an `.optional()`-wrapped
  // enum (contentPanel), the enum itself is reached via `.unwrap()` first:
  // `ThemeManifestSchema.shape.treatments.shape.contentPanel.unwrap().options`.
  it('ElevationNameSchema (treatments.card) options === Object.keys(CARD_ELEVATION)', () => {
    const options = ThemeManifestSchema.shape.treatments.shape.card.options;
    expect(new Set(options)).toEqual(new Set(Object.keys(CARD_ELEVATION)));
  });

  it('ThemeManifestSchema rejects an out-of-enum treatments.card value (non-tautological pin: exercises actual parse behavior, not just a restated literal array)', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: { ...REGISTRY_APP_THEMES.calm.treatments, card: 'not-a-real-elevation' },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('SurfacePatternNameSchema (treatments.surface) options === Object.keys(SURFACE_PATTERNS)', () => {
    const options = ThemeManifestSchema.shape.treatments.shape.surface.options;
    expect(new Set(options)).toEqual(new Set(Object.keys(SURFACE_PATTERNS)));
  });

  it('IconSetNameSchema (treatments.iconSet) options === keys of one representative ICON_SETS entry (icon SET names, e.g. line/filled/pixel — NOT Object.keys(ICON_SETS), which is icon NAMES)', () => {
    const options = ThemeManifestSchema.shape.treatments.shape.iconSet.options;
    expect(new Set(options)).toEqual(new Set(Object.keys(ICON_SETS.heart)));
  });

  it('ContentPanelNameSchema (treatments.contentPanel, optional) options === Object.keys(CONTENT_PANEL_STYLES)', () => {
    const options = ThemeManifestSchema.shape.treatments.shape.contentPanel.unwrap().options;
    expect(new Set(options)).toEqual(new Set(Object.keys(CONTENT_PANEL_STYLES)));
  });
});

describe('AC-BOUND-1 carried guarantee: FontLoadSchema (schema.ts) structurally matches the FontLoad type (fontUnion.ts) — the two are declared independently and kept in sync by hand', () => {
  // FontLoadSchema itself is not exported from schema.ts (only
  // ThemeManifestSchema/ThemeManifest/validateManifest are) — it is reached
  // via ThemeManifestSchema.shape.typography.shape.fontLoad.element, the
  // zod v4 ZodArray->element-schema accessor.
  const fontLoadElementSchema = ThemeManifestSchema.shape.typography.shape.fontLoad.element;

  const italOnly: FontLoad = { family: 'Test Ital', ital: true };
  const weightsOnly: FontLoad = { family: 'Test Weights', weights: [400, 700] };
  const both: FontLoad = { family: 'Test Both', ital: true, weights: [400] };
  const neither: FontLoad = { family: 'Test Neither' };

  it.each([
    ['ital-only', italOnly],
    ['weights-only', weightsOnly],
    ['both axes', both],
    ['neither axis', neither],
  ])('%s FontLoad-typed object literal parses successfully against FontLoadSchema', (_label, font) => {
    expect(fontLoadElementSchema.safeParse(font).success).toBe(true);
  });

  it('a FontLoad-shaped object with an extra unexpected key FAILS (FontLoadSchema is .strict())', () => {
    const withExtraKey = { ...neither, unexpectedKey: 'drift' };
    expect(fontLoadElementSchema.safeParse(withExtraKey).success).toBe(false);
  });
});

// ===========================================================================
// Epic: dynamic-theme-visuals, Story S1 — `treatments.dynamic` schema +
// validation gate (specs/epic-dynamic-theme-visuals/acceptance-criteria.md).
// AC IDs below (AC-STRUCT-1/2, AC-VAL-1/2, AC-BOUND-1) belong to THIS epic's
// own numbering and are unrelated to the same-named AC-STRUCT-2/AC-BOUND-1
// blocks above, which belong to the earlier pluggable-themes epic (S3).
// ===========================================================================

// A valid, minimal `treatments.dynamic.banner` fixture reused across the
// blocks below.
const VALID_DYNAMIC_BANNER = {
  generator: 'watercolor' as const,
  style: {
    anchorHue: 200,
    scheme: 'triadic' as const,
    saturation: 60,
    lightness: 50,
  },
};

describe('AC-STRUCT-1: treatments.dynamic is optional and additive — a manifest without it validates and renders exactly as today', () => {
  it('a real manifest with no treatments.dynamic key parses successfully and treatments.dynamic is undefined', () => {
    const parsed = ThemeManifestSchema.parse(REGISTRY_APP_THEMES.calm);
    expect(parsed.treatments.dynamic).toBeUndefined();
  });

  it('a manifest with a valid treatments.dynamic.banner also parses successfully (additive, not merely absent-tolerant)', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: {
        ...REGISTRY_APP_THEMES.calm.treatments,
        dynamic: { banner: VALID_DYNAMIC_BANNER },
      },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).not.toThrow();
  });

  it('a manifest with treatments.dynamic: {} (both banner/background absent) also parses successfully', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: { ...REGISTRY_APP_THEMES.calm.treatments, dynamic: {} },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).not.toThrow();
  });
});

describe('AC-STRUCT-1: .strict() rejects unknown keys at every treatments.dynamic nesting level', () => {
  it('an unknown key on treatments.dynamic itself fails', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: {
        ...REGISTRY_APP_THEMES.calm.treatments,
        dynamic: { notARealKey: {} },
      },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('an unknown key on treatments.dynamic.banner (the DynamicElement object) fails', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: {
        ...REGISTRY_APP_THEMES.calm.treatments,
        dynamic: { banner: { ...VALID_DYNAMIC_BANNER, foo: 'bar' } },
      },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('an unknown key on treatments.dynamic.banner.style (the StyleToken object) fails', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: {
        ...REGISTRY_APP_THEMES.calm.treatments,
        dynamic: {
          banner: { ...VALID_DYNAMIC_BANNER, style: { ...VALID_DYNAMIC_BANNER.style, foo: 'bar' } },
        },
      },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });
});

describe('AC-STRUCT-2: treatments.banner stays required even when treatments.dynamic.banner is present', () => {
  it('deleting treatments.banner while treatments.dynamic.banner is present still fails validation', () => {
    const { banner: _banner, ...restTreatments } = {
      ...REGISTRY_APP_THEMES.calm.treatments,
      dynamic: { banner: VALID_DYNAMIC_BANNER },
    };
    const fixture = { ...REGISTRY_APP_THEMES.calm, treatments: restTreatments };
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('sanity: the same fixture WITH treatments.banner present (the normal case) does not throw', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: {
        ...REGISTRY_APP_THEMES.calm.treatments,
        dynamic: { banner: VALID_DYNAMIC_BANNER },
      },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).not.toThrow();
  });
});

describe('AC-VAL-1: an unknown generator value fails validation', () => {
  it('generator: "not-a-real-generator" fails', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: {
        ...REGISTRY_APP_THEMES.calm.treatments,
        dynamic: {
          banner: { ...VALID_DYNAMIC_BANNER, generator: 'not-a-real-generator' },
        },
      },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('sanity: generator: "watercolor" (the one real catalog entry) does not throw', () => {
    const fixture = {
      ...REGISTRY_APP_THEMES.calm,
      treatments: {
        ...REGISTRY_APP_THEMES.calm.treatments,
        dynamic: { banner: VALID_DYNAMIC_BANNER },
      },
    };
    expect(() => ThemeManifestSchema.parse(fixture)).not.toThrow();
  });

  // ===========================================================================
  // AC-VAL-1 carried guarantee (generator-enum-catalog-sync): mirrors the
  // enum-catalog-schema-treatment-sync pattern above (line ~732), which pins
  // a schema enum against a REAL runtime registry object (e.g.
  // CARD_ELEVATION from treatments/elevation.ts). Upgraded from S1's
  // standalone placeholder (which pinned only `['watercolor']` as a literal,
  // since `DYNAMIC_GENERATORS` did not exist yet) now that S2's
  // `app/src/themes/treatments/dynamicVisuals.ts` exports it — this closes
  // the gap S1's examiner flagged (VQ-S1-002/VQ-S1-013): the schema enum is
  // now pinned against the real registry's keys, not a restated literal.
  // ===========================================================================
  describe('AC-VAL-1 carried guarantee (generator-enum-catalog-sync): schema generator enum options exactly match DYNAMIC_GENERATORS keys', () => {
    it("ThemeManifestSchema's dynamic.banner.generator enum options === Object.keys(DYNAMIC_GENERATORS)", () => {
      const options = ThemeManifestSchema.shape.treatments.shape.dynamic.unwrap().shape.banner.unwrap().shape.generator
        .options;
      expect(new Set(options)).toEqual(new Set(Object.keys(DYNAMIC_GENERATORS)));
    });

    it('sanity: today that set is exactly [\'watercolor\']', () => {
      expect(Object.keys(DYNAMIC_GENERATORS)).toEqual(['watercolor']);
    });
  });
});

describe('AC-VAL-2: style token bounds violations fail validation', () => {
  function fixtureWithStyle(style: Record<string, unknown>) {
    return {
      ...REGISTRY_APP_THEMES.calm,
      treatments: {
        ...REGISTRY_APP_THEMES.calm.treatments,
        dynamic: {
          banner: { ...VALID_DYNAMIC_BANNER, style },
        },
      },
    };
  }

  it('anchorHue: -1 fails', () => {
    const fixture = fixtureWithStyle({ ...VALID_DYNAMIC_BANNER.style, anchorHue: -1 });
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('anchorHue: 360 fails', () => {
    const fixture = fixtureWithStyle({ ...VALID_DYNAMIC_BANNER.style, anchorHue: 360 });
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('saturation: 19 fails', () => {
    const fixture = fixtureWithStyle({ ...VALID_DYNAMIC_BANNER.style, saturation: 19 });
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('saturation: 101 fails', () => {
    const fixture = fixtureWithStyle({ ...VALID_DYNAMIC_BANNER.style, saturation: 101 });
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('lightness: 19 fails', () => {
    const fixture = fixtureWithStyle({ ...VALID_DYNAMIC_BANNER.style, lightness: 19 });
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('lightness: 76 fails', () => {
    const fixture = fixtureWithStyle({ ...VALID_DYNAMIC_BANNER.style, lightness: 76 });
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  it('scheme: "not-a-real-scheme" fails', () => {
    const fixture = fixtureWithStyle({ ...VALID_DYNAMIC_BANNER.style, scheme: 'not-a-real-scheme' });
    expect(() => ThemeManifestSchema.parse(fixture)).toThrow();
  });

  // Full-membership pin (mutation-gate real-gap closure, 2026-07-06):
  // StyleTokenSchema's `scheme` enum is the converged ink contract (spec.md
  // §5) — "do not narrow or widen without re-confirming against
  // proposals/dynamic-banner/ink-channel-log.md". Only 'triadic',
  // 'monochromatic', and 'complementary' were previously exercised by other
  // tests in this block; a silent drop of 'analogous-accent' or
  // 'split-complementary' from the schema's z.enum(...) array would pass
  // every other test here. Enumerate all six so any narrowing is caught.
  it.each([
    ['monochromatic'],
    ['analogous'],
    ['analogous-accent'],
    ['split-complementary'],
    ['triadic'],
    ['complementary'],
  ])('scheme: %s validates successfully (full StyleTokenSchema.scheme enum membership)', (scheme) => {
    const fixture = fixtureWithStyle({ ...VALID_DYNAMIC_BANNER.style, scheme: scheme as never });
    expect(() => ThemeManifestSchema.parse(fixture)).not.toThrow();
  });

  it('sanity: a fully-valid style token at the boundary-inclusive minimums does NOT throw', () => {
    const fixture = fixtureWithStyle({ anchorHue: 0, scheme: 'monochromatic', saturation: 20, lightness: 20 });
    expect(() => ThemeManifestSchema.parse(fixture)).not.toThrow();
  });

  it('sanity: a fully-valid style token at the boundary-inclusive maximums does NOT throw', () => {
    const fixture = fixtureWithStyle({ anchorHue: 359, scheme: 'complementary', saturation: 100, lightness: 75 });
    expect(() => ThemeManifestSchema.parse(fixture)).not.toThrow();
  });
});

describe('AC-BOUND-1: treatments.dynamic addition introduces no new runtime zod importer', () => {
  it(
    "schema.ts remains the only file with the new DynamicElement/StyleToken/dynamic shapes, and the existing " +
      "resolved-import scanner (AC-BOUND-1 describe block above) already covers this story's change with no " +
      'modification needed — this test is a documentation/regression marker, not new scanning logic',
    () => {
      const source = fs.readFileSync(path.join(THEMES_DIR, 'schema.ts'), 'utf8');
      expect(source).toContain('DynamicElementSchema');
      expect(source).toContain('StyleTokenSchema');
    }
  );
});

// ===========================================================================
// Epic: dynamic-theme-visuals, Story S2 — dynamicVisuals.ts adapter +
// registry + stub (specs/epic-dynamic-theme-visuals/acceptance-criteria.md).
// Re-targeted at the real package by Story S7 (Phase B).
//
// AC-STRUCT-4 (verbatim): "The adapter MUST be the only module in app/src
// that imports the ink generator (or, in Phase A, the stub)." This is an
// invariant about who imports the underlying GENERATOR IMPLEMENTATION — the
// real `@rotheric/visuals` package (Phase B, S7; Phase A's inline stub
// before it) — NOT about who imports dynamicVisuals.ts's own public
// `DYNAMIC_GENERATORS` registry export. Per architecture.md's Seam Contracts
// ("DYNAMIC_GENERATORS registry (dynamicVisuals.ts -> useDynamicBanner.ts)")
// and Module Map ("banner.worker.ts": a pure message-passing wrapper around
// dynamicVisuals's generator call), S3's useDynamicBanner.ts and S5's
// banner.worker.ts are BOTH required to import that registry — that fan-out
// is the intended design, not a violation.
//
// (Stage-1 review, S2->S3 gate-remediation fix): an earlier version of this
// block asserted the opposite — that NO other file may runtime-resolve an
// import to dynamicVisuals.ts itself. That assertion was modeled on the
// zod-boundary check above (AC-BOUND-1), but AC-BOUND-1 is a two-part
// invariant: (1) only schema.ts imports zod, and (2) no client file
// runtime-imports schema.ts — and part (2) only works because schema.ts's
// runtime export is build-time-only, never meant to be imported by client
// code. dynamicVisuals.ts's runtime export (DYNAMIC_GENERATORS) IS the
// client-facing feature; consumption is the point. The old assertion was
// unsatisfiable given the design — it would go red the moment S3 wires up
// its own legitimate import. This block now checks the actually-relevant
// half: no other module in app/src holds a runtime import of the bare
// `@rotheric/visuals` specifier. Prior to S7, this was vacuously true (the
// stub lived entirely inline inside dynamicVisuals.ts — no separate
// importable module existed for the check to catch yet); as of S7 the real
// package is installed and imported by dynamicVisuals.ts alone, so this is
// now the live single-import-site guard (VQ-S7-004: reverting
// dynamicVisuals.ts's import back to the stub would not, on its own, flip
// this specific describe block red — see its own re-verification note below
// — but the bare-specifier constant change below re-targets the guard at
// the real package for the first time).
// ===========================================================================

/**
 * True when `source` has a RUNTIME (non-`type`-only) import of the exact
 * bare specifier `bareSpecifier` (e.g. `@rotheric/visuals`). Bare/package
 * specifiers don't resolve relative to anything, so this compares the raw
 * specifier string rather than reusing `resolveSpecifierAbs` (which returns
 * `null` for bare specifiers by design — see its doc comment above).
 * Reuses `parseImports` (runtime vs type-only classification) defined above
 * for AC-BOUND-1; this is not a literal text grep, so it discriminates
 * type-only imports and unrelated/lookalike specifiers correctly (see the
 * self-test block below).
 */
function hasRuntimeBareImport(source: string, bareSpecifier: string): boolean {
  return parseImports(source).some((imp) => imp.isRuntime && imp.specifier === bareSpecifier);
}

/** The real ink generator package (Phase B, S7). Was `@ink/visuals` (a name that never
 * existed — a naming error in the epic's original spec, corrected 2026-07-06) in Phase A's
 * doc-only placeholder form; the actual published package name is `@rotheric/visuals`. */
const INK_GENERATOR_BARE_SPECIFIER = '@rotheric/visuals';

const SRC_DIR = path.join(APP_ROOT, 'src');
const DYNAMIC_VISUALS_FILE_ABS = path.join(THEMES_DIR, 'treatments', 'dynamicVisuals.ts');

/**
 * Recursively collects every `.ts`/`.tsx` file under `dir`, excluding
 * `dynamicVisuals.ts` itself (the ONE module AC-STRUCT-4 permits to import
 * the generator/stub) and any test file. Derived from the filesystem for
 * the same reason `collectTsFilesRecursive` (AC-BOUND-1, above) is: a
 * future module added anywhere under app/src is automatically in scope
 * with no edit to this test required — the scan is over ALL of app/src
 * (AC-STRUCT-4's stated scope), not just src/themes/.
 */
async function collectSrcFilesRecursiveExcludingDynamicVisuals(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectSrcFilesRecursiveExcludingDynamicVisuals(entryPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    if (entryPath === DYNAMIC_VISUALS_FILE_ABS) continue;
    results.push(entryPath);
  }
  return results;
}

describe('AC-STRUCT-4: dynamicVisuals.ts is the only module in app/src with a runtime import of the ink generator (bare `@rotheric/visuals` specifier)', () => {
  let srcFiles: string[] = [];

  beforeAll(async () => {
    srcFiles = (await collectSrcFilesRecursiveExcludingDynamicVisuals(SRC_DIR)).sort();
  });

  it("the derived scan set is non-empty and covers app/src (glob has teeth: an empty/broken glob cannot make the guard vacuously pass)", () => {
    expect(srcFiles.length).toBeGreaterThan(10);
    expect(srcFiles).not.toContain(DYNAMIC_VISUALS_FILE_ABS);
    // Sanity: a known sibling treatments/* file is present in the scan.
    expect(srcFiles).toContain(path.join(THEMES_DIR, 'treatments', 'elevation.ts'));
  });

  it('the scan set genuinely spans app/src beyond src/themes/ — hooks/ and components/ (the two directories S3/S4 will add dynamicVisuals.ts consumers to) are included today (post-impl VQ-S2-015)', () => {
    expect(srcFiles).toContain(path.join(APP_ROOT, 'src', 'hooks', 'useThemeStyles.ts'));
    expect(srcFiles).toContain(path.join(APP_ROOT, 'src', 'components', 'Layout.tsx'));
  });

  it("none of app/src's other files has a RUNTIME import of the bare `@rotheric/visuals` specifier (S7: the package is now installed, so this is the live single-import-site guard)", () => {
    expect(srcFiles.length).toBeGreaterThan(10); // sanity: beforeAll populated it
    for (const absPath of srcFiles) {
      const source = fs.readFileSync(absPath, 'utf8');
      expect(
        hasRuntimeBareImport(source, INK_GENERATOR_BARE_SPECIFIER),
        `${path.relative(APP_ROOT, absPath)} has a runtime import of the bare '${INK_GENERATOR_BARE_SPECIFIER}' specifier`
      ).toBe(false);
    }
  });

  it("does NOT flag S3/S5's legitimate `DYNAMIC_GENERATORS` consumption of dynamicVisuals.ts — proves this fix does not regress the intended registry fan-out", () => {
    // Sanity fixture standing in for what useDynamicBanner.ts (S3) and
    // banner.worker.ts (S5) both legitimately do per architecture.md's Seam
    // Contracts: import the public registry export from dynamicVisuals.ts.
    // This must NOT trip the bare-`@rotheric/visuals`-specifier check above.
    const fixture = `import { DYNAMIC_GENERATORS } from '@/src/themes/treatments/dynamicVisuals';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(false);
  });
});

describe('AC-STRUCT-4: bare-specifier scanner self-test for the ink generator import (proves the scanner discriminates, not just passes)', () => {
  it('flags a runtime named import of the bare `@rotheric/visuals` specifier (the exact regression this scanner guards against)', () => {
    const fixture = `import { renderSVG } from '@rotheric/visuals';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(true);
  });

  it('does NOT flag a type-only import of `@rotheric/visuals`', () => {
    const fixture = `import type { RenderOptions } from '@rotheric/visuals';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(false);
  });

  it('flags a mixed import where only one named binding carries an inline `type` modifier', () => {
    const fixture = `import { type RenderOptions, renderSVG } from '@rotheric/visuals';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(true);
  });

  it('flags a namespace import of `@rotheric/visuals`', () => {
    const fixture = `import * as ink from '@rotheric/visuals';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(true);
  });

  it('flags a default import of `@rotheric/visuals`', () => {
    const fixture = `import ink from '@rotheric/visuals';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(true);
  });

  it('flags a side-effect import of `@rotheric/visuals`', () => {
    const fixture = `import '@rotheric/visuals';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(true);
  });

  it('does NOT flag an unrelated bare specifier (no false positive)', () => {
    const fixture = `import { z } from 'zod';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(false);
  });

  it("does NOT flag a lookalike scoped specifier like `@rotheric/visuals-extra` (no substring false positive — exact match only)", () => {
    const fixture = `import { renderSVG } from '@rotheric/visuals-extra';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(false);
  });

  it("does NOT flag dynamicVisuals.ts's own public `DYNAMIC_GENERATORS` export — the legitimate S3/S5 fan-out this fix must not block", () => {
    const fixture = `import { DYNAMIC_GENERATORS } from '@/src/themes/treatments/dynamicVisuals';\n`;
    expect(hasRuntimeBareImport(fixture, INK_GENERATOR_BARE_SPECIFIER)).toBe(false);
  });
});
