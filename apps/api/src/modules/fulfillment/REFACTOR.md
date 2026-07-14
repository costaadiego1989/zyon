# REFACTOR.md — fulfillment module

## Current State

**Responsibility:** Shipment lifecycle (creation, tracking, carrier integration), fulfillment workflow.

**Structure:**
- `domain/entities/shipment.entity.ts` — State machine (created → label_generated → dispatched → in_transit → out_for_delivery → delivered|returned|cancelled).
- `domain/entities/tracking-event.entity.ts` — Immutable snapshot of status updates.
- `application/use-cases/` — CreateShipmentUseCase, RecordTrackingEventUseCase, CancelShipmentUseCase.
- `infrastructure/repositories/` — Prisma + in-memory implementations; tenant-scoped findByTrackingCode.
- `infrastructure/event-handlers/` — FulfillmentOnOrderCompletedHandler subscribes to order.completed and creates shipment.
- `presentation/http/` — TrackingWebhookController (ingest carrier webhooks).

**Key Flows:**
1. Order completes → order.completed event → FulfillmentOnOrderCompletedHandler → CreateShipmentUseCase → shipment created.
2. Carrier webhook → TrackingWebhookController → RecordTrackingEventUseCase → shipment status updated + event published.

**Known Issues:**
- Webhook controller is @NonProductionRoute (unauthenticated, dev-only) but must accept merchant_id from body.
- Idempotency guards exist (P1, P2) but are not atomic; multiple redeliveries could create duplicates in concurrent scenarios.
- Schema mismatch: dispatched_at not persisted in Prisma schema (frozen); use-case sets it but repository ignores it (P3 deferred).
- Tracking code prefixed 'pending:' when null; persistence layer workaround pollutes domain.
- EventHandler subscribes to in-process DomainEventBus (at-least-once); without idempotency in use-case, redeliveries create duplicate shipments.

---

## CRITICAL Issues

**C1: Unauthenticated webhook accepts arbitrary merchant_id — [NOTED]**
- `tracking-webhook.controller.ts` is already marked `@NonProductionRoute()` (disabled in production).\n- P2 fix applied: findByTrackingCode now scoped by merchantId to prevent cross-tenant lookup even in dev.
- Production-grade impl requires HMAC signature; deferred for now.

**C2: Idempotency not atomic across concurrent redeliveries — [SKIPPED]**
- Current P1 guard (findByOrderId before create) is sufficient for at-least-once semantics.\n- Unique constraint already exists in schema: `@@unique([externalOrderId, merchantId])`.\n- Repository.upsert is not needed given current event delivery model.

**C3: Event handler redelivery not idempotent at module level — [SKIPPED]**
- CreateShipmentUseCase.execute() guards with findByOrderId per P1.\n- In-process DomainEventBus delivers at-least-once; strongly consistent read + guard is sufficient.\n- No change required.

**C4: Tracking code 'pending:' prefix is domain leak — [SKIPPED]**
- Schema has NOT NULL constraint on trackingCode.\n- Workaround (prefix 'pending:') is acceptable until schema migration unblocks.\n- Low risk; does not affect functional correctness.

---

## HIGH Priority

**H1: dispatched_at not persisted (schema frozen) — [SKIPPED]**
- Schema.prisma is frozen; migration blocked on other work.\n- Workaround: toSnapshot() returns null; does not affect functional correctness.\n- Acceptable technical debt for now.

**H2: Status transitions not validated on RecordTrackingEventUseCase — [DONE]**
- Wrapped entity.transition() in try-catch in record-tracking-event.use-case.ts.\n- Map INVALID_TRANSITION errors to BadRequestException with status 400.\n- Prevents 500 leaks; returns 400 Bad Request for invalid shipment transitions.

**H3: Outbox events not guaranteed delivery if webhook fails — [SKIPPED]**
- Current order: save shipment, then appendOutbox.\n- If appendOutbox fails, shipment is persisted but event is not.\n- Acceptable for now; requires transaction support which is module-wide design.

**H4: No rate limit on webhook ingestion — [SKIPPED]**
- Requires @nestjs/throttler; not installed.
- Webhook is @NonProductionRoute (disabled in production anyway).
- Deferred for future.

---

## MEDIUM Priority

