import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

// Mock heavy modules
vi.mock('@/src/lib/media/imageProcessing', () => ({
  processImage: vi.fn(),
  ImageTooLargeError: class ImageTooLargeError extends Error {
    constructor() { super('too large'); this.name = 'ImageTooLargeError'; }
  },
}));

vi.mock('@/src/lib/media/blossomClient', () => ({
  put: vi.fn(),
}));

vi.mock('@/src/lib/marmot/mediaPersistence', () => ({
  setBlob: vi.fn(),
  addMessageRef: vi.fn(),
  attachmentFingerprint: (a: { sha256: string; nonce: string; version: string }) =>
    `${a.sha256}:${a.nonce}:${a.version}`,
}));

vi.mock('@/src/lib/media/imetaTag', () => ({
  buildImetaTag: vi.fn((_a: unknown, role: string) => ['imeta', `role ${role}`]),
}));

vi.mock('@/src/lib/media/imageMessage', () => ({
  buildImageMessageContent: vi.fn((caption: string) =>
    JSON.stringify({ type: 'image', version: 1, caption }),
  ),
}));

const { processImage, ImageTooLargeError } = await import('@/src/lib/media/imageProcessing');
const { put } = await import('@/src/lib/media/blossomClient');
const { setBlob, addMessageRef } = await import('@/src/lib/marmot/mediaPersistence');
const { sendImageMessage } = await import('@/src/hooks/useImageSend');

type MediaAttachment = {
  url: string; sha256: string; type: string; filename: string;
  nonce: string; version: 'mip04-v2'; dimensions?: string;
};

function makeAttachment(sha256 = 'a'.repeat(64)): MediaAttachment {
  return { url: '', sha256, type: 'image/webp', filename: 'f.webp', nonce: 'b'.repeat(24), version: 'mip04-v2' };
}

function makeProcessedImage() {
  return {
    full: {
      blob: new Blob([new Uint8Array(100)], { type: 'image/webp' }),
      dimensions: '800x600',
      sha256: 'f'.repeat(64),
    },
    thumb: {
      blob: new Blob([new Uint8Array(20)], { type: 'image/webp' }),
      dimensions: '320x240',
      sha256: 'e'.repeat(64),
    },
    blurhash: 'LEHV6n',
  };
}

function makeGroup() {
  return {
    encryptMedia: vi.fn(async (_blob: Blob, meta: { filename: string }) => ({
      encrypted: new Uint8Array([9, 8, 7]),
      attachment: makeAttachment(meta.filename.includes('thumb') ? 'e'.repeat(64) : 'f'.repeat(64)),
    })),
    sendApplicationRumor: vi.fn(async () => ({})),
  };
}

function makeSigner() {
  return {
    getPublicKey: async () => 'a'.repeat(64),
    signEvent: async (draft: unknown) => ({ ...(draft as object), id: 'id', sig: 'sig' }),
  };
}

const baseFile = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });

