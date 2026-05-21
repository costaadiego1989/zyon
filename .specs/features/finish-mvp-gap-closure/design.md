# Finish MVP Gap Closure Design

**Spec**: `.specs/features/finish-mvp-gap-closure/spec.md`
**Status**: In Progress

---

## Architecture Overview

The MVP should close as a vertical lifecycle instead of isolated screens:

1. Widget starts a secure checkout session.
2. Buyer provides identity and delivery facts.
3. API quotes and persists selected shipping.
4. Payment intent can be created only after required checkout facts are settled.
5. Provider webhook approves/fails/refunds payment idempotently.
6. Approved payment completes checkout, records purchase history, and syncs commerce order paid state.
7. Buyer hub and merchant dashboard read persisted facts.
8. Support FAQ answers immediately and creates handoff/ticket state when needed.

The first implementation slice focuses on step 4 because it protects the sequence at the backend boundary without requiring new provider credentials.

---

## Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
| --- | --- | --- |
| `CreatePaymentIntentUseCase` | `apps/api/src/modules/payment/application/create-payment-intent.use-case.ts` | Add server-side precondition before amount/provider creation. |
| Payment tests | `apps/api/src/modules/payment/application/create-payment-intent.use-case.spec.ts` | Add RED test for missing selected shipping. |
| `CheckoutSessionRepository` | `apps/api/src/modules/checkout/domain/ports/checkout-session.repository.port.ts` | Existing source of session/cart/shipping truth. |
| Shipping selection use case | `apps/api/src/modules/shipping/application/use-cases/select-shipping-method.use-case.ts` | Keep as the path that writes selected session shipping. |
| Commerce use cases | `apps/api/src/modules/commerce/application/*.ts` | Validate trusted carts, create/reuse pending orders, and mark linked orders paid from provider approval. |
| Buyer hub hooks/components | `apps/widget/src/hooks/use-buyer-hub.ts`, `apps/widget/src/components/checkout/UserPanel.tsx` | Extend after backend lifecycle is persistent. |
| Support module | `apps/api/src/modules/support/*` and `apps/widget/src/components/checkout/SupportPanel.tsx` | Extend from FAQ/chat to ticket/handoff. |

### Integration Points

| System | Integration Method |
| --- | --- |
| Payment provider | Existing `PaymentProviderPort`, `AsaasPaymentAdapter`, fake provider for E2E. |
| Checkout completion | Existing `CheckoutPaymentPort` / `CompleteOrderUseCase`. |
| Commerce | Existing `@aacp/commerce-adapters` ports and application use cases. |
| Shipping | Existing `CarrierPort`, Melhor Envio adapter, flat-rate fallback, selected shipping persistence. |
| Persistence | Existing Prisma repositories, with in-memory only for deterministic E2E or unit tests. |

---

## Components

### Payment Checkout Preconditions

- **Purpose**: Block payment creation when required checkout state is incomplete.
- **Location**: `apps/api/src/modules/payment/application/create-payment-intent.use-case.ts`
- **Interfaces**:
  - `assertCheckoutReadyForPayment(session: CheckoutSession): void`
- **Dependencies**: `CheckoutSession` snapshot from `CheckoutSessionRepository`.
- **Reuses**: Existing payment amount calculation and Nest `BadRequestException`.

### Commerce Lifecycle Wiring

- **Purpose**: Validate cart, create pending commerce order, and mark paid on payment approval.
- **Location**: later slices under `apps/api/src/modules/commerce` and payment/checkout handlers.
- **Interfaces**:
  - `ValidateCartForPaymentUseCase.execute`
  - `SyncPendingOrderUseCase.execute`
  - `MarkCommerceOrderPaidUseCase.execute`
- **Dependencies**: Commerce adapter credentials or fallback adapter.
- **Reuses**: Existing commerce use cases and idempotency repositories.

### Tracking Lifecycle

