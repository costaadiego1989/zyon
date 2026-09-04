# ADR-019 — Coupons: atomic redemption + idempotency

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `coupons`
**Issue:** P0-008

---

## Context

`apps/api/src/modules/coupons/application/use-cases/redeem-coupon.use-case.ts` does:

1. `redemptions.save(redeemed)` (write redemption row)
2. `coupons.findById` (read)
3. `coupons.save(coupon.incrementUsage())` (write back)

**Two concurrency bugs:**

a. `incrementUsage` is a JS-side `usages_count + 1` written back to DB. Two concurrent `order.completed` for same session both read same base value → both write `base+1` → cap (`maxUsages`) bypassable.

b. No `@@unique([couponId, orderId])` on `CouponRedemption`. Same `orderId` can be redeemed twice via different sessions or via event-bus replay.

`ApplyCouponUseCase` has the same `findById → count → insert` race for the `maxUsages` cap.

---

## Decision

1. Move increment into SQL: `prisma.coupon.update({ where: {id}, data: {usagesCount: {increment: 1}}, ... }).` Reject when `usagesCount >= maxUsages`.
2. Wrap `redemption.save` + `coupon.increment` in `$transaction` (use `saveWithOutbox`).
3. Add `@@unique([couponId, orderId])` to `CouponRedemption` via migration.
4. `ApplyCouponUseCase` limit check → atomic via DB constraint.

---

## Implementation Steps

### 1. Migration

```prisma
model CouponRedemption {
  @@unique([couponId, orderId])
}
```

### 2. Repository atomic increment

```typescript
async tryIncrementUsage(merchantId, couponId): Promise<boolean> {
  // atomic decrement-then-check via where-clause
  const updated = await this.prisma.coupon.updateMany({
    where: { id: couponId, merchantId, usagesCount: { lt: { maxUsages } } },  // Prisma doesn't support field-field compare; use raw
  });
  // OR raw SQL:
  // UPDATE coupon SET usages_count = usages_count + 1
  //   WHERE id = $1 AND merchant_id = $2 AND usages_count < max_usages
  //   RETURNING usages_count
}
```

### 3. Wrap redemption in `$transaction`

`saveWithOutbox` pattern: redemption insert + coupon increment + outbox emit in single tx.

### 4. Apply path

Limit check moves to DB-level `WHERE usages_count < max_usages`. P2002 → already applied. P2025 → cap reached.

---

## Verification

```bash
pnpm test coupons -- --testPathPattern redeem-race
# Property test: N concurrent applies at cap-1 → exactly one succeeds
pnpm test:prisma coupons-concurrent-redeem
```

---

## Files Touched

- `apps/api/prisma/schema.prisma` (unique constraint)
- `apps/api/src/modules/coupons/infrastructure/repositories/prisma-coupon.repository.ts`
- `apps/api/src/modules/coupons/application/use-cases/redeem-coupon.use-case.ts`
- `apps/api/src/modules/coupons/application/use-cases/apply-coupon.use-case.ts`
- Tests