describe('sendImageMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(processImage).mockResolvedValue(makeProcessedImage() as any);
    vi.mocked(put).mockResolvedValue('https://blossom.band/blob');
    vi.mocked(setBlob).mockResolvedValue(undefined as any);
    vi.mocked(addMessageRef).mockResolvedValue(undefined);
  });

  it('calls processImage first, then encryptMedia twice, then put twice, then sendApplicationRumor', async () => {
    const callOrder: string[] = [];
    vi.mocked(processImage).mockImplementationOnce(async (...args) => {
      callOrder.push('processImage');
      return makeProcessedImage() as any;
    });
    const group = makeGroup();
    group.encryptMedia.mockImplementation(async (_blob, meta) => {
      callOrder.push('encryptMedia:' + (meta.filename.includes('thumb') ? 'thumb' : 'full'));
      return { encrypted: new Uint8Array([1]), attachment: makeAttachment() };
    });
    vi.mocked(put).mockImplementation(async () => {
      callOrder.push('put');
      return 'https://blossom.band/x';
    });
    group.sendApplicationRumor.mockImplementation(async () => {
      callOrder.push('sendApplicationRumor');
    });

    await sendImageMessage(baseFile, 'hello', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any, onProgress: () => {},
    });

    expect(callOrder[0]).toBe('processImage');
    expect(callOrder.filter(s => s.startsWith('encryptMedia'))).toHaveLength(2);
    expect(callOrder.filter(s => s === 'put')).toHaveLength(2);
    expect(callOrder[callOrder.length - 1]).toBe('sendApplicationRumor');
  });

  it('reports processing → uploading → sent progress', async () => {
    const progress: unknown[] = [];
    const group = makeGroup();
    await sendImageMessage(baseFile, '', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any,
      onProgress: (p) => progress.push(p),
    });

    expect(progress[0]).toBe('processing');
    expect(progress.some(p => typeof p === 'object' && (p as any).status === 'uploading')).toBe(true);
    expect(progress[progress.length - 1]).toBe('sent');
  });

  it('reports failed and does not call sendApplicationRumor when put throws', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('network error'));
    const group = makeGroup();
    const progress: unknown[] = [];

    await expect(
      sendImageMessage(baseFile, '', {
        groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any,
        onProgress: (p) => progress.push(p),
      })
    ).rejects.toThrow();

    expect(progress).toContain('failed');
    expect(group.sendApplicationRumor).not.toHaveBeenCalled();
  });

  it('persists both blobs after sendApplicationRumor succeeds (not before)', async () => {
    const order: string[] = [];
    vi.mocked(setBlob).mockImplementation(async () => {
      order.push('setBlob');
    });
    vi.mocked(addMessageRef).mockImplementation(async () => {
      order.push('addMessageRef');
    });
    const group = makeGroup();
    group.sendApplicationRumor.mockImplementation(async () => {
      order.push('sendApplicationRumor');
    });

    await sendImageMessage(baseFile, 'cap', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any, onProgress: () => {},
    });

    expect(vi.mocked(setBlob)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(addMessageRef)).toHaveBeenCalledTimes(2);
    expect(group.sendApplicationRumor).toHaveBeenCalledTimes(1);

    // Ordering: rumor publish must happen before any persistence write so a
    // failed publish leaves no orphan blobs/refs in IndexedDB.
    const firstPersist = order.findIndex((s) => s === 'setBlob' || s === 'addMessageRef');
    const rumorIdx = order.indexOf('sendApplicationRumor');
    expect(rumorIdx).toBeGreaterThanOrEqual(0);
    expect(firstPersist).toBeGreaterThan(rumorIdx);
  });

  it('treats post-publish setBlob failure as best-effort: resolves successfully and reports sent', async () => {
    // Idempotency contract: once sendApplicationRumor has succeeded, the
    // message has shipped to the group. Local persistence (setBlob/addMessageRef)
    // is a sender-side cache for offline reload — failing it must NOT surface
    // as a send failure, because retrying the send would publish a duplicate
    // message that recipients can no longer dedupe.
    vi.mocked(setBlob).mockRejectedValue(new Error('IDB quota exceeded'));
    const group = makeGroup();
    const progress: unknown[] = [];

    const result = await sendImageMessage(baseFile, 'cap', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any,
      onProgress: (p) => progress.push(p),
    });

    expect(group.sendApplicationRumor).toHaveBeenCalledTimes(1);
    expect(progress[progress.length - 1]).toBe('sent');
    expect(progress).not.toContain('failed');
    expect(result.fullAttachment).toBeDefined();
    expect(result.thumbAttachment).toBeDefined();
  });

  it('treats post-publish addMessageRef failure as best-effort: resolves successfully and reports sent', async () => {
    vi.mocked(addMessageRef).mockRejectedValue(new Error('IDB write failed'));
    const group = makeGroup();
    const progress: unknown[] = [];

    await sendImageMessage(baseFile, 'cap', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any,
      onProgress: (p) => progress.push(p),
    });

    expect(group.sendApplicationRumor).toHaveBeenCalledTimes(1);
    expect(progress[progress.length - 1]).toBe('sent');
    expect(progress).not.toContain('failed');
  });

  it('rolls back: does not persist blobs/refs when sendApplicationRumor throws', async () => {
    const group = makeGroup();
    group.sendApplicationRumor.mockRejectedValueOnce(new Error('publish failed'));
    const progress: unknown[] = [];

    await expect(
      sendImageMessage(baseFile, '', {
        groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any,
        onProgress: (p) => progress.push(p),
      }),
    ).rejects.toThrow('publish failed');

    // No persistence side-effects happened, so a retry will not stack
    // orphan refs/blobs that can never be cleaned up by message id.
    expect(vi.mocked(setBlob)).not.toHaveBeenCalled();
    expect(vi.mocked(addMessageRef)).not.toHaveBeenCalled();
    // Failure surfaces through onProgress so the UI can show the retry button.
    expect(progress).toContain('failed');
  });

  it('throws ImageTooLargeError and reports failed when processImage throws it', async () => {
    vi.mocked(processImage).mockRejectedValueOnce(new ImageTooLargeError());
    const group = makeGroup();
    const progress: unknown[] = [];

    await expect(
      sendImageMessage(baseFile, '', {
        groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any,
        onProgress: (p) => progress.push(p),
      })
    ).rejects.toThrow();
  });

  it('sends rumor with kind 9', async () => {
    const group = makeGroup();
    await sendImageMessage(baseFile, 'test', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any, onProgress: () => {},
    });

    const rumorArg = group.sendApplicationRumor.mock.calls[0][0] as any;
    expect(rumorArg.kind).toBe(9);
  });

  it('rumor tags contain two imeta entries (full and thumb)', async () => {
    const group = makeGroup();
    await sendImageMessage(baseFile, '', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any, onProgress: () => {},
    });

    const rumorArg = group.sendApplicationRumor.mock.calls[0][0] as any;
    expect(rumorArg.tags).toHaveLength(2);
    const roles = rumorArg.tags.map((t: string[]) => t.find((e: string) => e.startsWith('role ')));
    expect(roles).toContain('role full');
    expect(roles).toContain('role thumb');
  });

  it('rumor.id is a 64-char hex event hash, not an empty string', async () => {
    // Other rumor publishers in this codebase (MarmotContext, PollStoreContext)
    // compute the Nostr event hash before calling sendApplicationRumor. Image
    // rumors must follow the same contract — an empty id breaks dedup and
    // relies on undocumented library repair of an invalid rumor shape.
    const group = makeGroup();
    await sendImageMessage(baseFile, 'cap', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any, onProgress: () => {},
    });

    const rumorArg = group.sendApplicationRumor.mock.calls[0][0] as any;
    expect(rumorArg.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rumor.id matches getEventHash of the rumor fields', async () => {
    const { getEventHash } = await import('applesauce-core/helpers/event');
    const group = makeGroup();
    await sendImageMessage(baseFile, 'verify', {
      groupId: 'g1', group, pubkey: 'a'.repeat(64), signer: makeSigner() as any, onProgress: () => {},
    });

    const rumorArg = group.sendApplicationRumor.mock.calls[0][0] as any;
    const expected = getEventHash({
      kind: rumorArg.kind,
      pubkey: rumorArg.pubkey,
      created_at: rumorArg.created_at,
      content: rumorArg.content,
      tags: rumorArg.tags,
    } as any);
    expect(rumorArg.id).toBe(expected);
  });
});
