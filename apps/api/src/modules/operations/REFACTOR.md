# REFACTOR.md — operations module

## Current State

**Responsibility:** Dashboard read model (orders, customers, payments), order operations (cancel, create from payment).

**Structure:**
- `domain/ports/operations-read.repository.port.ts` — Query interfaces: listOrders, getOrder, listCustomers, getCustomer, listPayments, getPayment.
- `application/operations-read.use-cases.ts` — Read-only use-cases: List* and Get* with pagination helpers.
- `application/order-command.use-cases.ts` — CancelOrderUseCase (P1: commit local first), CreateOrderFromPaymentUseCase.
- `presentation/http/operations.controller.ts` — OrdersController, CustomersController, PaymentsController (all tenant-scoped via TenantCredentialGuard + TenantAccessGuard).
- `infrastructure/prisma-operations-read.repository.ts` — Denormalized read model.

**Key Flows:**
1. Merchant dashboard → GET /orders → ListOrdersUseCase → repository.listOrders() → paginated results.
2. Merchant cancels order → POST /orders/:orderId/cancel → CancelOrderUseCase → update local record FIRST → call commerce provider (Shopify) → publish webhook.
3. Merchant creates order from payment → POST /orders (payment_id) → CreateOrderFromPaymentUseCase → CompleteOrderUseCase (checkout) → order recorded.

**Known Issues:**
- Heavy imports: checkout, commerce, integrations (7–8 module dependencies).
- Order read model is denormalized from checkout (orders table), commerce (external orders), payments. Schema drift risk.
- CancelOrderUseCase commits local first (resilience strategy), but if provider call fails, console shows "updated" but provider is not aware.
- Pagination cursor is opaque base64(JSON), not validated before decode. Malformed cursors cause 400 Bad Request, but error message is generic.
- OrdersController depends on UpdateTenantOrderTrackingUseCase from integrations (tight coupling).
- No idempotency guard in CancelOrderUseCase; concurrent cancellations may attempt twice.

---

## CRITICAL Issues

**C1: Read model denormalization risks stale data**
- `operations-read.repository` queries denormalized tables built from events. If event processing lags, dashboard shows stale state. No eventual-consistency marker or TTL hint. Merchant sees "order pending" even though it shipped. Fix: add version/timestamp field to read model; surface staleness indicator to UI.

**C2: CancelOrderUseCase commits local without idempotency guard**
- `order-command.use-cases.ts:54–61`: Updates local record to cancelled. If concurrent cancellation request arrives, both enter this block. Repository.cancelCompletedOrder() may fail on second attempt (already cancelled). Fix: make operation idempotent; check if already cancelled and return cached result.

**C3: Provider cancellation failure is not retried**
- `order-command.use-cases.ts:67–80`: If commerce.cancelOrder() fails (e.g., network timeout), exception propagates. Local is cancelled, provider is not. No dead-letter queue or retry mechanism. Fix: wrap in try-catch; publish event for manual retry; do not fail the endpoint.

**C4: CreateOrderFromPaymentUseCase duplicates payment approval check**
- `order-command.use-cases.ts:130–135`: Checks payment.status === "approved". But checkout.complete-order might have its own approval check. Inconsistent validation across modules. Fix: centralize payment approval gate; both callers delegate to shared validator.

---

## HIGH Priority

**H1: Page function is generic but cursors are JSON base64**
- `operations-read.use-cases.ts:149–151`: Cursor encoding is base64(JSON). Attacker can forge cursor with arbitrary values. No schema validation on decode. Fix: use HMAC-signed cursors or keyset pagination (id > :lastId LIMIT 1).

**H2: clampLimit() defaults to 25 but max is 100**
- `operations-read.use-cases.ts:144–147`: If caller passes limit=0 or limit=Infinity, clamped to [1, 100]. But no warning or guidance on optimal page size. Fix: document recommended limit; add telemetry for extreme values.

