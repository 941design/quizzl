import { afterEach, describe, expect, it } from 'vitest';

const ORIGINAL_ENV = {
  NEXT_PUBLIC_BLOSSOM_BASE_URL: process.env.NEXT_PUBLIC_BLOSSOM_BASE_URL,
  NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS: process.env.NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS,
  NEXT_PUBLIC_LOG_LEVEL: process.env.NEXT_PUBLIC_LOG_LEVEL,
};

describe('publicEnv', () => {
  afterEach(() => {
    if (ORIGINAL_ENV.NEXT_PUBLIC_BLOSSOM_BASE_URL === undefined) {
      delete process.env.NEXT_PUBLIC_BLOSSOM_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_BLOSSOM_BASE_URL = ORIGINAL_ENV.NEXT_PUBLIC_BLOSSOM_BASE_URL;
    }

    if (ORIGINAL_ENV.NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS === undefined) {
      delete process.env.NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS;
    } else {
      process.env.NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS = ORIGINAL_ENV.NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS;
    }

    if (ORIGINAL_ENV.NEXT_PUBLIC_LOG_LEVEL === undefined) {
      delete process.env.NEXT_PUBLIC_LOG_LEVEL;
    } else {
      process.env.NEXT_PUBLIC_LOG_LEVEL = ORIGINAL_ENV.NEXT_PUBLIC_LOG_LEVEL;
    }
  });

  it('reads the public blossom base url directly from process.env', async () => {
    process.env.NEXT_PUBLIC_BLOSSOM_BASE_URL = 'https://upload.example.test';
    const { getNextPublicBlossomBaseUrl } = await import('@/src/lib/publicEnv');

    expect(getNextPublicBlossomBaseUrl()).toBe('https://upload.example.test');
  });

  it('reads the public blossom trusted hosts directly from process.env', async () => {
    process.env.NEXT_PUBLIC_BLOSSOM_TRUSTED_HOSTS = 'https://a.example.test,https://b.example.test';
    const { getNextPublicBlossomTrustedHosts } = await import('@/src/lib/publicEnv');

    expect(getNextPublicBlossomTrustedHosts()).toBe('https://a.example.test,https://b.example.test');
  });

  it('reads the public log level directly from process.env', async () => {
    process.env.NEXT_PUBLIC_LOG_LEVEL = 'debug';
    const { getNextPublicLogLevel } = await import('@/src/lib/publicEnv');

    expect(getNextPublicLogLevel()).toBe('debug');
  });
});
