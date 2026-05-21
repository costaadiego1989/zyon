# AACP MVP Gap Closure

This document lists the remaining gaps to move AACP from local checkout demo to pilot-ready MVP. The executable SDD feature lives in `.specs/features/finish-mvp-gap-closure/`.

## Current Baseline

- Real-api Playwright covers checkout happy path through shipping selection, Pix fake approval, final success message, support, buyer registration, and buyer hub basics.
- Widget no longer shows freight in the cart before the buyer chooses a shipping option.
- Buyer hub can show/search tracking code when the completed order has one.
- Completed orders now stay pending for tracking until a real carrier/operator code is attached via the order tracking update path.
- Support panel answers configured FAQ immediately and creates a support ticket/handoff with a visible protocol when FAQ cannot resolve the question.
- Merchant dashboard support can list handoff tickets and update their status.
- Payment has fake E2E auto-approval and Asaas webhook handling, but local E2E still uses fake provider for determinism.
- API now rejects payment before selected shipping and persists selected shipping from the public shipping selection path into the checkout session.
- Commerce-backed payment validates the trusted commerce cart and creates/reuses one pending commerce order before provider payment when `commerceCartRef` is present.
- Approved Asaas/Stripe webhook paths now use the persisted `PaymentIntent.commerceOrderId` to mark the linked commerce order paid idempotently; if commerce paid sync fails after approval, the provider event is not marked processed so retry can recover without completing checkout twice.

## Open Gaps

| Area | Gap | Risk | First Closure Slice |
| --- | --- | --- | --- |
| Checkout sequence | Backend now guards payment before selected shipping, validates commerce carts before provider payment, and marks commerce paid after provider approval. | Remaining checkout risks are in tracking/support/operator surfaces. | Add tracking update/sync path. |
| Payment | Asaas/Stripe webhook approval is idempotent and drives checkout completion; local E2E still uses fake provider for determinism. | Pilot still needs a real-credential smoke against Asaas/commerce in a controlled environment. | Prisma-backed payment lifecycle test with Asaas webhook and configured credentials. |
| Commerce sync | Pending and paid lifecycle is wired through payment intent `commerceOrderId`. | External adapter credentials and durable operator retry still need pilot hardening. | Add real-provider/commerce smoke and operational retry visibility. |
| Shipping | Quote/selection persistence is covered; tracking can be attached after completion; real carrier configuration remains. | Freight can still diverge from fulfillment if no carrier sync exists. | Add real carrier sync/smoke for quote and label flows. |
| Tracking | API path and buyer hub pending/search behavior are wired. | Pilot still needs a real carrier/provider sync source to populate codes automatically. | Connect fulfillment/carrier tracking sync to the update path. |
| Support | FAQ and ticket handoff now work from widget through dashboard status operation. | Pilot still needs SLA/notification routing beyond the persisted ticket. | Add operator notifications and SLA filters. |
| Merchant dashboard | Dashboard can operate support FAQ/tickets, but does not yet cover all pilot surfaces: orders, tracking, shipping, metrics. | Pilot still requires database edits/manual inspection for non-support operations. | Add order/support/shipping operational panels incrementally. |
| Secure embed | Token-only embed and runtime validation are not fully closed end-to-end. | Sensitive checkout facts may leak into browser config or malformed payloads may render. | Enforce token and widget response schemas on public flows. |
| CI/observability | Local gates exist, but pilot needs repeatable CI plus logs/metrics. | Regressions and production issues are harder to catch. | Document and automate API/widget/Prisma/Playwright gates. |

## Immediate Priority

1. Harden secure embed/runtime validation.
2. Add dashboard pilot metrics and repeatable gates.
3. Connect real carrier/provider tracking sync to the completed-order update path.
4. Add support SLA/notification routing on top of persisted tickets.
5. Add real-provider/commerce smoke with configured credentials.

## Definition of Done for MVP Pilot

- Buyer can complete checkout through real API with persisted checkout/payment/order records.
- Payment approval is provider-driven and idempotent.
- Store/commerce order is created pending and marked paid after approval.
- Selected freight is persisted and charged exactly once.
- Buyer hub shows order and tracking state.
- Support can answer FAQ or create a visible handoff/ticket.
- Merchant can operate rules, support, shipping, tracking, and metrics from dashboard.
- Full local gates pass from a clean setup.
