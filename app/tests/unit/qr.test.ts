import { describe, expect, it, vi, beforeEach } from 'vitest';
import { normaliseNpubPayload, generateQrDataUrl } from '@/src/lib/qr';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';

const toDataURL = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ default: { toDataURL } }));

const samplePubkey = 'f'.repeat(64);
const sampleNpub = pubkeyToNpub(samplePubkey);

describe('normaliseNpubPayload', () => {
  it('accepts a plain npub', () => {
    expect(normaliseNpubPayload(sampleNpub)).toBe(sampleNpub);
  });

  it('accepts a nostr: npub payload', () => {
    expect(normaliseNpubPayload(`nostr:${sampleNpub}`)).toBe(sampleNpub);
  });

  it('trims whitespace', () => {
    expect(normaliseNpubPayload(`  ${sampleNpub}  `)).toBe(sampleNpub);
  });

  it('rejects non-npub payloads', () => {
    expect(normaliseNpubPayload('hello world')).toBeNull();
    expect(normaliseNpubPayload('nsec1foo')).toBeNull();
    expect(normaliseNpubPayload('')).toBeNull();
  });
});

/**
 * The shared generation seam behind both QR surfaces: NpubQrModal (npub /
 * contact card) and GenerateInviteLinkModal (group invite link). The DOM
 * output of either is not asserted here — this repo's vitest environment has
 * no renderer — but the encoding contract both depend on is.
 */
describe('generateQrDataUrl', () => {
  const inviteUrl = 'https://few.chat/groups/?join=abc&admin=npub1foo&name=Team';

  beforeEach(() => {
    toDataURL.mockReset();
    toDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  it('returns the encoder\'s data URL for the given value', async () => {
    await expect(generateQrDataUrl(inviteUrl)).resolves.toBe('data:image/png;base64,QR');
    expect(toDataURL).toHaveBeenCalledWith(inviteUrl, expect.anything());
  });

  it('defaults to ECC-M — the level short payloads (invite link, bare npub) encode at', async () => {
    await generateQrDataUrl(inviteUrl);
    expect(toDataURL).toHaveBeenCalledWith(inviteUrl, expect.objectContaining({ errorCorrectionLevel: 'M' }));
  });

  it('honours an explicit ECC-L for long payloads (contact card share URLs)', async () => {
    await generateQrDataUrl('https://few.chat/add#c=longpayload', 'L');
    expect(toDataURL).toHaveBeenCalledWith(
      'https://few.chat/add#c=longpayload',
      expect.objectContaining({ errorCorrectionLevel: 'L' }),
    );
  });

  it('encodes both surfaces at the same raster options', async () => {
    await generateQrDataUrl(inviteUrl);
    expect(toDataURL).toHaveBeenCalledWith(inviteUrl, expect.objectContaining({ margin: 2, width: 320 }));
  });

  it('propagates encoder failures so callers can surface qrGenerationError', async () => {
    toDataURL.mockRejectedValue(new Error('boom'));
    await expect(generateQrDataUrl(inviteUrl)).rejects.toThrow('boom');
  });
});
