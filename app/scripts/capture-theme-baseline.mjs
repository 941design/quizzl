// Captures a frozen "parity fixture" snapshot of specific subtrees of
// `getChakraTheme(id)` (from src/lib/theme.ts, pre-refactor) for all five
// app themes, and writes it to tests/unit/theme-baseline.generated.ts.
//
// Why this exists: a later story refactors theme.ts into src/themes/. This
// script freezes today's output on a fixed ALLOWLIST of subtrees so that
// refactor can be asserted byte-for-byte equivalent on those subtrees.
//
// Mechanism: theme.ts is TypeScript but has no runtime dependency on any
// path-aliased module (its only value-level import is the real npm package
// `@chakra-ui/react`; its other import, `AppThemeName`, is a type-only
// import and is fully erased). We use the `typescript` package (already a
// devDependency) to strip the TS syntax via `ts.transpileModule`, write the
// result to a throwaway temp .mjs file inside this directory (so Node's
// node_modules resolution walk finds app/node_modules), dynamically import
// it, call getChakraTheme for each theme id, and pick the allowlisted
// subtrees.
//
// Usage: node app/scripts/capture-theme-baseline.mjs (from anywhere — paths
// are resolved relative to this script's own location, not process.cwd()).

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..');
const THEME_SOURCE_PATH = path.join(APP_DIR, 'src', 'lib', 'theme.ts');
const OUTPUT_PATH = path.join(APP_DIR, 'tests', 'unit', 'theme-baseline.generated.ts');

const THEME_IDS = ['calm', 'playful', 'lego', 'minecraft', 'flower'];

// Fixed emission order for components — never rely on object iteration
// order, which is not guaranteed to be stable across engines/versions for
// this purpose (and is a deliberate readability/determinism choice here).
const COMPONENT_NAMES = ['Button', 'Tabs', 'Progress', 'Badge', 'Tag', 'Checkbox', 'Radio'];

const TOP_LEVEL_KEYS = ['colors', 'semanticTokens', 'fonts', 'fontSizes', 'radii', 'styles', 'config'];

const HEADER = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Produced by \`node app/scripts/capture-theme-baseline.mjs\`, which captures a
// fixed ALLOWLIST of subtrees from the pre-refactor \`getChakraTheme(id)\` export
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
// IMPORTANT — parity assertion must use \`toEqual\`, NEVER \`toStrictEqual\`:
// this file is a JSON literal, so it cannot represent own-enumerable keys
// whose value is \`undefined\` (e.g. \`styles.global.body.backgroundImage:
// undefined\` and its sibling background* keys, present for the calm/playful
// themes — see theme.ts's \`styles.global.body\`). \`toEqual\` treats an
// undefined-valued key as equal to an absent key, so this fixture round-trips
// safely under it. \`toStrictEqual\` does NOT make that allowance and WOULD
// spuriously fail for every theme carrying such a key. The S2 AC-PARITY-1
// assertion (\`expect(pick(getChakraTheme(id), ALLOWLIST)).toEqual(baseline[id])\`)
// MUST use \`toEqual\` and MUST NOT use \`toStrictEqual\`.
`;

/**
 * Transpiles theme.ts to plain ESM JS via the TypeScript compiler API (no
 * type-checking program needed — transpileModule is a syntax-only strip,
 * and theme.ts's only non-type-only import is the real @chakra-ui/react
 * package), writes it to a temp file colocated with this script so Node's
 * node_modules resolution finds app/node_modules, dynamically imports it,
 * and returns the resulting module. Caller is responsible for cleanup of
 * the returned tempFilePath.
 */
function transpileThemeModule() {
  const src = fs.readFileSync(THEME_SOURCE_PATH, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'theme.ts',
  });

  const tempFileName = `.theme-baseline-capture-${crypto.randomUUID()}.mjs`;
  const tempFilePath = path.join(SCRIPT_DIR, tempFileName);
  fs.writeFileSync(tempFilePath, outputText, 'utf8');
  return tempFilePath;
}

/**
 * Picks the ALLOWLIST subtrees from a single theme's getChakraTheme(id)
 * output.
 */
function pickAllowlist(chakraTheme, id) {
  if (chakraTheme === null || typeof chakraTheme !== 'object') {
    throw new Error(`getChakraTheme('${id}') returned a non-object value (${String(chakraTheme)}).`);
  }

  const picked = {};
  for (const key of TOP_LEVEL_KEYS) {
    picked[key] = chakraTheme[key];
  }

  const components = {};
  for (const name of COMPONENT_NAMES) {
    const defaultProps = chakraTheme.components?.[name]?.defaultProps;
    if (defaultProps === null || typeof defaultProps !== 'object') {
      throw new Error(
        `getChakraTheme('${id}') has no 'defaultProps' object at components.${name} ` +
          `(got: ${String(defaultProps)}). Aborting without writing any output — a ` +
          `silently-captured {} here would freeze a hole in the AC-PARITY-1 fixture.`,
      );
    }
    components[name] = { defaultProps };
  }
  picked.components = components;

  return picked;
}

