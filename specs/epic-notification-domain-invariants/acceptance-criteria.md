# Acceptance Criteria — Notification Bell Domain Invariants

Two invariants govern every criterion below:

- **INV-1 (off-domain rings):** event target ≠ active-view target → bell increments.
- **INV-2 (on-domain updates):** event target = active-view target → bell does NOT
  increment; the open view updates and persisted last-read advances.

## Registry (S1)

- **AC-REG-1** — `activeViewStore` exposes `setActiveView`, `clearActiveView`, and a
  pure `isActiveView(domain, id)` returning `true` only when the current active view's
  `(domain, id)` equals the arguments (peer ids compared lowercased).
- **AC-REG-2** — With no active view (list views, other routes, background),
  `isActiveView(...)` returns `false` for every input, so every domain's events ring
  the bell (INV-1 default).
- **AC-REG-3** — A group detail view registers `{group, id}` on resolve and clears it
  on unmount / navigation to the list; `ContactChat` registers `{dm, peer}` on mount
  and clears on unmount. After clear, `isActiveView` returns `false`.

## Group chat messages (S2)

- **AC-MSG-1** (INV-2) — While group X's detail view is active, a non-own chat
  message for X does NOT increment the bell; the message renders in the open chat and
  X's persisted last-read advances (no badge on reload).
- **AC-MSG-2** (INV-1) — While viewing group Y, the group list, or any non-group
  route, a chat message for X increments the bell for X.

## Join requests (S2)

- **AC-JR-1** (INV-2) — While group X's detail view is active, an incoming join
  request for X does NOT increment the bell; it appears live in the pending-requests
  list.
- **AC-JR-2** (INV-1) — While not viewing X, a join request for X increments the
  join-request bell for X.

## Invite-link expiries (S2)

- **AC-EXP-1** (INV-2) — While group X's detail view is active, a link expiry the
  sweep detects for X does NOT increment the bell; it is acknowledged (no badge on
  reload).
- **AC-EXP-2** (INV-1) — While not viewing X, a detected expiry for X increments the
  expiry bell for X (unchanged from today).

## Direct messages (S3)

- **AC-DM-1** (INV-2) — While the DM thread with contact A is active, a DM from A does
  NOT increment the bell; it renders in the open thread and A's last-read advances.
- **AC-DM-2** (INV-1) — While not viewing A's thread (contacts list, another thread,
  another route), a DM from A increments the bell for A.
- **AC-DM-3** (exception preserved) — A DM from a still-pending contact neither rings
  the bell nor is counted, regardless of active view — the existing pending-contact
  suppression is unchanged.

## Cross-cutting

- **AC-INV-1** — No live increment site rings the bell for an on-domain event: a
  static/audit check (or per-site test) confirms each of the four increment sites
  consults the registry before incrementing.
- **AC-DOC-1** — The two invariants are documented (a) as the module doc comment on
  `app/src/lib/activeViewStore.ts` and (b) in this spec directory
  (`specs/epic-notification-domain-invariants/`), which is their canonical home — so a
  future contributor adding a bell-feeding handler inherits the rule. They are
  deliberately NOT duplicated into `CLAUDE.md`.

## Manual Validation

- **AC-MANUAL-1** — Exploratory pass: open group X, have a peer send to X (no bell),
  switch to the list (peer sends again → bell), confirming the transition at the
  registry boundary feels correct in the real app.
