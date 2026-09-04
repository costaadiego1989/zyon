# ADR-018 — Storefront bounds findMany + adds pagination

**Status:** PROPOSED (P1)
**Module:** `storefront`
**Issue:** P1-013

---

## Context

- `get-store-config.use-case.ts:99-110` — `merchant.findMany` slug fallback scans every merchant per request.
- 6 funnel endpoints unbounded.
- `list-budget-requests.use-case.ts:14`, `search-marketplace-products-storefront.use-case.ts:45` — unbounded.

---

## Decision

Add `take` to all unbounded findMany. Add `cursor`/`limit` query params. Replace slug-fallback findMany with unique slug findUnique.

---

## Implementation Steps

1. Bound `get-store-config` slug fallback: hard limit `take: 100` + log error.
2. Add pagination to funnel endpoints (cursor on `createdAt + id`).
3. Bound `list-budget-requests` with `take: 50` + max 200.
4. Unique index on `merchant.slug` (migration).

---

## Files Touched

- 4 use-cases
- `apps/api/prisma/schema.prisma` (slug unique index)
- Tests
