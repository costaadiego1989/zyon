# ADR-023 — Fulfillment tracking event atomicity + replay dedup

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `fulfillment`
**Issue:** P0-012

---

## Context

`apps/api/src/modules/fulfillment/application/use-cases/record-tracking-event.use-case.ts` does 3 sequential writes:

1. `shipments.save(updated)` (line 68)
2. `trackingEvents.save()` (line 80)
3. `outbox.appendOutbox()` (line 83)

**No `$transaction`.** Crash between 1 and 3 → status updated, no event published. Replay → duplicate tracking event rows (idempotency only on status change, not on event persistence).

---

## Decision

1. Wrap `shipment.save + trackingEvent.save + outbox.appendOutbox` in `$transaction` (`saveWithOutbox`).
2. Add `@@unique([shipmentId, occurredAt])` on `trackingEvent` for replay dedup.
3. Replay returns existing tracking event instead of inserting.

---

## Implementation Steps

### 1. Migration

```prisma
model TrackingEvent {
  @@unique([shipmentId, occurredAt])
}
```

### 2. Repository — `tryRecord` with P2002

```typescript
async tryRecord(merchantId, shipmentId, occurredAt, payload): Promise<TrackingEvent | null> {
  try {
    return await this.prisma.trackingEvent.create({
      data: { merchantId, shipmentId, occurredAt, payload, ... }
    });
  } catch (err) {
    if (err.code === 'P2002') return null;  // already recorded
    throw err;
  }
}
```

### 3. Use-case — single transaction

```typescript
async execute(...) {
  return this.outbox.saveWithOutbox(async (tx) => {
    const shipment = await tx.shipment.findUnique({...});
    const event = shipment.applyTransition(newStatus);
    await tx.shipment.update({ where: { id }, data: { status: event.status } });
    const tracked = await tx.trackingEvent.tryRecord(...);
    return { shipment, tracked };
  });
}
```

---

## Verification

```bash
pnpm test fulfillment -- --testPathPattern tracking-replay
# Property test: N concurrent carrier webhooks → exactly one transition + one event
pnpm test:prisma fulfillment-concurrent-webhook
```

---

## Files Touched

- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/fulfillment/infrastructure/repositories/prisma-tracking-event.repository.ts`
- `apps/api/src/modules/fulfillment/application/use-cases/record-tracking-event.use-case.ts`
- Tests
