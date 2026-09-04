# ADR-026 — Payment intent creation is atomic across provider + DB

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `payment`
**Issue:** P0-015

---

## Context

`create-payment-intent.use-case.ts:162-310`:

1. `getByIdempotency(merchantId, sessionId, key)` returns `null` if no existing intent
2. Call provider `createPayment({ providerIdempotencyKey })` (external HTTP)
3. `prisma.paymentIntent.upsert({ where: { merchantId_sessionId_idempotencyKey }})`

**Race window:** T1 reads null at step 1. T2 reads null at step 1. Both call provider. Both create provider charges. Step 3 unique constraint blocks one DB row but BOTH provider charges exist. Double-charge.

`PaymentDispatchService.markApprovedAndComplete` is 3 sequential awaits (`saveIntent + checkoutPayment.completeAfterApproval + markLinkedCommerceOrderPaid`) without `$transaction` — crash leaves approved intent with no order completion.

---

## Decision

Reserve intent row BEFORE provider call. Update with provider paymentId AFTER. Wrap dispatch chain in `$transaction`.

---

## Implementation Steps

### 1. Reserve-before-call pattern

```typescript
async execute(merchantId, sessionId, idempotencyKey, ...) {
  // Step 1: Try to insert pending intent. P2002 = already exists, return idempotent.
  try {
    await this.prisma.paymentIntent.create({
      data: { merchantId, sessionId, idempotencyKey, status: 'PENDING', amountCents }
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const existing = await this.prisma.paymentIntent.findUnique({...});
      return { intent: existing, idempotent: true };
    }
    throw err;
  }
  // Step 2: provider call (after row exists)
  const providerCharge = await this.provider.createPayment({...});
  // Step 3: update with provider ID
  return this.prisma.paymentIntent.update({
    where: { merchantId_sessionId_idempotencyKey },
    data: { providerPaymentId: providerCharge.id, status: 'CREATED' }
  });
}
```

### 2. Wrap PaymentDispatchService

```typescript
async markApprovedAndComplete(intentId) {
  return this.outbox.saveWithOutbox(async (tx) => {
    await tx.paymentIntent.update({ where: { id: intentId }, data: { status: 'APPROVED' } });
    await tx.completedOrder.update(...);
    await tx.commerceOrderPaid.markLinked(...);
  });
}
```

### 3. Reconcile worker remains as eventual safety net

---

## Verification

```bash
pnpm test payment -- --testPathPattern intent-race
# Property test: N concurrent creates with same idempotencyKey → exactly 1 provider charge
pnpm test:prisma payment-concurrent-intent
```

---

## Files Touched

- `apps/api/src/modules/payment/application/create-payment-intent.use-case.ts`
- `apps/api/src/modules/payment/application/services/payment-dispatch.service.ts`
- `apps/api/src/modules/payment/infrastructure/prisma-payment.repository.ts`
- Tests