/**
 * Recursively walks a picked allowlist object and throws a clear error
 * (naming the theme id and the dotted path) if a function is found
 * anywhere in the subtree.
 */
function assertNoFunctions(value, id, dottedPath) {
  if (typeof value === 'function') {
    throw new Error(`getChakraTheme('${id}') allowlist subtree contains a function at '${dottedPath}'.`);
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoFunctions(item, id, `${dottedPath}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assertNoFunctions(nested, id, dottedPath ? `${dottedPath}.${key}` : key);
  }
}

/**
 * Deep-equality check for the JSON round-trip assertion. Uses Jest
 * `toEqual`-compatible semantics: an own property with value `undefined`
 * is treated as equivalent to that key being absent altogether. This
 * matters here because theme.ts's `styles.global.body` genuinely carries
 * explicit `undefined`-valued keys (e.g. `backgroundImage: undefined` for
 * themes that don't set one) — JSON.stringify legitimately drops those
 * keys on serialization, and that is not information loss in any sense
 * that matters (an absent key and an undefined-valued key are
 * indistinguishable to every consumer of this object), so the round-trip
 * check must not flag it as a mismatch.
 */
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const aValue = a[key];
    const bValue = b[key];
    if (aValue === undefined && bValue === undefined) continue;
    if (!deepEqual(aValue, bValue)) return false;
  }
  return true;
}

/**
 * Asserts JSON.parse(JSON.stringify(picked)) deep-equals picked, using the
 * toEqual-compatible deepEqual above — which, by design, tolerates an
 * own undefined-valued key being elided by JSON.stringify (that key and an
 * absent key are treated as equal, matching Jest/Vitest `toEqual`
 * semantics). This check does NOT prove "nothing is lost"; it deliberately
 * does not flag undefined-key elision. What it does catch is
 * value-altering serialization loss: a Symbol silently dropped, a NaN
 * silently turned into null, or a function found in a leaf position that
 * JSON would silently drop (assertNoFunctions above already aborts on
 * functions earlier in the pipeline, but this is a second, independent
 * backstop). Throws a clear error naming the theme id if such a
 * non-tolerated mismatch is found.
 */
function assertJsonRoundTrip(picked, id) {
  const roundTripped = JSON.parse(JSON.stringify(picked));
  if (!deepEqual(roundTripped, picked)) {
    throw new Error(
      `getChakraTheme('${id}') allowlist subtree is not JSON round-trip-safe ` +
        `(JSON.parse(JSON.stringify(picked)) !== picked). This usually means ` +
        `the subtree contains a value JSON silently drops or alters ` +
        `(undefined, a function, a Symbol, etc.).`,
    );
  }
}

function renderThemeLiteral(picked) {
  // JSON is a syntactic subset of JS/TS object literals, so
  // JSON.stringify(picked, null, 2) is directly usable as a TS literal.
  return JSON.stringify(picked, null, 2);
}

function indent(text, spaces) {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join('\n');
}

function buildOutputFile(baselineById) {
  const entries = THEME_IDS.map((id) => {
    const literal = renderThemeLiteral(baselineById[id]);
    return `  ${id}: ${indent(literal, 2).trimStart()},`;
  }).join('\n');

  return `${HEADER}
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
${entries}
};
`;
}

async function main() {
  let tempFilePath;
  try {
    tempFilePath = transpileThemeModule();

    const themeModule = await import(pathToFileURL(tempFilePath).href);
    const { getChakraTheme } = themeModule;

    if (typeof getChakraTheme !== 'function') {
      throw new Error(
        `theme.ts did not export a callable 'getChakraTheme' after transpilation ` +
          `(got: ${typeof getChakraTheme}). Aborting without writing any output.`,
      );
    }

    const baselineById = {};
    for (const id of THEME_IDS) {
      let chakraTheme;
      try {
        chakraTheme = getChakraTheme(id);
      } catch (error) {
        throw new Error(`getChakraTheme('${id}') threw: ${error?.stack ?? error}`);
      }

      if (chakraTheme === null || chakraTheme === undefined) {
        throw new Error(`getChakraTheme('${id}') returned ${String(chakraTheme)}.`);
      }

      const picked = pickAllowlist(chakraTheme, id);
      assertNoFunctions(picked, id, '');
      assertJsonRoundTrip(picked, id);
      baselineById[id] = picked;
    }

    // All five ids succeeded and passed both checks — only now do we write.
    const outputContent = buildOutputFile(baselineById);
    await fsPromises.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fsPromises.writeFile(OUTPUT_PATH, outputContent, 'utf8');

    console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  } finally {
    if (tempFilePath) {
      await fsPromises.rm(tempFilePath, { force: true });
    }
  }
}

main().catch((error) => {
  console.error(`[capture-theme-baseline] FAILED: ${error?.message ?? error}`);
  process.exitCode = 1;
});