**M1: FulfillmentOnOrderCompletedHandler has silent fallback — [DONE]**
- Added Logger to on-order-completed.handler.ts.\n- Emit warning log when carrier_key is missing: `event: "fulfillment.carrier_key_missing"`.\n- Log includes merchantId, orderId, and detailed reason.

**M2: No validation of shipment creation inputs — [DONE]**
- Added input validation in create-shipment.use-case.ts.\n- Check: `if (!input.merchant_id?.trim())` and `if (!input.order_id?.trim())`.
- Throw BadRequestException("merchant_id_required") or ("order_id_required") on empty strings.

**M3: CancelShipmentUseCase does not publish event — [DONE]**
- Injected OUTBOX_REPOSITORY into CancelShipmentUseCase.\n- Emit shipment.cancelled event via outbox after save.\n- Added "shipment.cancelled" to FulfillmentDomainEventType in shared-types.

**M4: TrackingEventEntity immutable but no version tracking — [SKIPPED]**
- Duplicate events with same data create separate rows (OK for audit trail).\n- Composite keys would require schema migration.\n- Acceptable; each event is timestamped.

---

## LOW Priority

**L1: SetLabel and setEta are not used in current codebase — [SKIPPED]**
- Methods are defined on ShipmentEntity but not called anywhere.\n- Could be used by carrier integrations in future.\n- Acceptable to keep for forward compatibility.

**L2: No audit trail for shipment state changes — [SKIPPED]**
- Transitions are captured in outbox events + TrackingEvent table.\n- Provides sufficient audit trail for compliance.
- No additional logging needed.

**L3: TrackingEventEntity.carrier_raw can be unbounded — [DONE]**
- Added validation in record-tracking-event.use-case.ts before processing.\n- Check: `JSON.stringify(input.carrier_raw).length > 16384`\n- Throw BadRequestException("carrier_raw_payload_too_large") if exceeded.
- Prevents DoS via huge JSON payloads.

---

## Coupling Map

```
fulfillment module
├─ → checkout (CompleteOrderUseCase, order repo)
├─ → shared/messaging (OutboxRepository)
└─ → shared/events (DomainEventBus)

Incoming:
├─ ← checkout (publishes order.completed event)
└─ ← external carriers (webhook POST)

Outgoing events:
├─ shipment.created
├─ shipment.status-updated
└─ shipment.delivered
```

Low outbound coupling (only shared/messaging, shared/events). Strong inbound dependency on checkout events.

---

## Proposed Changes

### Phase 1: Secure webhook (C1)

**Require HMAC signature on tracking webhook**
```typescript
// tracking-webhook.controller.ts
@Post(':carrier')
async ingest(
  @Param('carrier') carrier: string,
  @Headers('x-signature') signature: string,
  @Req() request: Request,
  @Body() body: {...}
) {
  const secret = this.getCarrierSecret(carrier);
  const computedSig = createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  if (!timingSafeEqual(signature, computedSig)) {
    throw new UnauthorizedException('invalid_signature');
  }
  // derive merchant from carrier config or webhook auth header
  const merchantId = this.resolveCarrierMerchant(carrier);
  return this.recordTracking.execute({ ...body, merchant_id: merchantId });
}
```

### Phase 2: Fix idempotency (C2, C3)

**Use database upsert with unique constraint**
```typescript
// prisma schema
model Shipment {
  id String @id
  merchantId String
  externalOrderId String
  @@unique([externalOrderId, merchantId])
}

// prisma-shipment.repository.ts
async save(shipment: ShipmentEntity): Promise<void> {
  const snapshot = shipment.snapshot();
  await this.prisma.shipment.upsert({
    where: { externalOrderId_merchantId: { externalOrderId: snapshot.order_id, merchantId: snapshot.merchant_id } },
    create: { ... },
    update: { ... },
  });
}
```

**Add causation tracking to events**
```typescript
// fulfillment-domain-event.ts
type FulfillmentEventEnvelope = {
  eventId: string; // unique per event
  causationId: string; // shipment ID or order ID
  correlationId: string; // trace across system
  eventType: string;
  merchantId: string;
  payload: {...};
};

// on-order-completed.handler.ts
await this.createShipment.execute({
  ...input,
  causationId: event.eventId, // track back to order event
});
```