**H3: Tenant boundary not enforced at repository level**
- `operations.controller.ts:70, 101`: Controller extracts tenantId from request and passes to use-case. But use-case is not marked as requiring tenantId. If caller accidentally calls use-case without tenant context, it queries all data. Fix: make tenantId a required context parameter in use-case; throw if missing.

**H4: OrdersController mixes read and write in same path namespace**
- GET /orders (list) vs. POST /orders/:orderId/cancel both under OrdersController. Router confusion risk; easy to misroute. Fix: use separate v1/read/ and v1/write/ namespaces or split into ReadOrdersController & WriteOrdersController.

---

## MEDIUM Priority

**M1: No audit trail for order cancellation**
- CancelOrderUseCase updates order.status & order.cancelledAt but does not log who cancelled it or why. If cancellation is disputed, there is no audit. Fix: emit audit event with operator ID, timestamp, reason.

**M2: Pagination cursor does not include sort order**
- `page() function`: Cursor embeds occurredAt & id for keyset pagination. But if sort order changes (DESC vs. ASC), cursor interpretation is ambiguous. Merchant may receive duplicate or missing rows. Fix: include sort_order in cursor; validate consistency.

**M3: toOrderResponse() and toOrderDetailResponse() are almost identical**
- `operations.controller.ts:278–301`: Duplication. Any change to order shape must be made twice. Fix: extract shared serializer; toOrderResponse calls base method.

**M4: UpdateOrderTrackingUseCase is injected from integrations**
- `order-command.use-cases.ts:19` & `operations.controller.ts:57`: OrdersController imports & injects UpdateTenantOrderTrackingUseCase. Tight coupling; if integrations module changes, operations breaks. Fix: define UpdateOrderTracking contract in operations domain; integrations implements it.

---

## LOW Priority

**L1: Timeline not included in ListOrdersUseCase**
- GET /orders lists orders but omits timeline (tracking events, notes). Full timeline only available via GET /orders/:id. Inconsistent API shape. Fix: conditionally include timeline summary in list; add ?include=timeline query param.

**L2: toPaymentResponse() does not include merchant_id**
- `operations.controller.ts:326–341`: Payment response omits merchant_id, even though payment is tenant-scoped. Caller must use context to know which merchant. Fix: include merchant_id for clarity.

**L3: No validation on CreateOrderDto**
- `order-command.dto.ts`: No class-validator decorators. If payment_id is null or invalid UUID, use-case silently fails. Fix: add @IsString, @IsUUID decorators.

**L4: CancelOrderDto reason field max length unchecked**
- `order-command.dto.ts`: reason is free text. No max length. Attacker can submit 1MB reason string, bloating the database. Fix: add @MaxLength(500).

---

## Coupling Map

```
operations module
├─ → checkout (CompleteOrderUseCase, order repo)
├─ → commerce (CommerceOrderPort for provider cancellation)
├─ → integrations (UpdateTenantOrderTrackingUseCase)
└─ → shared/messaging (implicit via domain events)

Incoming:
├─ ← dashboard (read orders, customers, payments)
├─ ← operations API (cancel, create order)
└─ ← internal (tracking updates)

Outgoing:
├─ order.cancelled webhook
└─ (via integrations)
```

High outbound coupling (checkout, commerce, integrations). Read model depends on denormalized view.

---

## Proposed Changes

### Phase 1: Secure cursor & pagination (H1)

**Use HMAC-signed cursors**
```typescript
// operations-read.use-cases.ts
private readonly cursorSecret = requireSecret("OPERATIONS_CURSOR_SECRET", "dev-secret");

function encodeCursor(cursor: OperationsCursor, secret: string): string {
  const json = JSON.stringify(cursor);
  const hmac = createHmac('sha256', secret).update(json).digest('hex');
  return Buffer.from(`${json}.${hmac}`).toString('base64url');
}

function decodeCursor(value: string, secret: string): OperationsCursor {
  const [json, hmac] = Buffer.from(value, 'base64url').toString('utf8').split('.');
  const expected = createHmac('sha256', secret).update(json).digest('hex');
  if (hmac !== expected) throw new BadRequestException('cursor_tampered');
  return JSON.parse(json) as OperationsCursor;
}
```

