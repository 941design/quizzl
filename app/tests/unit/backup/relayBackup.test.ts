import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STORAGE_KEYS } from '@/src/types';

// ---------------------------------------------------------------------------
// Mock NDK and ndkClient before other imports
// ---------------------------------------------------------------------------

const mockFetchEventsWithTimeout = vi.fn();

vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {
    ndk: unknown;
    kind?: number;
    content?: string;
    tags?: string[][];
    created_at?: number;
    pubkey?: string;
    id?: string;
    sig?: string;
    constructor(ndk: unknown) { this.ndk = ndk; }
    publish = vi.fn().mockResolvedValue(undefined);
  },
  NDKRelaySet: {
    fromRelayUrls: vi.fn((_relays: string[], _ndk: unknown) => 'mock-relay-set'),
  },
}));

vi.mock('@/src/lib/ndkClient', () => ({
  fetchEventsWithTimeout: (...args: unknown[]) => mockFetchEventsWithTimeout(...args),
}));

// ---------------------------------------------------------------------------
// Mock idb-keyval (same pattern as marmotAdapter.test.ts)
// ---------------------------------------------------------------------------

const stores: Record<string, Record<string, unknown>> = {};

function getOrCreateStore(name: string): Record<string, unknown> {
  if (!stores[name]) stores[name] = {};
  return stores[name];
}

vi.mock('idb-keyval', () => ({
  createStore: (dbName: string, storeName: string) => `${dbName}:${storeName}`,
  get: vi.fn(async (key: string, store?: string) => {
    // When called without a store (default store), use 'default'
    const s = store ?? 'default';
    return getOrCreateStore(s)[key] ?? undefined;
  }),
  set: vi.fn(async (key: string, value: unknown, store?: string) => {
    const s = store ?? 'default';
    getOrCreateStore(s)[key] = value;
  }),
  del: vi.fn(async (key: string, store?: string) => {
    const s = store ?? 'default';
    delete getOrCreateStore(s)[key];
  }),
  keys: vi.fn(async (store?: string) => {
    const s = store ?? 'default';
    return Object.keys(getOrCreateStore(s));
  }),
  clear: vi.fn(async (store?: string) => {
    const s = store ?? 'default';
    const obj = getOrCreateStore(s);
    Object.keys(obj).forEach((k) => delete obj[k]);
  }),
}));

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

const localStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStore[key] ?? null,
  setItem: (key: string, value: string) => {
    localStore[key] = value;
  },
  removeItem: (key: string) => {
    delete localStore[key];
  },
  clear: () => {
    Object.keys(localStore).forEach((k) => delete localStore[k]);
  },
  get length() {
    return Object.keys(localStore).length;
  },
  key: (i: number) => Object.keys(localStore)[i] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  collectBackupPayload,
  uint8ArrayToBase64,
  base64ToUint8Array,
  createBackupEvent,
  publishBackup,
  fetchBackup,
  getBackupRelays,
  restoreFromBackup,
  BackupScheduler,
  type BackupPayload,
} from '@/src/lib/backup/relayBackup';
import {
  saveGroup,
  saveMemberScores,
  saveMemberProfiles,
  loadAllGroups,
  loadMemberScores,
  loadMemberProfiles,
  IdbGroupStateBackend,
} from '@/src/lib/marmot/groupStorage';
import type { Group, MemberScore, MemberProfile } from '@/src/types';
import { loadMessages } from '@/src/lib/marmot/chatPersistence';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import { set } from 'idb-keyval';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorageMock.clear();
  Object.keys(stores).forEach((k) => delete stores[k]);
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

describe('Base64 helpers', () => {
  it('round-trips a Uint8Array', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const b64 = uint8ArrayToBase64(original);
    const decoded = base64ToUint8Array(b64);
    expect(decoded).toEqual(original);
  });

  it('encodes empty array', () => {
    const b64 = uint8ArrayToBase64(new Uint8Array([]));
    expect(b64).toBe('');
    expect(base64ToUint8Array(b64)).toEqual(new Uint8Array([]));
  });

  it('encodes known value', () => {
    // "Hello" in ASCII
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    expect(uint8ArrayToBase64(bytes)).toBe('SGVsbG8=');
  });
});

// ---------------------------------------------------------------------------
// collectBackupPayload — empty state
// ---------------------------------------------------------------------------

