import type { EventSigner } from 'applesauce-core';
import { BLOSSOM_BASE_URL } from '@/src/config/blossom';

export class BlossomUploadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'BlossomUploadError';
  }
}

export class BlossomNotFoundError extends Error {
  constructor(sha256: string) {
    super(`Blob not found: ${sha256}`);
    this.name = 'BlossomNotFoundError';
  }
}

export class BlossomOriginError extends Error {
  constructor(blobUrl: string) {
    super(`Blob URL origin not allowed: ${blobUrl}`);
    this.name = 'BlossomOriginError';
  }
}

/**
 * Strict validation of a URL returned by *our* Blossom upload response.
 *
 * Used at upload time only: the server we just uploaded to must hand back a
 * URL on its own configured origin. A mismatch is a server-config bug, not a
 * transient failure — we surface it to the caller before stamping the URL
 * into outbound message metadata.
 */
export function assertAllowedBlossomUrl(blobUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(blobUrl);
  } catch {
    throw new BlossomOriginError(blobUrl);
  }
  const allowed = new URL(BLOSSOM_BASE_URL);
  if (parsed.origin !== allowed.origin) {
    throw new BlossomOriginError(blobUrl);
  }
  return parsed;
}

/**
 * Resolves the set of trusted Blossom origins from configuration.
 *
 * Defaults to the operator's own `BLOSSOM_BASE_URL`. Federation is opt-in:
 * additional origins are listed in `NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS` as a
 * comma-separated list. Read at call time so test stubs and server-side
 * config reloads take effect without re-importing the module.
 */
function getTrustedOrigins(): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(BLOSSOM_BASE_URL).origin);
  } catch {
    // BLOSSOM_BASE_URL itself is invalid — origin set stays empty, every
    // download fails closed until the operator fixes the config.
  }
  const extra =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS) || '';
  for (const raw of extra.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Drop malformed entries; do not let a typo in the env var open a
      // bypass or disable the canonical origin.
    }
  }
  return origins;
}

/**
 * Validation of an inbound attachment URL before download.
 *
 * Receivers fetch only from origins on the operator-configured allowlist —
 * the local `BLOSSOM_BASE_URL` plus any origins explicitly listed in
 * `NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS`. Without this gate, any group member
 * could publish an attachment URL pointing at an attacker-controlled host
 * and every receiver would issue a background GET to it on render — a
 * trivial SSRF / IP-disclosure surface. Federation across non-default
 * Blossom servers is supported, but only when the operator opts in.
 */
export function assertDownloadableBlobUrl(blobUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(blobUrl);
  } catch {
    throw new BlossomOriginError(blobUrl);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BlossomOriginError(blobUrl);
  }
  const allowed = getTrustedOrigins();
  if (!allowed.has(parsed.origin)) {
    throw new BlossomOriginError(blobUrl);
  }
  return parsed;
}

export const RETRY_DELAYS = [500, 1500, 5000];

/**
 * Per-request timeout for Blossom upload/download. A stalled TCP connection
 * or hanging server response would otherwise leave the composer/lightbox
 * stuck in `uploading`/`loading` forever — the abort path turns that into
 * a retryable (upload) or terminal (download) failure.
 */
export const REQUEST_TIMEOUT_MS = 30000;

export class BlossomTimeoutError extends Error {
  constructor(operation: 'upload' | 'download') {
    super(`Blossom ${operation} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    this.name = 'BlossomTimeoutError';
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  operation: 'upload' | 'download',
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new BlossomTimeoutError(operation);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function buildBlossomAuthEvent(
  signer: EventSigner,
  ciphertextSha256: string,
): Promise<Record<string, unknown>> {
  const pubkey = await signer.getPublicKey();
  const now = Math.floor(Date.now() / 1000);
  const draft = {
    kind: 24242,
    created_at: now,
    content: 'quizzl image upload',
    tags: [
      ['t', 'upload'],
      ['x', ciphertextSha256],
      ['expiration', String(now + 300)],
    ],
    pubkey,
  };
  return signer.signEvent(draft) as Promise<Record<string, unknown>>;
}

function encodeAuthHeader(event: Record<string, unknown>): string {
  return 'Nostr ' + btoa(JSON.stringify(event));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function put(
  encryptedBytes: Uint8Array,
  signer: EventSigner,
  onProgress?: (pct: number) => void,
): Promise<string> {
  let lastError: unknown;

  // Materialize an exact ArrayBuffer matching the typed-array view so a
  // non-zero-offset or partial-length view does not leak surrounding bytes
  // into either the auth-event hash or the upload body.
  const bodyBuffer = encryptedBytes.buffer.slice(
    encryptedBytes.byteOffset,
    encryptedBytes.byteOffset + encryptedBytes.byteLength,
  ) as ArrayBuffer;
  const bodyHash = await sha256Hex(new Uint8Array(bodyBuffer));

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const authEvent = await buildBlossomAuthEvent(signer, bodyHash);

    try {
      const response = await fetchWithTimeout(
        `${BLOSSOM_BASE_URL}/upload`,
        {
          method: 'PUT',
          headers: {
            Authorization: encodeAuthHeader(authEvent),
            'Content-Type': 'application/octet-stream',
          },
          body: bodyBuffer,
        },
        REQUEST_TIMEOUT_MS,
        'upload',
      );

      if (response.status >= 400 && response.status < 500) {
        throw new BlossomUploadError(
          `Upload rejected: ${response.status} ${response.statusText}`,
          response.status,
        );
      }

      if (!response.ok) {
        lastError = new BlossomUploadError(
          `Upload failed: ${response.status} ${response.statusText}`,
          response.status,
        );
        if (attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        throw lastError;
      }

      const json = await response.json();
      const rawUrl = json.url as string;
      // Validate the server-returned URL against the allowed Blossom origin
      // before stamping it into outbound message metadata. A misconfigured
      // server that responds with a non-canonical origin would otherwise
      // produce attachments every receiver rejects as BlossomOriginError.
      assertAllowedBlossomUrl(rawUrl);
      onProgress?.(100);
      return rawUrl;
    } catch (err) {
      if (err instanceof BlossomUploadError && err.status !== undefined && err.status < 500) {
        throw err;
      }
      // Origin mismatch in the upload response is a server-config bug,
      // not a transient failure — fail immediately rather than retry.
      if (err instanceof BlossomOriginError) {
        throw err;
      }
      lastError = err;
      if (attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  // Preserve the original error subclass (BlossomUploadError, BlossomTimeoutError,
  // ...) so callers can react to specific failure modes — wrapping everything
  // in BlossomUploadError would mask retryable-vs-terminal distinctions.
  if (lastError instanceof Error) throw lastError;
  throw new BlossomUploadError(String(lastError));
}

export async function get(blobUrl: string): Promise<Uint8Array> {
  const validated = assertDownloadableBlobUrl(blobUrl);
  const response = await fetchWithTimeout(
    validated.toString(),
    {},
    REQUEST_TIMEOUT_MS,
    'download',
  );

  if (response.status === 404) {
    const sha256 = validated.pathname.split('/').pop() ?? blobUrl;
    throw new BlossomNotFoundError(sha256);
  }

  if (!response.ok) {
    throw new BlossomUploadError(
      `Download failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // TS 5.7 narrows `BufferSource` to `ArrayBufferView<ArrayBuffer>`, but in
  // this codebase we never use SharedArrayBuffer-backed views — cast through
  // `unknown` to satisfy the digest signature without copying the bytes.
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
