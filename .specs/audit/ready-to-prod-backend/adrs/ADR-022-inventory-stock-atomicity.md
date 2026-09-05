# ADR-022 — Inventory stock decrement is atomic and replay-safe

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `inventory`
**Issue:** P0-011

---

## Context

`apps/api/src/modules/inventory/infrastructure/repositories/prisma-inventory.repository.ts:155` `adjustQuantity` does:

1. `findFirst` (read snapshot)
2. `update({ quantity: { increment: delta } })` (no guard)

**No `WHERE quantity >= delta` guard.** Concurrent decrement → negative stock. Same pattern in `adjustReserved:187` — no guard against `reserved > quantity`.

`on-sale-completed.handler.ts` is the entrypoint for `order.completed` events. No `$transaction` wrapping movement+adjustQuantity+catalog decrement. Replay duplicates movement row + double decrement.

---

## Decision

Use `WHERE quantity >= delta` (and `reserved <= quantity - delta` for reserved adjustments). Atomic decrement via DB constraint.

Movement table: add `@@unique([itemId, externalRef])` to prevent duplicate exits on replay.

Wrap `recordMovement + adjustQuantity + decrementCatalogStock` in `$transaction`.

---

## Implementation Steps

### 1. Migration

```prisma
model InventoryMovement {
  @@unique([itemId, externalRef])
  @@index([itemId, occurredAt])
}
```

### 2. Atomic decrement

```typescript
async tryDecrement(merchantId, itemId, delta): Promise<boolean> {
  // raw SQL: UPDATE inventory_item SET quantity = quantity - $delta
  //   WHERE id = $1 AND merchant_id = $2 AND quantity >= $delta
  //   RETURNING quantity
  const result = await this.prisma.$queryRaw<{quantity: number}[]>`
    UPDATE inventory_item SET quantity = quantity - ${delta}
    WHERE id = ${itemId} AND merchant_id = ${merchantId} AND quantity >= ${delta}
    RETURNING quantity
  `;
  return result.length === 1;
}
```

### 3. Wrap handler in `$transaction`

```typescript
async handle(orderCompleted) {
  return this.prisma.$transaction(async (tx) => {
    await tx.inventoryMovement.create(...);
    await tx.inventoryItem.update({...}, { quantity: { decrement: qty } });
    await tx.productStock.update({...}, { quantity: { decrement: qty } });
  });
}
```

### 4. Alert creation also in tx

`existsOpen` + `create` for low_stock alert.

---

## Verification

```bash
pnpm test inventory -- --testPathPattern atomic-decrement
# Property test: N concurrent sales at stock=1 → exactly one succeeds
pnpm test:prisma inventory-oversell-prevention
```

---

## Files Touched

- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/inventory/infrastructure/repositories/prisma-inventory.repository.ts`
- `apps/api/src/modules/inventory/infrastructure/event-handlers/on-sale-completed.handler.ts`
- `apps/api/src/modules/inventory/application/use-cases/handle-sale-completed.use-case.ts`
- Tests
