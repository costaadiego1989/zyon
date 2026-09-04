# AACP Backend Ready-to-Prod Audit

**Branch:** `audit/ready-to-prod-backend`
**Date:** 2026-09-04
**Verdict:** **NO — CONDITIONAL** (5 P0 + 9 P1 must be resolved before cutover)

## Index

| File | Purpose |
|------|---------|
| [VERDICT.md](./VERDICT.md) | Full audit verdict, scoring, top risks, async decision |
| [adrs/ADR-001-auth-jwt-redis-revocation.md](./adrs/ADR-001-auth-jwt-redis-revocation.md) | P0 — JWT revocation multi-instance safety |
| [adrs/ADR-002-returns-tenant-write-guard.md](./adrs/ADR-002-returns-tenant-write-guard.md) | P0 — Returns cross-tenant write primitive |
| [adrs/ADR-003-post-sale-public-buyer-auth.md](./adrs/ADR-003-post-sale-public-buyer-auth.md) | P0 — Public review/NPS spam primitive |
| [adrs/ADR-004-storage-tenant-ownership.md](./adrs/ADR-004-storage-tenant-ownership.md) | P0 — S3 delete cross-tenant |
| [adrs/ADR-005-support-ws-auth.md](./adrs/ADR-005-support-ws-auth.md) | P0 — WS rooms unauthenticated |
| [adrs/ADR-006-revenue-manager-decimal-coercion.md](./adrs/ADR-006-revenue-manager-decimal-coercion.md) | P1 — Decimal→Number coercion |
| [adrs/ADR-007-m2m-acp-int-cents.md](./adrs/ADR-007-m2m-acp-int-cents.md) | P1 — Float cart totals |
| [adrs/ADR-008-m2m-webhook-hmac.md](./adrs/ADR-008-m2m-webhook-hmac.md) | P1 — Outbound M2M webhook signing |
| [adrs/ADR-009-embed-tenant-from-claims.md](./adrs/ADR-009-embed-tenant-from-claims.md) | P1 — Embed tenant from JWT claims |
| [adrs/ADR-010-cart-recovery-bullmq.md](./adrs/ADR-010-cart-recovery-bullmq.md) | P1 — Cart-recovery multi-replica race |
| [adrs/ADR-011-revenue-observation-shard.md](./adrs/ADR-011-revenue-observation-shard.md) | P1 — Daily observation sharding |
| [adrs/ADR-012-llm-safety-second-pass.md](./adrs/ADR-012-llm-safety-second-pass.md) | P1 — LLM safety judge layer |

Each ADR contains:
- Context (problem evidence)
- Decision (concrete fix)
- Implementation steps
- Verification commands
- Files touched

## How to Use This Audit

1. Read VERDICT.md for the executive summary and full matrix.
2. Pick P0 blockers first — they ship-block.
3. Each ADR is implementation-ready: a developer can pick it up and execute without re-investigating.
4. After P0/P1 fix → re-run cluster-1/3/5 re-audit and reconcile any new findings.

## Suggested Sprint Plan

| Sprint | Scope | Outcomes |
|--------|-------|----------|
| **S1 (P0 fixes, 1 week)** | ADR-001 → ADR-005 | All cross-tenant primitives closed |
| **S2 (P1 fixes, 2 weeks)** | ADR-006 → ADR-012 | Money precision, webhook signing, WS safety, LLM defense in depth |
| **S3 (P2 backlog, ongoing)** | P2-001 → P2-014 | State machines, dead-code removal, Sentry init, health split |
| **S4 (P3 polish, ongoing)** | duplicates, OTP entropy, log redaction | Tech debt reduction |
