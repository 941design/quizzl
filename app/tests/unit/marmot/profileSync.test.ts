import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import {
  serialiseProfileUpdate,
  parseProfilePayload,
  payloadToMemberProfile,
  PROFILE_RUMOR_KIND,
} from '@/src/lib/marmot/profileSync';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import type { UserProfile, SignedProfileEvent } from '@/src/types';

function makeUserProfile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    nickname: 'Alice',
    avatar: null,
    badgeIds: ['founder'],
    ...over,
  };
}

describe('profileSync wire format', () => {
  it('PROFILE_RUMOR_KIND is 0 (Nostr metadata)', () => {
    expect(PROFILE_RUMOR_KIND).toBe(0);
  });

  it('serialiseProfileUpdate signs an envelope and parseProfilePayload round-trips it (AC-001/002/044)', async () => {
    const sk = generateSecretKey();
    const skHex = bytesToHex(sk);
    const signer = createPrivateKeySigner(skHex);

    const profile = makeUserProfile({ nickname: 'Alice' });
    const wire = await serialiseProfileUpdate(profile, signer);
    const parsed = parseProfilePayload(wire);

    expect(parsed).not.toBeNull();
    expect(parsed!.nickname).toBe('Alice');
    expect(parsed!.badgeIds).toEqual(['founder']);
    expect(parsed!.avatar).toBeNull();
    expect(typeof parsed!.updatedAt).toBe('string');
    expect(parsed!.signedEvent).toBeDefined();
    const sig = parsed!.signedEvent as SignedProfileEvent;
    expect(sig.kind).toBe(0);
    expect(sig.pubkey).toBe(getPublicKey(sk));
    expect(typeof sig.id).toBe('string');
    expect(typeof sig.sig).toBe('string');
    expect(sig.tags).toEqual([]);
  });

  it('payloadToMemberProfile threads signedEvent through (AC-005/007)', async () => {
    const sk = generateSecretKey();
    const signer = createPrivateKeySigner(bytesToHex(sk));
    const wire = await serialiseProfileUpdate(makeUserProfile(), signer);
    const parsed = parseProfilePayload(wire)!;
    const member = payloadToMemberProfile(getPublicKey(sk), parsed);
    expect(member.signedEvent).toBeDefined();
    expect(member.signedEvent!.id).toBe(parsed.signedEvent!.id);
    expect(member.nickname).toBe('Alice');
  });

  it('payloadToMemberProfile keys by signedEvent.pubkey, not the fallback (AC-047)', async () => {
    // Author A signs a profile. A relayer (B) attempts to merge it under their
    // own pubkey by passing fallbackPubkeyHex = pubB. The helper MUST ignore
    // the fallback and key under A — protecting the relay-on-behalf seam in
    // story 06 from silent identity confusion.
    const skA = generateSecretKey();
    const skB = generateSecretKey();
    const pubA = getPublicKey(skA);
    const pubB = getPublicKey(skB);
    expect(pubA).not.toBe(pubB);
    const signerA = createPrivateKeySigner(bytesToHex(skA));
    const wire = await serialiseProfileUpdate(makeUserProfile({ nickname: 'AuthorA' }), signerA);
    const parsed = parseProfilePayload(wire)!;
    const member = payloadToMemberProfile(pubB, parsed);
    expect(member.pubkeyHex).toBe(pubA);
    expect(member.pubkeyHex).not.toBe(pubB);
    expect(member.nickname).toBe('AuthorA');
    expect(member.signedEvent!.pubkey).toBe(pubA);
  });

  it('payloadToMemberProfile keys by fallback when signedEvent is absent (legacy peers, AC-047)', () => {
    const member = payloadToMemberProfile('fallbackpub', {
      nickname: 'Legacy',
      avatar: null,
      badgeIds: [],
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(member.pubkeyHex).toBe('fallbackpub');
    expect(member.signedEvent).toBeUndefined();
  });

  it('payloadToMemberProfile leaves signedEvent undefined when payload has none (legacy path, AC-005)', () => {
    const member = payloadToMemberProfile('deadbeef', {
      nickname: 'Legacy',
      avatar: null,
      badgeIds: [],
      updatedAt: '2026-05-06T00:00:00.000Z',
    });
    expect(member.signedEvent).toBeUndefined();
    expect(member.nickname).toBe('Legacy');
  });

  it('parseProfilePayload accepts a legacy flat ProfilePayload (no envelope) with signedEvent undefined (AC-004)', () => {
    const flat = JSON.stringify({
      nickname: 'OldPeer',
      avatar: null,
      badgeIds: [],
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    const parsed = parseProfilePayload(flat);
    expect(parsed).not.toBeNull();
    expect(parsed!.nickname).toBe('OldPeer');
    expect(parsed!.signedEvent).toBeUndefined();
  });

  it('parseProfilePayload returns null when the embedded sig is forged/tampered (AC-003)', async () => {
    const sk = generateSecretKey();
    const signer = createPrivateKeySigner(bytesToHex(sk));
    const wire = await serialiseProfileUpdate(makeUserProfile(), signer);
    const env = JSON.parse(wire) as SignedProfileEvent;
    // Flip one nibble of the sig — keeps shape valid but breaks verification.
    const lastNibble = env.sig.slice(-1);
    const flippedNibble = lastNibble === '0' ? '1' : '0';
    env.sig = env.sig.slice(0, -1) + flippedNibble;
    const parsed = parseProfilePayload(JSON.stringify(env));
    expect(parsed).toBeNull();
  });

  it('parseProfilePayload returns null for an envelope-shaped event with kind != 0', () => {
    const sk = generateSecretKey();
    const signed = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify({
          nickname: 'Imposter',
          avatar: null,
          badgeIds: [],
          updatedAt: '2026-05-06T00:00:00.000Z',
        }),
      },
      sk,
    );
    const parsed = parseProfilePayload(JSON.stringify(signed));
    expect(parsed).toBeNull();
  });

  it('parseProfilePayload returns null when the envelope content is not valid inner profile JSON', async () => {
    const sk = generateSecretKey();
    // Sign a kind:0 envelope whose inner content is junk — verifyEvent will pass,
    // but parseInnerProfile must reject because nickname is missing.
    const signed = finalizeEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify({ totally: 'unrelated' }),
      },
      sk,
    );
    const parsed = parseProfilePayload(JSON.stringify(signed));
    expect(parsed).toBeNull();
  });

  it('parseProfilePayload returns null for malformed JSON', () => {
    expect(parseProfilePayload('not json')).toBeNull();
    expect(parseProfilePayload('[]')).toBeNull();
    expect(parseProfilePayload('null')).toBeNull();
  });

  it('round-trip preserves the avatar object structure', async () => {
    const sk = generateSecretKey();
    const signer = createPrivateKeySigner(bytesToHex(sk));
    const profile = makeUserProfile({
      avatar: {
        id: 'fox',
        imageUrl: 'https://example.test/fox.png',
        subject: 'fox',
        accessories: ['hat'],
      },
    });
    const wire = await serialiseProfileUpdate(profile, signer);
    const parsed = parseProfilePayload(wire)!;
    expect(parsed.avatar).toEqual({ id: 'fox', subject: 'fox', accessories: ['hat'] });
    const member = payloadToMemberProfile(getPublicKey(sk), parsed);
    expect(member.avatar).not.toBeNull();
    expect(member.avatar!.id).toBe('fox');
    expect(member.avatar!.imageUrl).toMatch(/fox\.png$/);
  });
});
