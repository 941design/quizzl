# Project-specific Decisions for the Emoji Feature Epic

These resolve the explicit "pick one and document it" choices in
`spec.md` for the **nostling / nostling** project. They are binding for all
stories in this epic; reopen via a follow-up epic if requirements change.

## D1 — Scope

**Decision:** Ship **both** the compose-area emoji picker (§1.1) and
message reactions (§1.2). Both must work across:

- **DM (1:1) chat** — `app/src/components/contacts/ContactChat.tsx`
  with `app/src/components/chat/ChatBox.tsx` as the message-input shell
  (NIP-17 / NIP-59 gift-wrapped transport, §2 of spec).
- **Marmot group chat** — `app/src/components/groups/GroupChat.tsx`
  (MLS application messages, kind-445 transport, §3 of spec).

The compose picker is one component reused in both surfaces; the
reaction picker is a second component reused in both surfaces.

## D2 — Reaction policy

**Decision:** **Multi-emoji** (Slack / Discord / Element semantics).

- A user may attach multiple **distinct** emoji to the same message.
- Selecting an emoji the user has already attached **removes** it.
- DB unique index is `(identity_id, message_id, reactor_pubkey, emoji)`
  — see §1.3 of the spec.
- The "Single-emoji" alternative is **not** in scope.

## D3 — Compose picker

**Decision:** **Hand-rolled curated 24-emoji grid** (§1.1 default
table). No new npm dependency. The same curated set is reused by the
reaction picker (§1.2).

- Implementation budget ≈ 150 LOC for the picker component.
- 4-column grid, ~6 rows.
- Categories: Faces, Gestures, Symbols, Objects (per spec table).
- `emoji-mart` is **not** in scope; revisit in a later epic if a
  full-Unicode picker is requested.

## D4 — NIP-30 custom emoji

**Decision:** **Defer NIP-30.** Render Unicode glyphs only.

- No `:shortcode:` parsing, no inline image rendering of emoji tags.
- No NIP-51 emoji-pack subscription.
- `emoji` tags on incoming reaction events are ignored (carried
  opaquely through MLS but not rendered).
- §2.3 and step 7 of §5 of the spec are explicitly **out of scope**.

## D5 — Optional features

These are flagged "optional" in the spec. For this epic:

| Feature                                  | Spec § | Decision |
|------------------------------------------|--------|----------|
| Quick-reactions inline row (5–7 emoji)   | §1.2   | **Defer** — open the reaction picker on every reaction trigger. |
| Default reaction on double-click/tap     | §1.2, §1.6 | **Defer** — power-user shortcut, not load-bearing. |
| `Cmd/Ctrl+Shift+E` shortcut to toggle picker | §1.6 | **Include** — cheap to wire up alongside the picker. |
| Reactor tooltip on badge hover           | §1.2   | **Include** — needed to surface multi-reactor state. |

## D6 — Wire transports

Both transports from the spec are in scope and must be implemented
behind a transport-agnostic outbound API:

- **DM:** wrap kind-7 rumor in NIP-59 gift wrap addressed to the
  conversation partner; publish to the DM relay set (§2.2).
- **Marmot group:** pass kind-7 rumor to the MLS group via marmot-ts
  `group.sendApplicationRumor(rumor)` so it is encrypted as kind-445
  on the wire (§3.2).

Reaction-removal events (`content: "-"`) use the same transport.

## D9 — DM transport: migrate to NIP-17 / NIP-59 globally

The codebase today sends DMs as **NIP-04 kind-4** events
(`app/src/lib/directMessages.ts`). The spec for reactions assumes
NIP-17 / NIP-59 gift-wrap (§2.2). Adding gift-wrap *only* for
reactions while keeping DMs on NIP-04 is rejected: it doubles the
transport surface and leaves DMs unprotected. Therefore:

- **All outbound DM payloads in this epic** — chat messages
  (kind-14 / kind-13 rumors), reactions (kind-7 rumors), and any DM
  control events — are sent as NIP-17 sealed messages wrapped in
  NIP-59 gift wraps (kind 1059 on the wire).
- A new gift-wrap helper module is introduced under
  `app/src/lib/directMessages/` (or alongside the existing file) and
  exposes `sealAndWrap(rumor, recipientPubkey)` plus `unwrapAndOpen(wrap)`.
- `publishDirectMessage` is rewritten to call the new helper instead
  of `nip04.encrypt`. The existing function name and signature stay
  stable for callers; only the wire format changes.
- Group transport is unaffected — Marmot/MLS already provides the
  encryption envelope and the kind-7 rumor goes inside it unchanged.

### D9a — Backwards compatibility (inbound)

- The NIP-04 decrypt path stays in place **indefinitely** as a
  read-only inbound code path, both for IDB-persisted history and for
  live kind-4 events from peers who run older clients.
- A subscription on **both** kind 4 and kind 1059 runs on the DM
  relay set. Kind-4 events go through the legacy NIP-04 decrypt;
  kind-1059 events go through the new gift-wrap unwrap.
- Inbound deduplication is by inner-rumor `id` (after unwrap) and by
  outer-event `id` (for raw kind-4) — both flow into the same
  `appendMessage` call so the UI sees one merged thread.

### D9b — Outbound

- Outbound is **NIP-17 / NIP-59 only**. No dual-publish of kind-4 +
  kind-1059. Peers on older clients receive nothing new from this app
  after the migration ships.
- This is a deliberate user-visible breaking change; release notes
  must call it out.

## D10 — Reaction-rumor inner shape (DM)

The unsigned kind-7 *rumor* placed inside the gift wrap follows the
NIP-25 shape:

```json
{
  "kind": 7,
  "content": "👍",
  "tags": [
    ["e", "<target-message-event-id-hex>"],
    ["p", "<conversation-partner-pubkey-hex>"],
    ["k", "<kind-of-target-event>"]
  ],
  "pubkey": "<sender-pubkey-hex>",
  "created_at": "<unix-seconds>",
  "id": "<event-hash>"
}
```

(no `sig` — gift wrap covers authenticity). Removal rumor: same
shape with `content: "-"`.

## D11 — Persistence keyspace and identity

Per the explorer findings, this app is **single-identity**: there is
no multi-identity isolation requirement and no `identity_id` concept
in storage. The spec's `identity_id` column is therefore **dropped**
from the schema. Reaction rows are scoped by:

- Group reactions: `groupId` (matches the existing message keyspace
  `quizzl:messages:{groupId}`).
- DM reactions: peer pubkey hex (matches the existing DM keyspace).

idb-keyval namespaces:

- `quizzl:reactions:group:{groupId}`
- `quizzl:reactions:dm:{peerPubkeyHex}`

Both store an array of `Reaction` rows with the schema in §1.3 of the
spec, *minus* `identity_id`. Multi-emoji unique key:
`(message_id, reactor_pubkey, emoji)`.

## D7 — Optimistic publish failure policy

If a reaction publish ultimately fails on **all** relays (DMs) or the
MLS send fails (groups):

- Log the failure.
- **Roll back** the local optimistic row.
- Surface a small inline "couldn't react" toast on the affected
  message; do **not** retry automatically.

(Spec §2.5 leaves this as a project policy choice.)

## D8 — Persistence layout

The reactions table from §1.3 lives in the existing client-side
storage layer. The actual storage primitive (idb-keyval namespace,
SQLite via wasm, etc.) is the planner's choice; the *schema and
indices* defined in §1.3 are binding.

`identity_id` corresponds to the project's existing local-identity
concept (the keypair under which the conversation is opened). Multi-
identity isolation is non-negotiable: reactions from identity A must
not be visible in conversation views opened under identity B.
