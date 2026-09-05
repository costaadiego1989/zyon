# ADR-006 — Revenue-manager keeps Decimal in financial math

**Status:** PROPOSED (P1)
**Module:** `revenue-manager`
**Issue:** P1-001

---

## Context

`apps/api/src/modules/revenue-manager/infrastructure/jobs/daily-observation.job.ts:268-270` coerces Prisma `Decimal` to JS `Number` for `maxDiscountPercent` and `minimumMarginPercent`. Silent precision loss in financial rule thresholds.

The discount engine correctly uses integer cents — only the threshold comparison crosses the boundary.

---

## Decision

Keep math in `Decimal` end-to-end. Use `Decimal.compare` instead of `>` / `>=`. Never assign `.toNumber()` until final serialization to a computed metric (which itself doesn't cross thresholds).

---

## Implementation Steps

1. Import `Decimal` from `decimal.js` (or use Prisma's `Prisma.Decimal`).
2. Replace `.toNumber()` coercion with `new Decimal(value)`.
3. Compare thresholds via `Decimal.lt()`, `Decimal.gte()`.
4. Coverage: add unit test with edge values (e.g. 33.333... %).

---

## Files Touched

- `apps/api/src/modules/revenue-manager/infrastructure/jobs/daily-observation.job.ts`
- `apps/api/src/modules/revenue-manager/domain/services/discount-rule-hypothesis.service.ts`
- Tests
