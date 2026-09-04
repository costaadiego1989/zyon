# ADR-027 — Checkout complete-order becomes transactional outbox

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `checkout`
**Issue:** P0-016

---

## Context

`complete-order.use-case.ts:175-177`:

```typescript
if (txRunner?.transaction) {
  await txRunner.transaction(commit);  // wraps saveCompletedOrder + recordEvent + appendOutbox
} else {
  await commit(fallbackRepo);  // NO $transaction — 3 separate writes
}
```

`txRunner` is OPTIONAL. If not wired, fallback runs 3 separate repo calls outside any transaction. Crash leaves partial state (order written, no event, no outbox).

Order atomicity is **distributed via outbox** — inventory decrement, payment reconciliation, and tracking creation depend on downstream event handlers. No single `$transaction` covers the entire chain. Failure modes:

1. complete-order commits order but outbox relay dies → no tracking, no notifications
2. complete-order commits but inventory listener fails → oversell
3. complete-order commits but payment recon fails later → orphan order, no payment

---

## Decision

1. Remove `txRunner?.transaction` optional. Always use `outbox.saveWithOutbox`.
2. Make complete-order idempotent on `externalOrderId` via existing `@@unique([merchantId, sessionId, externalOrderId])`.
3. Document compensating actions for cross-module failures (reconcile worker, retry policies).

---

## Implementation Steps

### 1. Refactor commit closure

```typescript
async execute(input) {
  return this.outbox.saveWithOutbox(async (tx) => {
    const order = await tx.orderRepository.save(completedOrder);
    await tx.sessionRepository.recordEvent(merchantId, sessionId, orderCompletedEvent);
    await tx.outbox.appendOutbox({ type: 'order.completed', ... });
    return order;
  });
}
```

### 2. Confirm fallback path is unreachable

Remove `txRunner?.transaction` conditional. Single path only.

### 3. Reconcile worker

Already exists (`reconcile-payment-intents.use-case.ts`). Keep as safety net.

---

## Verification

```bash
pnpm test checkout -- --testPathPattern complete-order-atomic
# Test: crash mid-write → idempotent retry returns same order
pnpm test:prisma checkout-complete-idempotent
```

---

## Files Touched

- `apps/api/src/modules/checkout/application/use-cases/complete-order.use-case.ts`
- `apps/api/src/modules/checkout/application/use-cases/checkout-transaction.ts`
- Tests