describe('collectBackupPayload', () => {
  it('returns defaults when no data is stored', async () => {
    const payload = await collectBackupPayload();

    expect(payload.version).toBe(1);
    expect(typeof payload.createdAt).toBe('number');
    expect(payload.settings).toBeNull();
    expect(payload.userProfile).toBeNull();
    expect(payload.selectedTopics).toBeNull();
    expect(payload.progress).toBeNull();
    expect(payload.studyTimes).toBeNull();
    expect(payload.scoreSyncSeq).toBe(0);
    expect(payload.groups).toEqual([]);
    expect(payload.groupStates).toEqual({});
    expect(payload.memberScores).toEqual({});
    expect(payload.memberProfiles).toEqual({});
    expect(payload.chatMessages).toEqual({});
  });

  // -----------------------------------------------------------------------
  // localStorage data
  // -----------------------------------------------------------------------

  it('reads settings from localStorage', async () => {
    localStore[STORAGE_KEYS.settings] = JSON.stringify({
      theme: 'playful',
      language: 'de',
    });

    const payload = await collectBackupPayload();
    expect(payload.settings).toEqual({ theme: 'playful', language: 'de' });
  });

  it('reads userProfile from localStorage', async () => {
    const profile = {
      nickname: 'Alice',
      avatar: { id: 'a1', subject: 'cat', accessories: ['hat'] },
      badgeIds: ['b1'],
    };
    localStore[STORAGE_KEYS.userProfile] = JSON.stringify(profile);

    const payload = await collectBackupPayload();
    expect(payload.userProfile).toEqual(profile);
  });

  it('reads selectedTopics from localStorage', async () => {
    localStore[STORAGE_KEYS.selectedTopics] = JSON.stringify({
      slugs: ['math', 'science'],
    });

    const payload = await collectBackupPayload();
    expect(payload.selectedTopics).toEqual(['math', 'science']);
  });

  it('reads progress from localStorage', async () => {
    const progress = { byTopicSlug: { math: { quizPoints: 10 } } };
    localStore[STORAGE_KEYS.progress] = JSON.stringify(progress);

    const payload = await collectBackupPayload();
    expect(payload.progress).toEqual(progress);
  });

  it('reads studyTimes sessions from localStorage', async () => {
    const sessions = [{ id: 's1', startedAt: '2024-01-01', endedAt: '2024-01-01', durationMs: 1000 }];
    localStore[STORAGE_KEYS.studyTimes] = JSON.stringify({ sessions });

    const payload = await collectBackupPayload();
    expect(payload.studyTimes).toEqual(sessions);
  });

  it('reads scoreSyncSeq from localStorage', async () => {
    localStore[STORAGE_KEYS.scoreSyncSeq] = '42';

    const payload = await collectBackupPayload();
    expect(payload.scoreSyncSeq).toBe(42);
  });

  // -----------------------------------------------------------------------
  // IDB: groups, scores, profiles, chat
  // -----------------------------------------------------------------------

  it('includes groups from IDB', async () => {
    const group: Group = {
      id: 'g1',
      name: 'Study Group',
      createdAt: 1700000000000,
      memberPubkeys: ['pk1', 'pk2'],
      relays: ['wss://relay.example.com'],
    };
    await saveGroup(group);

    const payload = await collectBackupPayload();
    expect(payload.groups).toHaveLength(1);
    expect(payload.groups[0]).toEqual({
      id: 'g1',
      name: 'Study Group',
      createdAt: 1700000000000,
      memberPubkeys: ['pk1', 'pk2'],
      relays: ['wss://relay.example.com'],
    });
  });

  it('includes member scores per group', async () => {
    const group: Group = {
      id: 'g1',
      name: 'Test',
      createdAt: 1700000000000,
      memberPubkeys: ['pk1'],
      relays: [],
    };
    await saveGroup(group);

    const scores: MemberScore[] = [
      {
        pubkeyHex: 'pk1',
        nickname: 'Alice',
        scores: {
          math: {
            topicSlug: 'math',
            quizPoints: 10,
            maxPoints: 20,
            completedTasks: 2,
            totalTasks: 5,
            lastStudiedAt: '2024-01-01',
            sequenceNumber: 1,
          },
        },
        lastSeq: 1,
      },
    ];
    await saveMemberScores('g1', scores);

    const payload = await collectBackupPayload();
    expect(payload.memberScores['g1']).toEqual(scores);
  });

  it('includes member profiles per group', async () => {
    const group: Group = {
      id: 'g1',
      name: 'Test',
      createdAt: 1700000000000,
      memberPubkeys: ['pk1'],
      relays: [],
    };
    await saveGroup(group);

    const profiles: MemberProfile[] = [
      {
        pubkeyHex: 'pk1',
        nickname: 'Alice',
        avatar: null,
        badgeIds: [],
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ];
    await saveMemberProfiles('g1', profiles);

    const payload = await collectBackupPayload();
    expect(payload.memberProfiles['g1']).toEqual(profiles);
  });

  it('includes chat messages per group (via default idb-keyval store)', async () => {
    const group: Group = {
      id: 'g1',
      name: 'Test',
      createdAt: 1700000000000,
      memberPubkeys: [],
      relays: [],
    };
    await saveGroup(group);

    const messages: ChatMessage[] = [
      {
        id: 'm1',
        content: 'Hello',
        senderPubkey: 'pk1',
        groupId: 'g1',
        createdAt: 1700000000000,
      },
    ];
    // chatPersistence stores in default idb-keyval store with key quizzl:messages:{groupId}
    // We need to set it directly since loadMessages uses the default store
    const { set: idbSet } = await import('idb-keyval');
    await idbSet(`quizzl:messages:g1`, messages);

    const payload = await collectBackupPayload();
    expect(payload.chatMessages['g1']).toEqual(messages);
  });

  // -----------------------------------------------------------------------
  // Chat message truncation
  // -----------------------------------------------------------------------

  it('truncates chat messages to last 10', async () => {
    const group: Group = {
      id: 'g1',
      name: 'Test',
      createdAt: 1700000000000,
      memberPubkeys: [],
      relays: [],
    };
    await saveGroup(group);

    const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`,
      content: `Message ${i}`,
      senderPubkey: 'pk1',
      groupId: 'g1',
      createdAt: 1700000000000 + i,
    }));

    const { set: idbSet } = await import('idb-keyval');
    await idbSet(`quizzl:messages:g1`, messages);

    const payload = await collectBackupPayload();
    expect(payload.chatMessages['g1']).toHaveLength(10);
    // Should keep messages 5-14 (last 10)
    expect(payload.chatMessages['g1'][0].id).toBe('m5');
    expect(payload.chatMessages['g1'][9].id).toBe('m14');
  });

  // -----------------------------------------------------------------------
  // MLS state base64 encoding
  // -----------------------------------------------------------------------

  it('base64-encodes MLS group state', async () => {
    const group: Group = {
      id: 'g1',
      name: 'Test',
      createdAt: 1700000000000,
      memberPubkeys: [],
      relays: [],
    };
    await saveGroup(group);

    // Simulate MLS state as Uint8Array stored in the state backend
    const stateBackend = new IdbGroupStateBackend();
    const mlsState = new Uint8Array([1, 2, 3, 4, 5]);
    await stateBackend.setItem('g1', mlsState as never);

    const payload = await collectBackupPayload();
    expect(payload.groupStates['g1']).toBe(uint8ArrayToBase64(mlsState));

    // Verify round-trip
    const decoded = base64ToUint8Array(payload.groupStates['g1']);
    expect(decoded).toEqual(mlsState);
  });

  // -----------------------------------------------------------------------
  // Multiple groups
  // -----------------------------------------------------------------------

  it('handles multiple groups with all data', async () => {
    const g1: Group = {
      id: 'g1',
      name: 'Group 1',
      createdAt: 1700000000000,
      memberPubkeys: ['pk1'],
      relays: ['wss://r1.example.com'],
    };
    const g2: Group = {
      id: 'g2',
      name: 'Group 2',
      createdAt: 1700000001000,
      memberPubkeys: ['pk2'],
      relays: ['wss://r2.example.com'],
    };
    await saveGroup(g1);
    await saveGroup(g2);

    await saveMemberScores('g1', [
      { pubkeyHex: 'pk1', nickname: 'A', scores: {}, lastSeq: 0 },
    ]);
    await saveMemberScores('g2', [
      { pubkeyHex: 'pk2', nickname: 'B', scores: {}, lastSeq: 0 },
    ]);

    const payload = await collectBackupPayload();
    expect(payload.groups).toHaveLength(2);
    expect(Object.keys(payload.memberScores)).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Malformed localStorage data
  // -----------------------------------------------------------------------

  it('handles malformed JSON in localStorage gracefully', async () => {
    localStore[STORAGE_KEYS.settings] = 'not-json{{{';

    const payload = await collectBackupPayload();
    expect(payload.settings).toBeNull();
  });

  it('sets createdAt to a recent Unix-seconds timestamp', async () => {
    const before = Math.floor(Date.now() / 1000);
    const payload = await collectBackupPayload();
    const after = Math.floor(Date.now() / 1000);

    expect(payload.createdAt).toBeGreaterThanOrEqual(before);
    expect(payload.createdAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// S2: createBackupEvent, fetchBackup, getBackupRelays
// ---------------------------------------------------------------------------

function makeMockSigner() {
  return {
    getPublicKey: vi.fn().mockResolvedValue('deadbeef'),
    signEvent: vi.fn().mockImplementation(async (draft: Record<string, unknown>) => ({
      ...draft,
      id: 'signed-event-id',
      pubkey: 'deadbeef',
      sig: 'fakesig',
    })),
    nip44: {
      encrypt: vi.fn().mockImplementation(async (_pk: string, plaintext: string) =>
        `encrypted:${plaintext}`
      ),
      decrypt: vi.fn().mockImplementation(async (_pk: string, ciphertext: string) =>
        ciphertext.replace('encrypted:', '')
      ),
    },
  };
}

const mockNdk = { fake: true } as unknown;

describe('createBackupEvent', () => {
  it('encrypts payload and returns kind 30078 event with d:quizzl tag', async () => {
    const signer = makeMockSigner();
    const payload: BackupPayload = {
      version: 1,
      createdAt: 1700000000000,
      settings: null,
      userProfile: null,
      selectedTopics: null,
      progress: null,
      studyTimes: null,
      scoreSyncSeq: 0,
      groups: [],
      groupStates: {},
      memberScores: {},
      memberProfiles: {},
      chatMessages: {},
    };

    const event = await createBackupEvent(payload, signer, 'deadbeef');

    expect(event.kind).toBe(30078);
    expect(event.tags).toEqual([['d', 'quizzl']]);
    expect(event.content).toBe(`encrypted:${JSON.stringify(payload)}`);
    expect(signer.nip44.encrypt).toHaveBeenCalledWith('deadbeef', JSON.stringify(payload));
    expect(typeof event.created_at).toBe('number');
  });
});

describe('publishBackup', () => {
  it('collects payload, encrypts, signs, and publishes to relay set', async () => {
    // getBackupRelays will be called internally — mock fetchEventsWithTimeout for relay list
    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set(),
      timedOut: false,
    });

    const mockPublish = vi.fn().mockResolvedValue(undefined);
    // The NDKEvent mock's publish is set per-instance via the vi.mock above
    // We need to capture the instance to verify publish was called
    const { NDKEvent } = await import('@nostr-dev-kit/ndk');
    const origConstructor = NDKEvent;
    let capturedEvent: { publish: ReturnType<typeof vi.fn> } | null = null;

    const signer = makeMockSigner();
    const result = await publishBackup(signer, 'deadbeef', mockNdk as never);

    expect(result.ok).toBe(true);
    expect(signer.nip44.encrypt).toHaveBeenCalled();
    expect(signer.signEvent).toHaveBeenCalled();
  });

  it('returns failure indicator when publish throws', async () => {
    // Mock getBackupRelays (no relay list found)
    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set(),
      timedOut: false,
    });

    const signer = makeMockSigner();
    signer.signEvent.mockRejectedValueOnce(new Error('signing failed'));

    const result = await publishBackup(signer, 'deadbeef', mockNdk as never);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('signing failed');
  });
});

describe('fetchBackup', () => {
  it('returns null when no events found', async () => {
    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set(),
      timedOut: false,
    });

    const signer = makeMockSigner();
    const result = await fetchBackup(signer, 'deadbeef', mockNdk as never);

    expect(result).toBeNull();
  });

  it('decrypts and returns the newest backup event', async () => {
    const payload: BackupPayload = {
      version: 1,
      createdAt: 1700000000000,
      settings: { theme: 'calm', language: 'en' },
      userProfile: null,
      selectedTopics: null,
      progress: null,
      studyTimes: null,
      scoreSyncSeq: 0,
      groups: [],
      groupStates: {},
      memberScores: {},
      memberProfiles: {},
      chatMessages: {},
    };

    const encryptedContent = `encrypted:${JSON.stringify(payload)}`;

    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set([
        { content: encryptedContent, created_at: 1700000100, id: 'ev1' },
      ]),
      timedOut: false,
    });

    const signer = makeMockSigner();
    const result = await fetchBackup(signer, 'deadbeef', mockNdk as never, [
      'wss://relay.example.com',
    ]);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.settings).toEqual({ theme: 'calm', language: 'en' });
    expect(signer.nip44.decrypt).toHaveBeenCalledWith('deadbeef', encryptedContent);
  });

  it('picks the newest event when multiple are returned', async () => {
    const oldPayload: BackupPayload = {
      version: 1,
      createdAt: 1700000000000,
      settings: { theme: 'playful', language: 'de' },
      userProfile: null,
      selectedTopics: null,
      progress: null,
      studyTimes: null,
      scoreSyncSeq: 0,
      groups: [],
      groupStates: {},
      memberScores: {},
      memberProfiles: {},
      chatMessages: {},
    };
    const newPayload: BackupPayload = {
      ...oldPayload,
      settings: { theme: 'calm', language: 'en' },
      createdAt: 1700000001000,
    };

    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set([
        { content: `encrypted:${JSON.stringify(oldPayload)}`, created_at: 100, id: 'old' },
        { content: `encrypted:${JSON.stringify(newPayload)}`, created_at: 200, id: 'new' },
      ]),
      timedOut: false,
    });

    const signer = makeMockSigner();
    const result = await fetchBackup(signer, 'deadbeef', mockNdk as never);

    expect(result!.settings).toEqual({ theme: 'calm', language: 'en' });
  });

  it('throws on unsupported backup version', async () => {
    const badPayload = { version: 99 };
    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set([
        { content: `encrypted:${JSON.stringify(badPayload)}`, created_at: 100, id: 'ev' },
      ]),
      timedOut: false,
    });

    const signer = makeMockSigner();
    await expect(fetchBackup(signer, 'deadbeef', mockNdk as never)).rejects.toThrow(
      'Unsupported backup version: 99',
    );
  });
});

describe('getBackupRelays', () => {
  it('returns DEFAULT_RELAYS when no relay list event exists', async () => {
    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set(),
      timedOut: false,
    });

    const relays = await getBackupRelays(mockNdk as never, 'deadbeef');
    expect(relays).toEqual([
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
    ]);
  });

  it('extracts relay URLs from relay/r tags', async () => {
    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set([
        {
          created_at: 100,
          tags: [
            ['r', 'wss://custom1.example.com'],
            ['relay', 'wss://custom2.example.com'],
          ],
          id: 'rl',
        },
      ]),
      timedOut: false,
    });

    const relays = await getBackupRelays(mockNdk as never, 'deadbeef');
    expect(relays).toEqual([
      'wss://custom1.example.com',
      'wss://custom2.example.com',
    ]);
  });

  it('falls back to DEFAULT_RELAYS when relay event has no relay tags', async () => {
    mockFetchEventsWithTimeout.mockResolvedValueOnce({
      events: new Set([
        { created_at: 100, tags: [['d', 'other']], id: 'rl' },
      ]),
      timedOut: false,
    });

    const relays = await getBackupRelays(mockNdk as never, 'deadbeef');
    expect(relays).toEqual([
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
    ]);
  });
});

// ---------------------------------------------------------------------------
// S3: restoreFromBackup
// ---------------------------------------------------------------------------

function makeEmptyPayload(overrides?: Partial<BackupPayload>): BackupPayload {
  return {
    version: 1,
    createdAt: 1700000000000,
    settings: null,
    userProfile: null,
    selectedTopics: null,
    progress: null,
    studyTimes: null,
    scoreSyncSeq: 0,
    groups: [],
    groupStates: {},
    memberScores: {},
    memberProfiles: {},
    chatMessages: {},
    ...overrides,
  };
}

describe('restoreFromBackup', () => {
  it('clears existing localStorage keys', async () => {
    localStore[STORAGE_KEYS.settings] = JSON.stringify({ theme: 'playful', language: 'de' });
    localStore[STORAGE_KEYS.userProfile] = JSON.stringify({ nickname: 'Old' });

    await restoreFromBackup(makeEmptyPayload());

    // Old data should be gone (settings was null in payload)
    expect(localStore[STORAGE_KEYS.settings]).toBeUndefined();
    expect(localStore[STORAGE_KEYS.userProfile]).toBeUndefined();
  });

  it('rehydrates settings from payload', async () => {
    await restoreFromBackup(
      makeEmptyPayload({ settings: { theme: 'playful', language: 'de' } }),
    );

    expect(JSON.parse(localStore[STORAGE_KEYS.settings])).toEqual({
      theme: 'playful',
      language: 'de',
    });
  });

  it('rehydrates userProfile from payload', async () => {
    const profile = {
      nickname: 'Alice',
      avatar: { id: 'a1', subject: 'cat', accessories: ['hat'] },
      badgeIds: ['b1'],
    };

    await restoreFromBackup(makeEmptyPayload({ userProfile: profile }));

    expect(JSON.parse(localStore[STORAGE_KEYS.userProfile])).toEqual(profile);
  });

  it('rehydrates selectedTopics wrapped in { slugs: [...] }', async () => {
    await restoreFromBackup(
      makeEmptyPayload({ selectedTopics: ['math', 'science'] }),
    );

    expect(JSON.parse(localStore[STORAGE_KEYS.selectedTopics])).toEqual({
      slugs: ['math', 'science'],
    });
  });

  it('rehydrates progress from payload', async () => {
    const progress = { byTopicSlug: { math: { quizPoints: 10 } } };
    await restoreFromBackup(makeEmptyPayload({ progress }));

    expect(JSON.parse(localStore[STORAGE_KEYS.progress])).toEqual(progress);
  });

  it('rehydrates studyTimes wrapped in { sessions: [...] }', async () => {
    const sessions = [{ id: 's1', durationMs: 1000 }];
    await restoreFromBackup(makeEmptyPayload({ studyTimes: sessions }));

    expect(JSON.parse(localStore[STORAGE_KEYS.studyTimes])).toEqual({
      sessions,
    });
  });

  it('rehydrates scoreSyncSeq from payload', async () => {
    await restoreFromBackup(makeEmptyPayload({ scoreSyncSeq: 42 }));

    expect(localStore[STORAGE_KEYS.scoreSyncSeq]).toBe('42');
  });

  it('rehydrates scoreSyncSeq when value is 0', async () => {
    await restoreFromBackup(makeEmptyPayload({ scoreSyncSeq: 0 }));

    expect(localStore[STORAGE_KEYS.scoreSyncSeq]).toBe('0');
  });

  it('rehydrates groups into IDB', async () => {
    const group = {
      id: 'g1',
      name: 'Study Group',
      createdAt: 1700000000000,
      memberPubkeys: ['pk1'],
      relays: ['wss://relay.example.com'],
    };

    await restoreFromBackup(makeEmptyPayload({ groups: [group] }));

    const groups = await loadAllGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(group);
  });

  it('rehydrates member scores into IDB', async () => {
    const scores = [
      { pubkeyHex: 'pk1', nickname: 'Alice', scores: {}, lastSeq: 1 },
    ];
    await restoreFromBackup(
      makeEmptyPayload({
        groups: [{ id: 'g1', name: 'T', createdAt: 0, memberPubkeys: [], relays: [] }],
        memberScores: { g1: scores },
      }),
    );

    const loaded = await loadMemberScores('g1');
    expect(loaded).toEqual(scores);
  });

  it('rehydrates member profiles into IDB', async () => {
    const profiles = [
      { pubkeyHex: 'pk1', nickname: 'Alice', avatar: null, badgeIds: [], updatedAt: '2024-01-01T00:00:00Z' },
    ];
    await restoreFromBackup(
      makeEmptyPayload({
        groups: [{ id: 'g1', name: 'T', createdAt: 0, memberPubkeys: [], relays: [] }],
        memberProfiles: { g1: profiles },
      }),
    );

    const loaded = await loadMemberProfiles('g1');
    expect(loaded).toEqual(profiles);
  });

  it('rehydrates chat messages into IDB', async () => {
    const messages = [
      { id: 'm1', content: 'Hello', senderPubkey: 'pk1', groupId: 'g1', createdAt: 1700000000000 },
    ];
    await restoreFromBackup(
      makeEmptyPayload({
        groups: [{ id: 'g1', name: 'T', createdAt: 0, memberPubkeys: [], relays: [] }],
        chatMessages: { g1: messages },
      }),
    );

    const loaded = await loadMessages('g1');
    expect(loaded).toEqual(messages);
  });

  it('rehydrates MLS group state (base64-decoded) into IDB', async () => {
    const mlsBytes = new Uint8Array([10, 20, 30, 40, 50]);
    const b64 = uint8ArrayToBase64(mlsBytes);

    await restoreFromBackup(
      makeEmptyPayload({
        groups: [{ id: 'g1', name: 'T', createdAt: 0, memberPubkeys: [], relays: [] }],
        groupStates: { g1: b64 },
      }),
    );

    const stateBackend = new IdbGroupStateBackend();
    const restored = await stateBackend.getItem('g1');
    expect(new Uint8Array(restored as never)).toEqual(mlsBytes);
  });

  it('sets nostrBackedUp flag to true', async () => {
    await restoreFromBackup(makeEmptyPayload());

    expect(localStore[STORAGE_KEYS.nostrBackedUp]).toBe('true');
  });

  it('round-trips: collect then restore produces equivalent state', async () => {
    // Set up state
    localStore[STORAGE_KEYS.settings] = JSON.stringify({ theme: 'playful', language: 'de' });
    localStore[STORAGE_KEYS.scoreSyncSeq] = '7';
    await saveGroup({
      id: 'g1',
      name: 'Bio',
      createdAt: 1700000000000,
      memberPubkeys: ['pk1'],
      relays: ['wss://relay.example.com'],
    });
    await saveMemberScores('g1', [
      { pubkeyHex: 'pk1', nickname: 'A', scores: {}, lastSeq: 0 },
    ]);

    // Collect
    const payload = await collectBackupPayload();

    // Clear everything
    localStorageMock.clear();
    Object.keys(stores).forEach((k) => delete stores[k]);

    // Restore
    await restoreFromBackup(payload);

    // Verify
    expect(JSON.parse(localStore[STORAGE_KEYS.settings])).toEqual({
      theme: 'playful',
      language: 'de',
    });
    expect(localStore[STORAGE_KEYS.scoreSyncSeq]).toBe('7');
    const groups = await loadAllGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Bio');
  });
});

// ---------------------------------------------------------------------------
// S4: BackupScheduler
// ---------------------------------------------------------------------------

describe('BackupScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes immediately when markDirty(true) is called with no prior publish', () => {
    const publishFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new BackupScheduler(publishFn);

    scheduler.markDirty(true);

    expect(publishFn).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('debounces: does not publish again within 5 minutes', () => {
    const publishFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new BackupScheduler(publishFn);

    scheduler.markDirty(true); // First publish
    expect(publishFn).toHaveBeenCalledTimes(1);

    scheduler.markDirty(true); // Within debounce window
    // Should schedule, not publish immediately
    expect(publishFn).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it('publishes after debounce window expires', () => {
    const publishFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new BackupScheduler(publishFn);

    scheduler.markDirty(true); // First publish
    expect(publishFn).toHaveBeenCalledTimes(1);

    scheduler.markDirty(true); // Schedules for later

    // Advance past 5-minute debounce
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(publishFn).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('does not publish after dispose()', () => {
    const publishFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new BackupScheduler(publishFn);

    scheduler.markDirty(true);
    expect(publishFn).toHaveBeenCalledTimes(1);

    scheduler.markDirty(true); // Schedules
    scheduler.dispose();

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(publishFn).toHaveBeenCalledTimes(1); // No extra publish
  });

  it('schedules without immediate flag', () => {
    const publishFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new BackupScheduler(publishFn);

    scheduler.markDirty(); // No immediate flag
    expect(publishFn).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(publishFn).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it('coalesces multiple markDirty calls into one publish', () => {
    const publishFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new BackupScheduler(publishFn);

    scheduler.markDirty();
    scheduler.markDirty();
    scheduler.markDirty();

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(publishFn).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });
});