### Phase 2: Fix read model staleness (C1)

**Add version & staleness indicator**
```typescript
// operations-read.repository.port.ts
export interface OrderSummary {
  ...
  version: number; // incremented on each event
  staleSinceMs: number; // ms since last event processed
}

// operations.controller.ts
@Get()
async list(...) {
  const page = await this.listOrders.execute({...});
  return pageResponse(page, (order) => ({
    ...toOrderResponse(order),
    stale_since_ms: order.staleSinceMs
  }));
}
```

### Phase 3: Fix cancellation idempotency (C2)

**Add idempotency key & guard**
```typescript
// order-command.use-cases.ts
@Injectable()
export class CancelOrderUseCase {
  constructor(
    private readonly idempotency: IdempotencyService, // track per merchant+orderId
    ...
  ) {}

  async execute(input: {..., idempotencyKey?: string}): Promise {...} {
    const key = input.idempotencyKey || `cancel_${input.orderId}`;
    const cached = await this.idempotency.get(input.merchantId, key);
    if (cached) return cached; // Return cached result

    const result = await this.executeUncached(input);
    await this.idempotency.set(input.merchantId, key, result, 300); // 5 min TTL
    return result;
  }
}
```

### Phase 4: Handle provider failures gracefully (C3)

**Wrap in try-catch; publish retry event**
```typescript
// order-command.use-cases.ts:67–80
let providerCancellationRequested = false;
let providerError = null;
if (order.commerceOrderId) {
  if (!this.commerce.cancelOrder) {
    throw new BadRequestException("commerce_cancellation_not_supported");
  }
  try {
    await this.commerce.cancelOrder({...});
    providerCancellationRequested = true;
  } catch (error) {
    // Log error, emit retry event; do NOT throw
    providerError = error;
    await this.events.emit('order.cancellation_provider_failed', {
      merchantId: input.merchantId,
      orderId: input.orderId,
      error: String(error)
    });
  }
}

return {
  ...cancellationResponse(cancelled, ...),
  provider_error: providerError ? { message: String(providerError) } : null
};
```

### Phase 5: Centralize payment approval (C4)

**Extract PaymentValidator**
```typescript
// payment.validator.ts (new, in checkout or payment domain)
@Injectable()
export class PaymentValidator {
  async assertApproved(merchantId: string, paymentId: string): Promise<Payment> {
    const payment = await this.repo.getPayment(merchantId, paymentId);
    if (!payment) throw new NotFoundException('payment_not_found');
    if (payment.status !== 'approved') {
      throw new ConflictException('payment_not_approved');
    }
    return payment;
  }
}

// CreateOrderFromPaymentUseCase
async execute(input: {...}): Promise {...} {
  const payment = await this.paymentValidator.assertApproved(
    input.merchantId,
    input.paymentId
  );
  ...
}
```

### Phase 6: Enforce tenant boundary in use-case (H3)

**Make tenantId required context**
```typescript
// operations-read.use-cases.ts
interface PageInput {
  merchantId: string; // REQUIRED; no default
  limit?: number;
  cursor?: string;
}

export class ListOrdersUseCase {
  execute(input: PageInput) {
    if (!input.merchantId?.trim()) {
      throw new BadRequestException('merchant_id_required');
    }
    return page(input, ...);
  }
}
```

### Phase 7: Split controller namespaces (H4)

**Separate read & write routes**
```typescript
// operations.controller.ts
@ApiTags('Orders — Read')
@Controller('orders')
export class ReadOrdersController { ... } // GET /orders, GET /orders/:id

@ApiTags('Orders — Write')
@Controller('orders')
export class WriteOrdersController { ... } // POST /orders, POST /orders/:id/cancel

// operations.module.ts
providers: [ReadOrdersController, WriteOrdersController, ...]
```