- **Purpose**: Keep buyer hub honest by showing pending tracking until a real carrier/fulfillment code exists.
- **Location**:
  - `CompletedOrderEntity` records only supplied `tracking_code`; it does not generate fake `TRK-*` codes.
  - `UpdateOrderTrackingUseCase` updates the completed order after fulfillment/operator sync.
  - `CheckoutController` exposes `PATCH /orders/tracking` for the operator/API path.
  - Buyer hub reads `completed_orders.tracking_code` through buyer purchases and searches by that value.
- **Events**:
  - Initial `order.completed` includes `tracking_code: null` when the code is not available.
  - Tracking update emits `order.tracking.updated`.
  - Buyer notification uses `whatsapp.message.requested` only when a real tracking code exists.

### Support Handoff

- **Purpose**: Persist unresolved support requests instead of relying only on chat fallback.
- **Location**:
  - `SendSupportMessageUseCase` checks configured FAQ first. Matched FAQ returns an answer without creating a ticket.
  - `SupportTicketEntity` records unresolved buyer requests with merchant/session scope, status, source, and timestamps.
  - `SupportController` exposes public chat plus authenticated ticket list/status update routes.
  - Dashboard support page combines FAQ editing with ticket operations.
- **Interfaces**:
  - `ListSupportTicketsUseCase.execute`
  - `UpdateSupportTicketStatusUseCase.execute`
- **Dependencies**: Support settings, buyer/session context.
- **Reuses**: Existing support FAQ/chat controller and dashboard support page.

---

## Data Models

### Checkout Readiness

No new model is required for the first slice. The payment use case reads:

```typescript
interface CheckoutSession {
  cart: Cart;
  shipping?: ShippingQuote;
}
```

A session with cart items and no `shipping` is not ready for payment.

### Support Ticket

Unresolved support now persists a durable operational handoff:

```typescript
interface SupportTicket {
  id: string;
  merchantId: string;
  sessionId?: string;
  buyerMessage: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  source: "widget" | "dashboard" | "system";
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}
```

Migration `20260521143000_add_support_tickets` adds `support_tickets`.

### Future Commerce Order Link

Commerce sync now stores the payment-to-commerce link on the payment intent:

```typescript
interface PaymentIntentSnapshot {
  merchantId: string;
  sessionId: string;
  commerceOrderId?: string;
}
```

Migration `20260521120000_add_commerce_order_id_to_payment_intents` adds `payment_intents.commerce_order_id`. Webhooks read this value after provider approval, call `MarkCommerceOrderPaidUseCase`, and leave the provider event unprocessed when commerce sync throws so retry can resume without completing checkout twice.

---

## Error Handling Strategy

| Error Scenario | Handling | User Impact |
| --- | --- | --- |
| Payment before selected shipping | Throw `BadRequestException("shipping_method_required_before_payment")` | Widget can keep buyer in shipping stage. |
| Selected shipping has zero price | Allow payment because free shipping is a valid selected option. | Buyer can pay with free shipping. |
| Provider approval duplicate | Return duplicate/no-op from repository dedup | Buyer/order not duplicated. |
| Commerce mark-paid fails | Do not mark dedup processed; keep retryable failure | Merchant can recover sync. |
| Support cannot answer | Create handoff/ticket state | Buyer sees support is pending, not broken. |

---

## Tech Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| First implementation slice | Backend payment readiness guard | High-impact, low-risk, directly tied to freight/checkout correctness. |
| Missing shipping behavior | Reject payment when cart has items and no selected shipping | Prevents undercharging freight through direct API calls. |
| Free shipping behavior | Allow if `session.shipping` exists, even with `customerPrice: 0` | Free shipping is a selected shipping outcome, not missing freight. |
| Test level for first slice | API unit/use-case test | Fast and focused on the backend invariant. |
| Commerce order link | Persist `commerceOrderId` on `PaymentIntent` | Webhook retries survive process restarts better than an in-memory pending-order index alone. |
| Commerce paid retry | Do not record provider event when post-approval commerce sync throws | Provider retry can re-enter the approved-intent path and only perform missing commerce sync. |
| Tracking truth | Do not synthesize `TRK-*`; persist only real tracking codes | Buyer hub should show pending delivery tracking until fulfillment or the operator provides the carrier code. |
