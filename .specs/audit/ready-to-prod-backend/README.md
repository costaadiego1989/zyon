# AACP Backend Ready-to-Prod Audit

**Branch:** `audit/ready-to-prod-backend`
**Date:** 2026-09-04
**Verdict:** **NO — CONDITIONAL** (16 P0 + 16 P1 must be resolved before cutover)

## Index

### P0 ADRs (16 — ship-blockers)

| File | Module | Issue |
|------|--------|-------|
| [ADR-001-auth-jwt-redis-revocation.md](./adrs/ADR-001-auth-jwt-redis-revocation.md) | auth | JWT revocation multi-instance safety |
| [ADR-002-returns-tenant-write-guard.md](./adrs/ADR-002-returns-tenant-write-guard.md) | returns | Cross-tenant write primitive |
| [ADR-003-post-sale-public-buyer-auth.md](./adrs/ADR-003-post-sale-public-buyer-auth.md) | post-sale | Public review/NPS spam primitive |
| [ADR-004-storage-tenant-ownership.md](./adrs/ADR-004-storage-tenant-ownership.md) | shared/storage | S3 delete cross-tenant |
| [ADR-005-support-ws-auth.md](./adrs/ADR-005-support-ws-auth.md) | support | WS rooms unauthenticated |
| [ADR-013-catalog-cache-invalidation.md](./adrs/ADR-013-catalog-cache-invalidation.md) | catalog | Catalog cache stale 5min after mutations |
| [ADR-014-cross-sell-idempotency.md](./adrs/ADR-014-cross-sell-idempotency.md) | cross-sell | Cross-sell accept TOCTOU double-charge |
| [ADR-019-coupons-redeem-atomicity.md](./adrs/ADR-019-coupons-redeem-atomicity.md) | coupons | Coupons redeem + apply race |
| [ADR-020-commerce-webhook-signatures.md](./adrs/ADR-020-commerce-webhook-signatures.md) | commerce | Tray/VTEX webhook forgery |
| [ADR-021-commerce-dedup-retention.md](./adrs/ADR-021-commerce-dedup-retention.md) | commerce | Commerce dedup unbounded growth |
| [ADR-022-inventory-stock-atomicity.md](./adrs/ADR-022-inventory-stock-atomicity.md) | inventory | Stock non-atomic + sale.completed not idempotent |
| [ADR-023-fulfillment-tracking-atomicity.md](./adrs/ADR-023-fulfillment-tracking-atomicity.md) | fulfillment | Tracking event non-atomic |
| [ADR-024-inventory-webhook-signatures.md](./adrs/ADR-024-inventory-webhook-signatures.md) | inventory | Inventory marketplace webhook forgery |
| [ADR-025-payment-webhook-timing-safe.md](./adrs/ADR-025-payment-webhook-timing-safe.md) | payment | Asaas billing FAIL-OPEN + MP HMAC byte-loop |
| [ADR-026-payment-intent-atomicity.md](./adrs/ADR-026-payment-intent-atomicity.md) | payment | Payment intent race → double-charge |
| [ADR-027-checkout-complete-order-atomic.md](./adrs/ADR-027-checkout-complete-order-atomic.md) | checkout | Complete-order optional $transaction |

### P1 ADRs (16 — critical)

| File | Module | Issue |
|------|--------|-------|
| [ADR-006-revenue-manager-decimal-coercion.md](./adrs/ADR-006-revenue-manager-decimal-coercion.md) | revenue-manager | Decimal→Number coercion |
| [ADR-007-m2m-acp-int-cents.md](./adrs/ADR-007-m2m-acp-int-cents.md) | negotiation, ACP | Float cart totals |
| [ADR-008-m2m-webhook-hmac.md](./adrs/ADR-008-m2m-webhook-hmac.md) | negotiation | Outbound M2M webhook signing |
| [ADR-009-embed-tenant-from-claims.md](./adrs/ADR-009-embed-tenant-from-claims.md) | embed | Embed tenant from JWT claims |
| [ADR-010-cart-recovery-bullmq.md](./adrs/ADR-010-cart-recovery-bullmq.md) | cart-recovery | Multi-replica scanner race |
| [ADR-011-revenue-observation-shard.md](./adrs/ADR-011-revenue-observation-shard.md) | revenue-manager | Daily observation sharding |
| [ADR-012-llm-safety-second-pass.md](./adrs/ADR-012-llm-safety-second-pass.md) | agent-rules | LLM safety judge layer |
| [ADR-015-storefront-prisma-extract.md](./adrs/ADR-015-storefront-prisma-extract.md) | storefront | 47 raw prisma calls |
| [ADR-016-store-settings-json-merge.md](./adrs/ADR-016-store-settings-json-merge.md) | store-settings | Shallow JSON merge |
| [ADR-017-domains-ttl-recheck.md](./adrs/ADR-017-domains-ttl-recheck.md) | domains | DNS race + no TTL recheck |
| [ADR-018-storefront-pagination.md](./adrs/ADR-018-storefront-pagination.md) | storefront | Unbounded findMany |

Each ADR contains: Context, Decision, Implementation Steps, Verification commands, Files Touched.

## How to Use This Audit

1. Read VERDICT.md for the executive summary and full matrix.
2. Pick P0 blockers first — they ship-block.
3. Each ADR is implementation-ready.
4. After P0/P1 fix → load validation against concurrent payment + coupon + stock decrement.

## Suggested Sprint Plan

| Sprint | Scope | Outcomes |
|--------|-------|----------|
| **S1 (P0 fixes, 1.5 weeks)** | ADR-001 → ADR-005, ADR-013, ADR-014 | All cross-tenant primitives + cache + idempotency closed |
| **S2 (P0 fixes, 1.5 weeks)** | ADR-019 → ADR-022, ADR-027 | Financial surface atomicity (coupons, commerce, inventory, checkout) |
| **S3 (P0 fixes, 1 week)** | ADR-023, ADR-024, ADR-025, ADR-026 | Fulfillment, inventory + payment webhook + intent atomicity |
| **S4 (P1 fixes, 2-3 weeks)** | ADR-006 → ADR-012, ADR-015 → ADR-018 | Money precision, webhook signing, WS safety, LLM defense, storefront refactor |
| **S5 (P2 backlog, ongoing)** | P2-001 → P2-018 | State machines, dead-code removal, Sentry init, health split |
| **S6 (P3 polish, ongoing)** | duplicates, OTP entropy, log redaction | Tech debt reduction |

## Coverage

**100%** of 46 modules audited. Cluster 1 (critical-path) was re-scouted after session resume. Patterns repeat strongly across the codebase.

## Async Architecture Decision

**KEEP BULLMQ** — outbox + BullMQ pattern is canonical. RabbitMQ upgrade not justified.
