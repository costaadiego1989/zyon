# ADR-015 — Storefront controller stops bypassing application layer

**Status:** PROPOSED (P1)
**Module:** `storefront`
**Issue:** P1-010

---

## Context

`storefront.controller.ts` contains 47 direct `this.prisma.*` calls. Bypasses use-case/repository/application-layer abstractions.

---

## Decision

Move each direct prisma call into the appropriate use-case or repository port.

---

## Implementation Steps

1. Audit each `this.prisma.*` call in `storefront.controller.ts`.
2. For each, create or extend a use-case in `application/use-cases/`.
3. Move prisma call to use-case or repository port.
4. Tests per use-case.

**Acceptance:** `grep "this.prisma" storefront.controller.ts` returns 0 matches.

---

## Files Touched

- `apps/api/src/modules/storefront/presentation/http/storefront.controller.ts` (slim down)
- ~10-15 new/extended use-cases
- Tests
