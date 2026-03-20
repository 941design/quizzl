/**
 * Minimal crypto.subtle polyfill for non-secure contexts (plain HTTP).
 *
 * Browsers hide crypto.subtle on HTTP pages. This shim provides the
 * SubtleCrypto methods that our dependency tree (ts-mls, @hpke, NDK)
 * actually calls, backed by @noble/hashes (pure JS, already bundled).
 *
 * Import this module as early as possible — before any library that
 * touches crypto.subtle.
 */

import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';

function getHashFn(name: string) {
  switch (name.replace('-', '').toUpperCase()) {
    case 'SHA256':
    case 'SHA-256':
      return sha256;
    case 'SHA384':
    case 'SHA-384':
      return sha384;
    case 'SHA512':
    case 'SHA-512':
      return sha512;
    default:
      throw new DOMException(`Unsupported hash: ${name}`, 'NotSupportedError');
  }
}

function toUint8(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

function algorithmName(alg: AlgorithmIdentifier | HmacImportParams): string {
  return typeof alg === 'string' ? alg : alg.name;
}

function hashName(alg: AlgorithmIdentifier | HmacImportParams): string {
  if (typeof alg === 'object' && 'hash' in alg) {
    const h = (alg as HmacImportParams).hash;
    return typeof h === 'string' ? h : h.name;
  }
  return algorithmName(alg);
}

// Tag for our shim CryptoKey objects
interface ShimKey {
  __shim: true;
  algorithm: string;
  raw: Uint8Array;
  hash: string;
  usages: string[];
}

function isShimKey(k: unknown): k is ShimKey {
  return typeof k === 'object' && k !== null && (k as ShimKey).__shim === true;
}

if (
  typeof globalThis !== 'undefined' &&
  typeof globalThis.crypto !== 'undefined' &&
  typeof globalThis.crypto.subtle === 'undefined'
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subtle: Record<string, (...args: any[]) => Promise<any>> = {
    async digest(
      algorithm: AlgorithmIdentifier,
      data: BufferSource,
    ): Promise<ArrayBuffer> {
      const fn = getHashFn(algorithmName(algorithm));
      return fn(toUint8(data)).buffer as ArrayBuffer;
    },

    async importKey(
      format: string,
      keyData: BufferSource | JsonWebKey,
      algorithm: AlgorithmIdentifier | HmacImportParams,
      _extractable: boolean,
      keyUsages: string[],
    ): Promise<CryptoKey> {
      if (format !== 'raw')
        throw new DOMException(`Unsupported format: ${format}`, 'NotSupportedError');
      const raw = toUint8(keyData as BufferSource);
      const name = algorithmName(algorithm);
      const hash = hashName(algorithm);
      const shim: ShimKey = { __shim: true, algorithm: name, raw, hash, usages: keyUsages };
      return shim as unknown as CryptoKey;
    },

    async sign(
      algorithm: AlgorithmIdentifier,
      key: CryptoKey,
      data: BufferSource,
    ): Promise<ArrayBuffer> {
      const k = key as unknown;
      if (!isShimKey(k))
        throw new DOMException('Unsupported key', 'InvalidAccessError');
      if (k.algorithm === 'HMAC') {
        const fn = getHashFn(k.hash);
        return hmac(fn, k.raw, toUint8(data)).buffer as ArrayBuffer;
      }
      throw new DOMException(`Unsupported sign algorithm: ${k.algorithm}`, 'NotSupportedError');
    },

    async verify(
      algorithm: AlgorithmIdentifier,
      key: CryptoKey,
      signature: BufferSource,
      data: BufferSource,
    ): Promise<boolean> {
      const expected = new Uint8Array(await subtle.sign!(algorithm, key, data));
      const actual = toUint8(signature);
      if (expected.length !== actual.length) return false;
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
      return diff === 0;
    },

    async generateKey(
      algorithm: AesKeyGenParams | HmacKeyGenParams | AlgorithmIdentifier,
      extractable: boolean,
      keyUsages: KeyUsage[],
    ): Promise<CryptoKey | CryptoKeyPair> {
      const name = algorithmName(algorithm as AlgorithmIdentifier);
      if (name === 'AES-GCM') {
        const len = (algorithm as AesKeyGenParams).length || 256;
        const raw = new Uint8Array(len / 8);
        globalThis.crypto.getRandomValues(raw);
        const shim: ShimKey = { __shim: true, algorithm: name, raw, hash: '', usages: keyUsages as string[] };
        return shim as unknown as CryptoKey;
      }
      throw new DOMException(`Unsupported generateKey: ${name}`, 'NotSupportedError');
    },

    async exportKey(format: string, key: CryptoKey): Promise<ArrayBuffer | JsonWebKey> {
      if (format !== 'raw')
        throw new DOMException(`Unsupported export format: ${format}`, 'NotSupportedError');
      const k = key as unknown;
      if (!isShimKey(k))
        throw new DOMException('Unsupported key', 'InvalidAccessError');
      return k.raw.buffer.slice(k.raw.byteOffset, k.raw.byteOffset + k.raw.byteLength) as ArrayBuffer;
    },
  };

  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: subtle,
    writable: true,
    configurable: true,
  });

  console.info('[crypto-polyfill] Installed crypto.subtle shim (non-secure context).');
}
