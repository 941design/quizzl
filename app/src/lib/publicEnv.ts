// Next.js inlines NEXT_PUBLIC_* env vars at build time, but only when the
// reference is the bare token `process.env.NEXT_PUBLIC_X`. Any guard
// (`typeof process !== 'undefined'`) or optional chaining (`process.env?.X`)
// defeats the static replacement and leaves a runtime lookup against the
// browser's empty `process` shim — which always returns undefined.
export function getNextPublicBlossomBaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_BLOSSOM_BASE_URL;
}

export function getNextPublicBlossomTrustedHosts(): string | undefined {
  return process.env.NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS;
}

export function getNextPublicLogLevel(): string | undefined {
  return process.env.NEXT_PUBLIC_LOG_LEVEL;
}
