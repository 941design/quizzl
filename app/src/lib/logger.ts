import { getNextPublicLogLevel } from '@/src/lib/publicEnv';

/**
 * Minimal namespaced logger. The active level is read from
 * `NEXT_PUBLIC_LOG_LEVEL` (one of: silent | error | warn | info | debug).
 * Default is `warn`. Unknown values fall back to the default.
 *
 * Next.js inlines `NEXT_PUBLIC_*` env vars at build time, so reading per
 * call is effectively a constant lookup — no caching needed.
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;
export type LogLevel = keyof typeof LEVELS;

const DEFAULT_LEVEL: LogLevel = 'warn';

function currentLevelValue(): number {
  const raw = getNextPublicLogLevel() || DEFAULT_LEVEL;
  const key = raw.toLowerCase() as LogLevel;
  return key in LEVELS ? LEVELS[key] : LEVELS[DEFAULT_LEVEL];
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(namespace: string): Logger {
  const tag = `[${namespace}]`;
  return {
    debug: (...args) => {
      if (currentLevelValue() >= LEVELS.debug) console.debug(tag, ...args);
    },
    info: (...args) => {
      if (currentLevelValue() >= LEVELS.info) console.info(tag, ...args);
    },
    warn: (...args) => {
      if (currentLevelValue() >= LEVELS.warn) console.warn(tag, ...args);
    },
    error: (...args) => {
      if (currentLevelValue() >= LEVELS.error) console.error(tag, ...args);
    },
  };
}
