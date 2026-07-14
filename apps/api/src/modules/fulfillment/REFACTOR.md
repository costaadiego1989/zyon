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

**C1: Unauthenticated webhook accepts arbitrary merchant_id**
- `tracking-webhook.controller.ts:38–44`: Body includes merchant_id, not derived from auth. @NonProductionRoute marks it dev-only, but if accidentally enabled in production, attacker can ingest tracking updates for any merchant. Fix: require HMAC signature or rotate API key per carrier; derive merchant from header token.

**C2: Idempotency not atomic across concurrent redeliveries**
- `create-shipment.use-case.ts:19-21`: Lookup existing shipment, then create if null. Between lookup and insert, concurrent request may insert a second shipment. Repository.save() does not enforce unique constraint on (order_id, merchant_id). Fix: use database upsert or unique constraint in schema; make save() atomic.

**C3: Event handler redelivery not idempotent at module level**
- `on-order-completed.handler.ts`: Subscribes to order.completed event (at-least-once). If event is redelivered, handler calls CreateShipmentUseCase twice. UseCase guards via findByOrderId, but if that query misses the first shipment due to replication lag, second invocation creates duplicate. Fix: ensure repository queries are strongly consistent; add causation ID tracking.

**C4: Tracking code 'pending:' prefix is domain leak**
- `prisma-shipment.repository.ts:96–98`: Shipment entity uses null tracking_code, but schema column is NOT NULL. Repository works around this by prefixing 'pending:'. This pollutes the domain model and breaks queries for real tracking codes starting with 'pending'. Fix: add nullable column or separate pending_status flag.

---

## HIGH Priority

**H1: dispatched_at not persisted (schema frozen)**
- `prisma-shipment.repository.ts:101`: toSnapshot() explicitly returns `dispatched_at: null` with comment "P3 deferred". ShipmentEntity.transition('dispatched') sets dispatched_at, but it is lost on rehydration. Fix: unblock schema migration; add dispatched_at column and populate it on next release.

**H2: Status transitions not validated on RecordTrackingEventUseCase**
- `record-tracking-event.use-case.ts:35–40`: Idempotency check for same status, but if webhook sends invalid status (e.g., in_transit → created), entity.transition() throws INVALID_TRANSITION. Caller (webhook controller) does not handle this; 500 error leaks domain error. Fix: pre-validate status in use-case; return 400 Bad Request for invalid transitions.

**H3: Outbox events not guaranteed delivery if webhook fails**
- `record-tracking-event.use-case.ts:53–77`: If outbox.appendOutbox() fails after shipment.save(), shipment is persisted but event is not. Downstream systems (notifications, analytics) miss the update. Fix: wrap both in transaction or use saga pattern for outbox consistency.

**H4: No rate limit on webhook ingestion**
- Webhook can be flooded with updates for the same tracking code. No throttle or batch size limit. Fix: implement per-merchant/per-tracking-code rate limit (e.g., 10 updates/minute).

---

## MEDIUM Priority

**M1: FulfillmentOnOrderCompletedHandler has silent fallback**
- `on-order-completed.handler.ts:28–31`: If carrier_key is missing from event, defaults to "flat-rate". No warning logged. Incorrect shipments may be created for orders without a selected carrier. Fix: log warning and publish an event if carrier is unknown; require carrier in order.completed event contract.

**M2: No validation of shipment creation inputs**
- `create-shipment.use-case.ts:14`: order_id and merchant_id are not validated (null check only in handler). Invalid UUIDs or truncated IDs silently persist. Fix: add input validation; throw 400 Bad Request for malformed IDs.

**M3: CancelShipmentUseCase does not publish event**
- `cancel-shipment.use-case.ts` saves cancelled shipment but does not publish outbox event. Downstream systems (payments, notifications) do not know shipment is cancelled. Fix: publish shipment.cancelled event; add to outbox.

**M4: TrackingEventEntity immutable but no version tracking**
- Tracking events are immutable, but if the same event is recorded twice (e.g., duplicate webhook), two identical TrackingEventEntity rows exist with different IDs. No deduplication. Fix: include webhook provider + timestamp as composite key; deduplicate on insert.

---

## LOW Priority

**L1: SetLabel and setEta are not used in current codebase**
- `shipment.entity.ts:79–90`: setLabel() and setEta() are defined but never called. Dead code or incomplete feature. Fix: remove or wire carrier integration to call them.

**L2: No audit trail for shipment state changes**
- Shipment transitions are not logged. If a shipment is cancelled incorrectly, there is no record of who/what triggered it. Fix: emit audit event for each transition.

**L3: TrackingEventEntity.carrier_raw can be unbounded**
- `record-tracking-event.use-case.ts:23`: carrier_raw is a generic Record<string, unknown>. Attacker can submit huge JSON payloads. Fix: validate max size and schema for carrier_raw.

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
