# Feature Spec: Peer Backup (Account Recovery via Group Members)

## Goal

Distribute encrypted backup blobs to group peers over MLS, so account recovery does not depend on relay availability. Peers store opaque encrypted data they cannot read and return it on request.

## Background

Relay backup (see `relay-backup.md`) provides the primary recovery path. Peer backup is a complementary layer: decentralized, relay-independent, and resilient to relay downtime or data loss. The two features use the same encrypted blob format — only the transport and storage differ.

## Key Decisions

### 1. Two new MLS rumor kinds

- `BACKUP_PUBLISH` (kind 200) — sender broadcasts their encrypted backup blob to the group
- `BACKUP_REQUEST` (kind 201) — sender requests peers to return any stored backup for them

Peers respond to a `BACKUP_REQUEST` by sending the stored blob back as a `BACKUP_PUBLISH` targeted at the requester.

### 2. Backup blob is identical to relay backup

Same serialization, same NIP-44 encryption to self. Peers store the exact same opaque ciphertext that would go to a relay. No peer can read or modify the contents.

### 3. Peers store one blob per group member

Each peer maintains a simple IndexedDB store: `quizzl-peer-backups`, keyed by `senderPubkey`. On receiving a `BACKUP_PUBLISH` rumor, overwrite the previous blob for that sender. This caps storage at roughly `(group size - 1) * max blob size`.

### 4. Storage quota per peer

Peers have finite storage and should not be obligated to store unlimited data for all members indefinitely.

- **Per-member cap:** 100 KB per stored backup blob. Discard if exceeded.
- **Per-peer total cap:** TBD — limits total storage a single peer dedicates to backup duty across all groups and members. Evict least-recently-updated entries when full.
- **Quota scales with uptime:** Peers that are online more frequently and reliably are better backup candidates. The protocol should account for this (see "Uptime-aware storage" below).

### 5. Publish frequency matches relay backup

Backup is broadcast to all groups using the same trigger priorities as relay backup (see `relay-backup.md`). Chat messages alone do not trigger a peer broadcast. Every group the user belongs to gets a copy, maximizing redundancy.

### 6. Any one online peer in any one group is sufficient

Recovery only needs one peer in one group to respond. Multiple groups = multiple independent backup pools. The more groups a user is in, the more resilient recovery becomes.

### 7. Restore requires group rejoin first

The bootstrap sequence is:

1. Restore nsec → rejoin at least one group via Welcome
2. Send `BACKUP_REQUEST` to the group
3. Any peer with a stored blob responds
4. Decrypt and rehydrate

This means peer backup alone cannot be the first recovery step — it requires an active group member to send a Welcome. Relay backup handles the "no peers available" case.

### 8. Recency negotiation on recovery

When a recovering user sends `BACKUP_REQUEST`, multiple peers may hold backups of different ages. Rather than all peers flooding the channel simultaneously:

1. `BACKUP_REQUEST` includes an optional `have_timestamp` field (0 on fresh restore, or the timestamp of a backup already obtained from relay).
2. Peers respond with `BACKUP_OFFER` (kind 202) containing only their stored blob's timestamp and size — not the blob itself.
3. Requester evaluates offers, picks the newest, and sends `BACKUP_ACCEPT` (kind 203) to that specific peer.
4. Selected peer sends the full `BACKUP_PUBLISH` blob.

This avoids flooding and ensures the freshest backup is selected efficiently.

### 9. Uptime-aware storage (details TBD)

Not all peers are equally good backup hosts. A peer that is online 5 minutes a day is less useful than one that runs continuously. The protocol should eventually account for this:

- **Peer availability signaling** — peers could periodically advertise their availability (e.g., a lightweight heartbeat rumor or a "last seen" metric derived from MLS activity).
- **Selective storage** — a publishing user could prefer to store backups with peers that are frequently online, rather than broadcasting to all.
- **Storage volunteering** — peers could opt in/out of backup storage duty, or advertise their capacity.

Exact mechanism is left to detailed design. For the initial implementation, all peers store all backups equally.

## MLS Message Flow

### Publishing backup

```
User A state changes → serialize + NIP-44 encrypt to self
→ buildRumor(200, encryptedBlob, pubkey)
→ sendApplicationRumor to all groups
```

### Peer storage (on receiving kind 200)

```
Peer receives BACKUP_PUBLISH from User A
→ if blob.size <= 100KB: store in quizzl-peer-backups[A.pubkey] = blob
→ else: discard
```

### Requesting backup (after restore + rejoin)

```
User A rejoins group
→ buildRumor(201, { have_timestamp: 0 }, pubkey)
→ sendApplicationRumor to group
```

### Peer offer (on receiving kind 201)

```
Peer receives BACKUP_REQUEST from User A
→ lookup quizzl-peer-backups[A.pubkey]
→ if found AND stored_timestamp > have_timestamp:
    buildRumor(202, { timestamp, size }, ownPubkey, [["p", A.pubkey]])
    → send BACKUP_OFFER to group
→ else: ignore (nothing newer to offer)
```

### Requester selects best offer

```
User A collects BACKUP_OFFERs for a short window (e.g. 5 seconds)
→ pick offer with newest timestamp
→ buildRumor(203, "", pubkey, [["p", selectedPeer.pubkey]])
→ send BACKUP_ACCEPT to group
```

### Selected peer delivers blob

```
Selected peer receives BACKUP_ACCEPT addressed to them
→ buildRumor(200, storedBlob, ownPubkey, [["p", A.pubkey]])
→ send to group
```

User A receives the kind 200 response, decrypts, rehydrates.

## Combined Restore Flow (Relay + Peer)

1. Restore nsec from mnemonic
2. Fetch relay backup (kind 30078 `d:quizzl`) — if found, decrypt and rehydrate
3. Process pending Welcome invitations → rejoin groups
4. Send `BACKUP_REQUEST` to each group
5. If any peer responds with a newer backup (compare `created_at` or embedded timestamp) → update local state
6. Resume with best available state

## What Peers Store

| Field | Details |
|-------|---------|
| Key | Sender's pubkey hex |
| Value | Opaque NIP-44 ciphertext (the full backup blob) |
| Max size | 100 KB per entry |
| Eviction | Overwrite on newer blob from same sender |
| Cleanup | Remove entry when member leaves group (MLS remove commit) |

## Rumor Kinds Summary

| Kind | Name | Direction | Payload |
|------|------|-----------|---------|
| 200 | `BACKUP_PUBLISH` | Sender → all peers (broadcast) / Selected peer → requester (targeted) | Full encrypted backup blob |
| 201 | `BACKUP_REQUEST` | Recovering user → group | `{ have_timestamp }` |
| 202 | `BACKUP_OFFER` | Peer → requester | `{ timestamp, size }` |
| 203 | `BACKUP_ACCEPT` | Requester → selected peer | (empty, `p` tag targets peer) |

## Open Questions

- Should there be a protocol version field in the rumor tags for future evolution?
- Exact uptime-awareness mechanism — heartbeat rumors, activity-derived heuristics, or explicit opt-in?
- Per-peer total storage cap — what's a reasonable ceiling across all groups?
- Should `BACKUP_PUBLISH` broadcasts be staggered or sent to groups in priority order (e.g., most active group first)?
- Conflict resolution if two peers offer the same timestamp — tiebreak by peer pubkey, or requester picks randomly?
- Should peers persist backups across browser sessions (IndexedDB) or treat them as ephemeral (memory only)?
