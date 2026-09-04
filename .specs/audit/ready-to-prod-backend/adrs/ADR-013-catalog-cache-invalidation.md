# ADR-013 — Catalog cache invalidation on every product mutation

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `catalog`
**Issue:** P0-006

---

## Context

`apps/api/src/modules/catalog/infrastructure/cache/catalog-cache.service.ts` exposes `invalidateMerchant` (SCAN + DEL across 3 patterns). No use-case calls it. Up to 5min stale price/stock.

---

## Decision

After every product/category write, call `cache.invalidateMerchant(merchantId)` or `invalidateProduct(merchantId, productId)` (targeted cheap; broad on category/import).

---

## Implementation Steps

### 1. Add invalidation calls in use-cases

- `add-product.use-case.ts` → `cache.invalidateMerchant(merchantId)`
- `update-product.use-case.ts` → same
- `delete-product.use-case.ts` → same
- `update-product-stock.use-case.ts` → `cache.invalidateProduct(merchantId, productId)`
- category use-cases (3) → `invalidateMerchant`
- `process-spreadsheet-import.use-case.ts` → `invalidateMerchant` once at end

### 2. Inject cache into use-cases

Use-cases receive `CATALOG_CACHE_SERVICE`. Wired in `catalog.module.ts`.

### 3. Audit log every invalidation

### 4. Tests

- Edit product price → cache key gone within 100ms.
- Import spreadsheet → `search:*` and `categories:*` removed.

---

## Verification

```bash
pnpm test catalog -- --testPathPattern cache-invalidation
pnpm test:prisma catalog-cache-mutation
```

---

## Files Touched

- 6 product use-cases + spreadsheet import
- `catalog.module.ts`
- Test
