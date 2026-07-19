# Epic Architecture — Group member-admitted chat announcement

## Paradigm
Modular monolith, package-by-feature. React + context providers; MLS group
messaging via marmot-ts; kind-9 application rumors as the chat substrate.
Display-only structured announcements are an established sub-pattern.

## Module map
| Module | Purpose | Location | Owned data |
|---|---|---|---|
| marmot-structured-content | Parse & type the structured payloads carried in kind-9 chat content | `app/src/lib/marmot/parseStructured.ts` | `StructuredContent` union + guards |
| chat-render | Render chat messages, branching structured payloads to presentational components | `app/src/components/chat/ChatBox.tsx` | `renderStructuredMessage` |
| group-announcements | Presentational components for group timeline announcements | `app/src/components/groups/*ChatAnnouncement.tsx` | announcement components |
| i18n | User-facing copy (en/de) | `app/src/lib/i18n.ts` | `Copy` type + language objects |
| groups-page | Group detail view; admin action handlers + announcement send sites | `app/pages/groups.tsx` | `handleApproveRequest`, `sendAnnouncementRef` |

## Boundary rules
No new cross-module coupling. The change extends five existing modules along
seams they already expose for the `group_renamed` sibling. The announcement is
built as a plain JSON string at the send site and consumed as a parsed union at
the render site — the only contract between groups-page and chat-render is the
`{ type: 'member_admitted', pubkey }` payload shape, owned by
marmot-structured-content.

## Seams
- `member_admitted` payload shape: `{ type: 'member_admitted', pubkey: string }`.
  Producer: groups-page (`handleApproveRequest`). Validator/typer:
  marmot-structured-content (`parseStructured`). Consumer: chat-render
  (`renderStructuredMessage`).

## Implementation constraints
- Admitter attribution MUST come from `msg.senderPubkey` (protocol-enforced),
  never a payload field (security invariant, shared with `invite_cancelled` /
  `group_renamed`).
- All new user-facing text via i18n en+de.
- Send only on `approveJoinRequest` success; direct-invite path untouched.

## Order-Sensitive Composition
Not order-sensitive. The announcement is a fire-and-forget display-only kind-9
with no convergence, merge, tombstone, or crash-recovery semantics. It carries
no authorization meaning (ADR-006 governs authorization mutations, not display
notices). Delivery is best-effort exactly like the existing `group_renamed`
notice; a dropped or reordered announcement has no correctness consequence
beyond a missing/late timeline row, identical to the sibling announcements.