### Phase 8: Add audit trail (M1)

**Emit audit event on cancellation**
```typescript
// order-command.use-cases.ts
if (!cancelled.idempotent) {
  await this.audit.log({
    action: 'order.cancelled',
    merchantId: input.merchantId,
    orderId: input.orderId,
    operator: 'api', // or from request context
    reason: input.reason,
    timestamp: new Date().toISOString()
  });
}
```

### Phase 9: Decouple order tracking (M4)

**Define contract in operations domain**
```typescript
// operations/domain/ports/order-tracking.port.ts
export const ORDER_TRACKING_UPDATER = Symbol('ORDER_TRACKING_UPDATER');

export interface OrderTrackingUpdater {
  update(input: UpdateOrderTrackingInput): Promise<UpdateOrderTrackingResult>;
}

// operations.controller.ts
constructor(
  @Inject(ORDER_TRACKING_UPDATER) private readonly trackingUpdater: OrderTrackingUpdater
) {}

// integrations/operations-integration.module.ts
providers: [
  {
    provide: ORDER_TRACKING_UPDATER,
    useClass: UpdateTenantOrderTrackingUseCase
  }
]
```

---

## SOLID Principles

| Principle | Current | Proposed |
|-----------|---------|----------|
| **SRP** | CancelOrderUseCase updates local + calls provider + publishes webhook. | Split: OrderCanceller (domain), ProviderSync (infrastructure), WebhookPublisher (integration). |
| **OCP** | Provider cancellation is hardcoded to commerce.cancelOrder. | Use port/adapter; support multiple providers. |
| **LSP** | Page function assumes all cursors are valid JSON base64. | Validate cursor signature; throw if tampering detected. |
| **ISP** | OperationsReadRepository interface has 12 methods (huge). | Split: OrderQueryService, CustomerQueryService, PaymentQueryService. |
| **DIP** | Controller injects 5+ use-cases. | Inject command/query dispatcher; route by operation type. |

---

## Object Calisthenics

| Rule | Current | Proposed |
|------|---------|----------|
| 1: One level of indentation | CancelOrderUseCase has 4+ levels (if/await chains). | Extract: validateOrder(), cancelLocal(), syncProvider(), publishWebhook(). |
| 2: Don't use `else` | Uses if/else sparingly; mostly OK. | — |
| 3: Wrap primitives | totalMinor: number, acceptedOfferId: string. | Wrap: `class OrderAmount`, `class OfferId`. |
| 4: One dot per line | order.externalOrderId, session.merchantId (OK). | — |
| 5: Don't abbreviate | merchantId OK; "min" for minor units is domain term. | — |
| 6: Keep collections small | Not violated. | — |
| 7: No getters/setters | Entities use .snapshot(); OK. | ✓ |
| 8: No classes with 2+ responsibilities | CancelOrderUseCase does local + provider + webhook. | Extract 3 services. |
| 9: No getters for internal state | Not violated. | — |

---

## Summary

**Refactor Strategy:**
1. Secure pagination cursors with HMAC signatures (H1).
2. Add version/staleness indicators to read model (C1).
3. Make cancellation idempotent via idempotency service (C2).
4. Wrap provider failures in try-catch; publish retry event (C3).
5. Centralize payment approval validation (C4).
6. Enforce merchant ID at use-case entry (H3).
7. Split read/write controllers into separate classes (H4).
8. Add audit trail for cancellations (M1).
9. Decouple order tracking via port/adapter (M4).
10. Reduce use-case responsibilities via domain services.
11. Result: resilient order operations, auditable state, secure pagination, clear read/write boundaries.

**Estimated Effort:** 5–7 days (includes integration testing with commerce provider).
