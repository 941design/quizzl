# ADR-003: Accept last-writer-wins for MLS metadata mutations (no protocol-level no-clobber in marmot-ts)

**Status**: Proposed
**Date**: 2026-06-12
**Type**: Lightweight
**Affects**: specs/epic-feature-request-admin-role-management-for-groups/, specs/epic-mls-fork-resolution/, project-wide
**Supersedes**: none
**Superseded by**: none

## Context

What forces are at play. What constraints exist. What we know, what we
don't. Cite `path:line` for evidence of any claim about the codebase.

## Decision

What we decided. Specific enough to constrain future implementation —
"we use X" not "we prefer X-style approaches." If the decision codifies
a pattern of repeated rejections from `BACKLOG.json#archive[]`, list the
archive entries it absorbs.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| <name> | <reason> |

For lightweight ADRs born from a single decision, one alternative may be
enough. For `Type: Debated` ADRs (born from `base:arch-debate`), this
table is populated from the debate rounds.

## Consequences

**Positive**: <what becomes easier, what is now possible>
**Negative**: <accepted costs, ergonomic regressions, complexity added>
**Accepted Risks**: <what we know we're not solving and why that's OK>

## Evolution Triggers

Conditions under which this ADR should be reopened:

- <named circumstance, e.g. "if library X reaches 1.0 with a stable API">
- <named circumstance, e.g. "if the rejected `gRPC` cluster reappears
  with a concrete cross-org driver">

## References

- Origin: curator-promoted from admin-role-management epic (S3 Codex review + marmot-researcher source investigation, 2026-06-11); direct via `/base:adr`
- Related ADRs: none
- Related specs: specs/epic-feature-request-admin-role-management-for-groups/, specs/epic-mls-fork-resolution/
