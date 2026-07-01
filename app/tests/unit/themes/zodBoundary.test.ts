import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Early guard for AC-BOUND-1 / architecture.md Implementation Constraint 16,
// scoped to the modules this story (S1) introduces. The FULL architectural
// scan (walking every client-bundle-reachable module transitively, including
// manifests/registry/_document/useThemeStyles/ThemeIcon once they exist) is
// story S3's themes-validation.test.ts responsibility — this test exists so
// a zod-boundary regression inside S1's own files is caught immediately
// rather than waiting for S3.
const themesDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../src/themes');
// The repo's '@/*' path alias resolves to the app/ root (see tsconfig.json
// and vitest.config.ts's `resolve.alias['@']`), one level above src/themes.
const appRoot = path.resolve(themesDir, '../..');

function readSource(relativePath: string): string {
  return readFileSync(path.join(themesDir, relativePath), 'utf8');
}

/** Matches a runtime import statement whose source is exactly `zod`. */
const RUNTIME_ZOD_IMPORT = /^\s*import\s+(?!type\s)[^;]*\sfrom\s+['"]zod['"]/m;

const THEMES_MODULES_S1 = [
  'buildChakraTheme.ts',
  'fontUnion.ts',
  'contrast.ts',
  'index.ts',
  'treatments/elevation.ts',
  'treatments/iconSets.ts',
  'treatments/patterns.ts',
] as const;

// --- resolved-target import scanner -----------------------------------
//
// VQ-S1-013 hardening: the boundary guard above only asserts that no
// *literal* `zod` runtime import appears outside schema.ts. It does not
// catch an aliased runtime import of schema.ts itself (e.g.
// `import schema from './schema'` or `import { ThemeManifestSchema } from
// '../schema'`), which would reintroduce the zod dependency transitively
// without ever containing the substring `zod`. The scanner below closes
// that gap by parsing each module's `import` statements, resolving each
// specifier to an absolute path (honoring relative specifiers AND the
// repo's `@/*` alias), and checking whether the RESOLVED TARGET is
// schema.ts — not a `./schema` substring match, so `@/src/themes/schema`
// and any other alias/relative spelling of the same target are also
// caught. Each import is further classified as `runtime` or `type-only`
// per TypeScript's type-only-import erasure rules, so a `import type { X }
// from './schema'` (which produces no runtime dependency edge and is the
// documented, intended pattern per schema.ts's own header comment) is not
// flagged, while a runtime edge — including a *mixed* import where only
// some named bindings carry an inline `type` modifier — is.

const SCHEMA_ABS_PATH = path.join(themesDir, 'schema.ts').replace(/\.ts$/, '');

/**
 * Resolves an import specifier found in `fromFile` (a path relative to
 * `themesDir`, e.g. `'treatments/elevation.ts'`) to an absolute,
 * extension-normalized path. Returns `null` for bare/package specifiers
 * (e.g. `'zod'`, `'@chakra-ui/react'`) this resolver has no rule for —
 * callers only care whether the result equals `SCHEMA_ABS_PATH`.
 */
function resolveImportSpecifier(specifier: string, fromFile: string): string | null {
  let target: string;
  if (specifier.startsWith('.')) {
    target = path.resolve(path.dirname(path.join(themesDir, fromFile)), specifier);
  } else if (specifier.startsWith('@/')) {
    target = path.resolve(appRoot, specifier.slice(2));
  } else {
    return null;
  }
  return target.replace(/\.(ts|tsx)$/, '');
}

function resolvesToSchema(specifier: string, fromFile: string): boolean {
  return resolveImportSpecifier(specifier, fromFile) === SCHEMA_ABS_PATH;
}

type ParsedImport = { specifier: string; isRuntime: boolean };

/** True when a `{ ... }` named-import clause pulls in at least one runtime (non-`type`-prefixed) binding. */
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

/**
 * Extracts every `import` statement from a TS source string (including
 * side-effect imports) and classifies each as `runtime` or type-only.
 */
function parseImports(source: string): ParsedImport[] {
  const results: ParsedImport[] = [];
  // Alternative 1: `import [type] <clause> from '<specifier>'`.
  // Alternative 2: bare side-effect `import '<specifier>'` (no `from`).
  // Anchored to the START of a line (the `m` flag + `^`) so that a
  // trailing occurrence of the word "import" inside a `//` doc-comment
  // (e.g. "...no runtime `schema.ts` import") can never be mistaken for
  // the start of a real import statement — without the anchor, a non-
  // greedy clause spanning newlines would run past the comment and
  // latch onto the next real `from '...'` clause it found, misreporting
  // that statement's specifier. The clause itself excludes `;` (real
  // import clauses never contain one) rather than being fully unbounded,
  // as a second guard against over-matching, while still allowing a
  // clause to span multiple lines for a multi-line named-import list.
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

function hasRuntimeSchemaImport(source: string, fromFile: string): boolean {
  return parseImports(source).some((imp) => imp.isRuntime && resolvesToSchema(imp.specifier, fromFile));
}

function hasAnySchemaImport(source: string, fromFile: string): boolean {
  return parseImports(source).some((imp) => resolvesToSchema(imp.specifier, fromFile));
}

describe('themes zod boundary (S1 scope)', () => {
  it('schema.ts is the only module with a runtime zod import', () => {
    expect(RUNTIME_ZOD_IMPORT.test(readSource('schema.ts'))).toBe(true);
  });

  it.each(THEMES_MODULES_S1)('%s has no runtime zod import (literal substring check)', (relativePath) => {
    expect(RUNTIME_ZOD_IMPORT.test(readSource(relativePath))).toBe(false);
  });

  it.each(THEMES_MODULES_S1)('%s has no RUNTIME import that RESOLVES to schema.ts', (relativePath) => {
    const source = readSource(relativePath);
    expect(hasRuntimeSchemaImport(source, relativePath)).toBe(false);
  });

  // fontUnion.ts and contrast.ts are documented (architecture.md Boundary
  // Rules, and each file's own header comment) as importing `ThemeManifest`
  // from schema.ts as a TYPE ONLY, precisely so their function signatures
  // can be typed against the manifest shape without creating a runtime
  // dependency edge — schema.ts's own header comment states this is the
  // required pattern for every client-reachable module. A stricter
  // "zero import of schema.ts at all (type or runtime)" assertion would
  // fail against this — and correct — source, and could only be satisfied
  // by editing fontUnion.ts/contrast.ts to stop typing against
  // `ThemeManifest`, which is out of this test-only story's scope. What
  // AC-BOUND-1 actually requires — no zod dependency reaching these pure
  // modules at runtime — is fully covered by the runtime-import checks
  // above; this test additionally pins down that whatever schema.ts edge
  // these two files do carry stays type-only, so a future regression to a
  // *runtime* schema.ts import is still caught even though a type-only one
  // is legitimate.
  it('fontUnion.ts and contrast.ts reference schema.ts (for the ThemeManifest type) as a type-only import only', () => {
    for (const file of ['fontUnion.ts', 'contrast.ts'] as const) {
      const source = readSource(file);
      expect(hasAnySchemaImport(source, file)).toBe(true);
      expect(hasRuntimeSchemaImport(source, file)).toBe(false);
    }
  });

  it('fontUnion.ts and contrast.ts have no import statement referencing zod at all (type or runtime)', () => {
    const ANY_ZOD_IMPORT = /^\s*import[^;]*from\s+['"]zod['"]/m;
    expect(ANY_ZOD_IMPORT.test(readSource('fontUnion.ts'))).toBe(false);
    expect(ANY_ZOD_IMPORT.test(readSource('contrast.ts'))).toBe(false);
  });

  it('treatments/* import @chakra-ui/react (if at all) as a type-only import', () => {
    for (const file of ['treatments/elevation.ts', 'treatments/patterns.ts']) {
      const source = readSource(file);
      const chakraImport = source.match(/^\s*import[^;]*from\s+['"]@chakra-ui\/react['"]/m);
      if (chakraImport) {
        expect(chakraImport[0]).toMatch(/import type/);
      }
    }
  });
});

describe('resolved-target schema-import detector (self-test — proves the scanner has teeth)', () => {
  // Synthetic module path; never read from disk. Only used so
  // `resolveImportSpecifier` has a directory to resolve relative
  // specifiers against (as if this fixture module lived at themesDir root).
  const FIXTURE_FILE = 'fixtureModule.ts';
  const FIXTURE_FILE_NESTED = 'treatments/fixtureModule.ts';

  it('flags a runtime named import of a schema.ts binding (the exact regression this test guards against)', () => {
    const fixture = `import { ThemeManifestSchema } from './schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(true);
  });

  it('does NOT flag a type-only import of a schema.ts binding', () => {
    const fixture = `import type { ThemeManifest } from './schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(false);
  });

  it('flags a mixed import where only one named binding carries an inline `type` modifier', () => {
    const fixture = `import { type ThemeManifest, ThemeManifestSchema } from './schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(true);
  });

  it('does NOT flag a named import where every binding carries an inline `type` modifier', () => {
    const fixture = `import { type ThemeManifest, type ThemeManifestSchema } from './schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(false);
  });

  it('flags a default import of schema.ts', () => {
    const fixture = `import schema from './schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(true);
  });

  it('flags a namespace import of schema.ts', () => {
    const fixture = `import * as schema from './schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(true);
  });

  it('flags a side-effect import of schema.ts', () => {
    const fixture = `import './schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(true);
  });

  it('flags a runtime import resolved via the `../schema` relative form from a nested module', () => {
    const fixture = `import { ThemeManifestSchema } from '../schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE_NESTED)).toBe(true);
  });

  it('flags a runtime import resolved via the repo `@/` path alias', () => {
    const fixture = `import { ThemeManifestSchema } from '@/src/themes/schema';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(true);
  });

  it('does NOT flag an import of an unrelated module (no false positive)', () => {
    const fixture = `import { extendTheme } from '@chakra-ui/react';\nimport type { ThemeConfig } from '@chakra-ui/react';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(false);
  });

  it('does NOT flag a `../schema`-like specifier that resolves to a DIFFERENT file (no substring false positive)', () => {
    // Guards against a naive `./schema` substring match: this specifier
    // contains the substring but resolves to `schemaExtras.ts`, not
    // `schema.ts`.
    const fixture = `import { Extra } from './schemaExtras';\n`;
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(false);
  });

  it('does NOT let a trailing "import" mention inside a doc-comment latch onto a later real import statement', () => {
    // Regression fixture for a bug caught while hardening this very
    // scanner: a doc-comment line ending in the bare word "import" (e.g.
    // "...no runtime `schema.ts` import") was, before this test file's
    // `IMPORT_RE` was anchored to line-start, mistaken for the start of an
    // import statement. A non-greedy, newline-spanning clause then ran
    // past the comment and matched the *next* real `from '...'` clause it
    // found, misreporting a type-only import as runtime (or vice versa).
    const fixture = [
      '// Pure module — no runtime `schema.ts` import',
      '// (see architecture.md Boundary Rules)',
      "import type { ThemeManifest } from './schema';",
      '',
      'export function noop(x: ThemeManifest): void {}',
      '',
    ].join('\n');
    expect(hasRuntimeSchemaImport(fixture, FIXTURE_FILE)).toBe(false);
    expect(hasAnySchemaImport(fixture, FIXTURE_FILE)).toBe(true);
  });
});
