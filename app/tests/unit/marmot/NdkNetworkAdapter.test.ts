import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock NDK and DEFAULT_RELAYS before importing the adapter
// ---------------------------------------------------------------------------

const mockFetchEvents = vi.fn();

vi.mock('@nostr-dev-kit/ndk', () => {
  return {
    NDKEvent: class {},
    NDKFilter: class {},
    NDKSubscription: class {},
    NDKRelaySet: {
      fromRelayUrls: vi.fn((_relays: string[], _ndk: unknown) => 'mock-relay-set'),
    },
  };
});

vi.mock('@/src/types', () => ({
  DEFAULT_RELAYS: ['wss://relay.damus.io', 'wss://nos.lol'],
}));

import { NdkNetworkAdapter } from '@/src/lib/marmot/NdkNetworkAdapter';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';

// ---------------------------------------------------------------------------
// rawPublish tests (WebSocket-based)
// ---------------------------------------------------------------------------

describe('NdkNetworkAdapter — rawPublish (via publish)', () => {
  let adapter: NdkNetworkAdapter;
  let mockNdk: { fetchEvents: typeof mockFetchEvents };
  let mockWebSocketInstances: Array<{
    onopen: (() => void) | null;
    onmessage: ((msg: { data: string }) => void) | null;
    onerror: (() => void) | null;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>;
  let origWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    mockFetchEvents.mockReset();
    mockWebSocketInstances = [];

    mockNdk = { fetchEvents: mockFetchEvents } as unknown as typeof mockNdk;
    adapter = new NdkNetworkAdapter(mockNdk as never);

    origWebSocket = globalThis.WebSocket;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = class MockWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((msg: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      send = vi.fn();
      close = vi.fn();

      constructor(_url: string) {
        mockWebSocketInstances.push(this);
        // fire onopen on next tick
        setTimeout(() => this.onopen?.(), 0);
      }
    };
  });

  afterEach(() => {
    globalThis.WebSocket = origWebSocket;
  });

  const sampleEvent = {
    id: 'event123',
    pubkey: 'pub1',
    created_at: 1000,
    kind: 1059,
    tags: [],
    content: 'encrypted',
    sig: 'sig1',
  };

  it('resolves ok: true on successful relay acknowledgment', async () => {
    const resultPromise = adapter.publish(['wss://relay.test'], sampleEvent);

    // Wait for WebSocket to be created and onopen to fire
    await new Promise((r) => setTimeout(r, 10));

    const ws = mockWebSocketInstances[0];
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(['EVENT', sampleEvent]));

    // Simulate relay OK response
    ws.onmessage?.({ data: JSON.stringify(['OK', 'event123', true, '']) });

    const result = await resultPromise;
    expect(result['wss://relay.test'].ok).toBe(true);
  });

  it('resolves ok: false on WebSocket error', async () => {
    const resultPromise = adapter.publish(['wss://relay.test'], sampleEvent);

    await new Promise((r) => setTimeout(r, 10));

    const ws = mockWebSocketInstances[0];
    ws.onerror?.();

    const result = await resultPromise;
    expect(result['wss://relay.test'].ok).toBe(false);
    expect(result['wss://relay.test'].message).toBe('websocket error');
  });

  it('resolves ok: false with timeout message when relay does not respond', async () => {
    vi.useFakeTimers();

    const resultPromise = adapter.publish(['wss://relay.test'], sampleEvent);

    // Advance past onopen tick
    await vi.advanceTimersByTimeAsync(1);
    // Advance past the 10s timeout
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await resultPromise;
    expect(result['wss://relay.test'].ok).toBe(false);
    expect(result['wss://relay.test'].message).toBe('timeout');

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// request / subscription relay scoping
// ---------------------------------------------------------------------------

describe('NdkNetworkAdapter — request relay scoping', () => {
  let adapter: NdkNetworkAdapter;

  beforeEach(() => {
    mockFetchEvents.mockReset();
    mockFetchEvents.mockResolvedValue(new Set());
    const mockNdk = { fetchEvents: mockFetchEvents };
    adapter = new NdkNetworkAdapter(mockNdk as never);
    vi.mocked(NDKRelaySet.fromRelayUrls).mockClear();
  });

  it('passes NDKRelaySet built from relays to fetchEvents', async () => {
    await adapter.request(['wss://relay.a', 'wss://relay.b'], { kinds: [1] });

    expect(NDKRelaySet.fromRelayUrls).toHaveBeenCalledWith(
      ['wss://relay.a', 'wss://relay.b'],
      expect.anything(),
    );
    expect(mockFetchEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'mock-relay-set',
    );
  });
});

// ---------------------------------------------------------------------------
// getUserInboxRelays tests
// ---------------------------------------------------------------------------

describe('NdkNetworkAdapter — getUserInboxRelays', () => {
  let adapter: NdkNetworkAdapter;

  beforeEach(() => {
    mockFetchEvents.mockReset();
    const mockNdk = { fetchEvents: mockFetchEvents };
    adapter = new NdkNetworkAdapter(mockNdk as never);
  });

  it('returns DEFAULT_RELAYS when no kind 10051 event found', async () => {
    mockFetchEvents.mockResolvedValue(new Set());

    const relays = await adapter.getUserInboxRelays('somepubkey');
    expect(relays).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('returns DEFAULT_RELAYS when event has no relay tags', async () => {
    const event = { tags: [['other', 'value']] };
    mockFetchEvents.mockResolvedValue(new Set([event]));

    const relays = await adapter.getUserInboxRelays('somepubkey');
    expect(relays).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('returns DEFAULT_RELAYS on fetch error', async () => {
    mockFetchEvents.mockRejectedValue(new Error('network error'));

    const relays = await adapter.getUserInboxRelays('somepubkey');
    expect(relays).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('returns relay tags when event has relay tags', async () => {
    const event = {
      tags: [
        ['relay', 'wss://inbox.relay.one'],
        ['relay', 'wss://inbox.relay.two'],
        ['other', 'ignored'],
      ],
    };
    mockFetchEvents.mockResolvedValue(new Set([event]));

    const relays = await adapter.getUserInboxRelays('somepubkey');
    expect(relays).toEqual(['wss://inbox.relay.one', 'wss://inbox.relay.two']);
  });
});
