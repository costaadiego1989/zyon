# ADR-017 — Domains verify TTL recheck + transaction

**Status:** PROPOSED (P1)
**Module:** `domains`
**Issue:** P1-012

---

## Context

`verify-domain.use-case.ts:32-43` runs `findFirst → DNS call → update` without transaction. Concurrent verifies race. Verified-once-never-reverified.

Caddy endpoint returns `merchantId` to anyone.

---

## Decision

1. TTL check: skip if recently verified (24h default).
2. Wrap read+update in `prisma.$transaction` with `Serializable`.
3. Caddy endpoint returns 200/404 only — strip `merchantId`.

---

## Implementation Steps

1. Add `verifiedAt` TTL config (24h default).
2. Refactor `verify-domain.use-case.ts` to skip work if recent.
3. Wrap `findFirst + update` in transaction.
4. Strip `merchantId` from `DomainCheckController` response.

---

## Files Touched

- `apps/api/src/modules/domains/application/use-cases/verify-domain.use-case.ts`
- `apps/api/src/modules/domains/presentation/http/domains.controller.ts:88-103`
- Tests
