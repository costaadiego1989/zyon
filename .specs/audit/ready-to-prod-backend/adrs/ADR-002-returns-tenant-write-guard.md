# ADR-002 — Returns write paths require merchant_id

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `returns`
**Issue:** P0-002
**Date:** 2026-09-04

---

## Context

`apps/api/src/modules/returns/infrastructure/repositories/prisma-return.repository.ts` write methods (`updateStatus`, `saveLabel`, `saveInspection`, `saveRefund`) filter `where: { id }` only. Reads filter by `merchantId`. This means a merchant who guesses/leaks another tenant's `returnId` can mutate that return's state across tenants.

Reads: tenant-safe. Writes: tenant-unsafe.

This is a real cross-tenant write primitive — confirmed by reading `prisma-return.repository.ts` lines 75-150.

---

## Decision

All write methods must accept `merchantId` and include it in the WHERE clause. Add regression test that seeds two merchants and verifies cross-tenant write throws.

No backfill needed (no state drift; this is a forward-only fix).

---

## Implementation Steps

### 1. Repository signature changes

**File:** `apps/api/src/modules/returns/infrastructure/repositories/prisma-return.repository.ts`

```typescript
// Before
async updateStatus(id: string, status: ReturnStatus): Promise<Return | null>
async saveLabel(returnId: string, label: ReturnLabel): Promise<void>
async saveInspection(returnId: string, inspection: ReturnInspection): Promise<void>
async saveRefund(returnId: string, refund: ReturnRefund): Promise<void>

// After
async updateStatus(merchantId: string, id: string, status: ReturnStatus): Promise<Return | null>
async saveLabel(merchantId: string, returnId: string, label: ReturnLabel): Promise<void>
async saveInspection(merchantId: string, returnId: string, inspection: ReturnInspection): Promise<void>
async saveRefund(merchantId: string, returnId: string, refund: ReturnRefund): Promise<void>
```

Where clauses:
```typescript
// updateStatus
return this.prisma.return.updateMany({
  where: { id, merchantId },  // was: { id }
  data: { status, ... }
});
```

### 2. Use-case call sites update

Files:
- `apps/api/src/modules/returns/application/use-cases/generate-return-label.use-case.ts:33`
- `apps/api/src/modules/returns/application/use-cases/mark-return-received.use-case.ts:19`
- `apps/api/src/modules/returns/application/use-cases/inspect-return.use-case.ts:30`
- `apps/api/src/modules/returns/application/use-cases/process-refund.use-case.ts:24`
- `apps/api/src/modules/returns/application/use-cases/restock-inventory.use-case.ts`
- `apps/api/src/modules/returns/application/use-cases/cancel-return.use-case.ts:15`
- `apps/api/src/modules/returns/application/use-cases/accept-marketplace-return.use-case.ts:50`

All have `merchantId` already in their input. Just thread it to the repo.

### 3. Port interface update

**File:** `apps/api/src/modules/returns/domain/ports/return-repository.port.ts`

Add `merchantId` to the signature on each write method.

### 4. Cross-tenant regression test

**File:** `apps/api/src/modules/returns/__tests__/prisma-return.cross-tenant.spec.ts` (new)

```typescript
it('rejects cross-tenant write on updateStatus', async () => {
  const merchantA = await seedMerchant('A');
  const merchantB = await seedMerchant('B');
  const retA = await seedReturn(merchantA);

  await expect(
    repo.updateStatus(merchantB.id, retA.id, 'CANCELLED')
  ).rejects.toThrow();

  const fresh = await repo.findById(merchantA.id, retA.id);
  expect(fresh.status).not.toBe('CANCELLED');
});
```

---

## Verification

```bash
pnpm --filter @zyon/api test returns
pnpm --filter @zyon/api test:prisma returns-cross-tenant
cd apps/api && pnpm typecheck
```

---

## Files Touched

- `apps/api/src/modules/returns/infrastructure/repositories/prisma-return.repository.ts`
- `apps/api/src/modules/returns/domain/ports/return-repository.port.ts`
- 7 use-cases (call sites)
- `apps/api/src/modules/returns/__tests__/prisma-return.cross-tenant.spec.ts` (new)