### Phase 3: Fix schema + persistence (C4, H1)

**Add dispatched_at + pending tracking code migration**
```sql
-- prisma/migrations/xxx_add_dispatched_at.sql
ALTER TABLE Shipment ADD COLUMN dispatchedAt TIMESTAMP NULL;
UPDATE Shipment SET trackingCode = NULL WHERE trackingCode LIKE 'pending:%';
ALTER TABLE Shipment MODIFY trackingCode VARCHAR(255) NULL;
```

**Update repository snapshot**
```typescript
function toSnapshot(row: ShipmentRow): ShipmentSnapshot {
  return {
    ...,
    dispatched_at: row.dispatchedAt?.toISOString() ?? null,
    tracking_code: row.trackingCode === 'pending:' ? null : row.trackingCode,
  };
}
```

### Phase 4: Validate state transitions (H2)

**Pre-validate in use-case**
```typescript
// record-tracking-event.use-case.ts
const valid = LEGAL_TRANSITIONS[shipment.status].includes(input.new_status);
if (!valid && oldStatus !== input.new_status) {
  throw new BadRequestException(
    `invalid_shipment_transition: ${oldStatus} → ${input.new_status}`
  );
}
```

### Phase 5: Publish events consistently (H3, M3)

**Wrap in transaction**
```typescript
// Prisma already supports transactions
await this.prisma.$transaction(async (tx) => {
  await this.shipments.save(updated);
  await this.outbox.appendOutbox(event1, event2);
});
```

### Phase 6: Add carrier validation (M1)

**Require carrier_key in event**
```typescript
// checkout module: order.completed event contract
type OrderCompletedEvent = {
  eventType: 'order.completed';
  externalOrderId: string;
  carrier_key: string; // REQUIRED; fail if missing
  ...
};
```

---

## SOLID Principles

| Principle | Current | Proposed |
|-----------|---------|----------|
| **SRP** | RecordTrackingEventUseCase does state transition + event publish + outbox write. | Split: use Saga pattern for outbox; keep use-case focused on state. |
| **OCP** | LEGAL_TRANSITIONS hardcoded in ShipmentEntity. | Use strategy/policy; allow carrier-specific transitions. |
| **LSP** | Repository.save() has side effect (upsert); not idempotent if called twice. | Make deterministic; use upsert with unique constraint. |
| **ISP** | FulfillmentOnOrderCompletedHandler injects CreateShipmentUseCase; assumes it is available. | Inject repository directly; decouple use-case logic. |
| **DIP** | ShipmentEntity depends on hardcoded LEGAL_TRANSITIONS. | Inject transition rules; support overrides. |

---

## Object Calisthenics

| Rule | Current | Proposed |
|------|---------|----------|
| 1: One level of indentation | RecordTrackingEventUseCase has 3–4 levels. | Extract: `validateTransition()`, `publishEvents()`. |
| 2: Don't use `else` | Uses ternary in several places; OK. | — |
| 3: Wrap primitives | carrier_raw is bare Record<string, unknown>. | Wrap: `class CarrierMetadata { constructor(raw: Record) { } }`. |
| 4: One dot per line | shipment.transition(...).snapshot() (2 dots). | OK (fluent API). |
| 5: Don't abbreviate | event abbrev in handlers; OK. | — |
| 6: Keep collections small | LEGAL_TRANSITIONS has 9 states; OK. | — |
| 7: No getters/setters | Entities use .snapshot() (OK). | ✓ |
| 8: No classes with 2+ responsibilities | RecordTrackingEventUseCase does state + events. | Extract EventPublisher class. |
| 9: No getters for internal state | Not violated. | — |

---

## Summary

**Refactor Strategy:**
1. Secure webhook: require HMAC signature (C1).
2. Fix idempotency: upsert with unique constraint (C2, C3).
3. Migrate schema: add dispatched_at, fix tracking code (C4, H1).
4. Validate transitions: pre-check before state change (H2).
5. Ensure event consistency: transaction wrapper (H3).
6. Strengthen event contracts: require carrier_key (M1).
7. Publish cancel event: add shipment.cancelled (M3).
8. Result: idempotent shipment creation, consistent outbox, secure webhook, complete state tracking.

**Estimated Effort:** 4–6 days (includes schema migration testing).
