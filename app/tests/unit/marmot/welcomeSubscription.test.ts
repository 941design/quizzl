import { describe, it, expect, vi } from 'vitest';
import { unwrapGiftWrap } from '@/src/lib/marmot/welcomeSubscription';

// ---------------------------------------------------------------------------
// unwrapGiftWrap tests
// ---------------------------------------------------------------------------

describe('unwrapGiftWrap', () => {
  it('decrypts two-layer NIP-59 envelope to inner rumor', async () => {
    const innerRumor = {
      id: 'rumor-id',
      pubkey: 'sender-pubkey',
      created_at: 1700000000,
      kind: 444,
      tags: [['e', 'group-id']],
      content: 'welcome-payload',
      sig: '',
    };

    const seal = {
      pubkey: 'sender-pubkey',
      content: 'encrypted-rumor',
    };

    const mockDecrypt = vi.fn()
      // Layer 1: decrypt gift wrap content with ephemeral pubkey → seal
      .mockResolvedValueOnce(JSON.stringify(seal))
      // Layer 2: decrypt seal content with sender pubkey → rumor
      .mockResolvedValueOnce(JSON.stringify(innerRumor));

    const signer = {
      nip44: { decrypt: mockDecrypt },
    };

    const giftWrapEvent = {
      pubkey: 'ephemeral-pubkey',
      content: 'encrypted-seal',
    };

    const result = await unwrapGiftWrap(giftWrapEvent, signer as never);

    expect(result).toEqual(innerRumor);
    // Layer 1: decrypts against gift wrap's ephemeral pubkey
    expect(mockDecrypt).toHaveBeenNthCalledWith(1, 'ephemeral-pubkey', 'encrypted-seal');
    // Layer 2: decrypts against seal's sender pubkey
    expect(mockDecrypt).toHaveBeenNthCalledWith(2, 'sender-pubkey', 'encrypted-rumor');
  });

  it('throws when signer lacks nip44.decrypt', async () => {
    const signer = { nip44: undefined };

    await expect(
      unwrapGiftWrap({ pubkey: 'pk', content: 'ct' }, signer as never),
    ).rejects.toThrow('Signer does not support NIP-44 decryption');
  });

  it('throws when signer.nip44 exists but decrypt is undefined', async () => {
    const signer = { nip44: { decrypt: undefined } };

    await expect(
      unwrapGiftWrap({ pubkey: 'pk', content: 'ct' }, signer as never),
    ).rejects.toThrow('Signer does not support NIP-44 decryption');
  });

  it('defaults missing rumor fields', async () => {
    // Rumor with missing optional fields
    const partialRumor = { kind: 444, content: 'hello' };
    const seal = { pubkey: 'spk', content: 'enc' };

    const mockDecrypt = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(seal))
      .mockResolvedValueOnce(JSON.stringify(partialRumor));

    const signer = { nip44: { decrypt: mockDecrypt } };

    const result = await unwrapGiftWrap({ pubkey: 'epk', content: 'c' }, signer as never);

    expect(result.id).toBe('');
    expect(result.pubkey).toBe('');
    expect(result.created_at).toBe(0);
    expect(result.kind).toBe(444);
    expect(result.tags).toEqual([]);
    expect(result.content).toBe('hello');
    expect(result.sig).toBe('');
  });
});
