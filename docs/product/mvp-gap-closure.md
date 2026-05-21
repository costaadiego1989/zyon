# AACP MVP Gap Closure

This document lists the remaining gaps to move AACP from local checkout demo to pilot-ready MVP. The executable SDD feature lives in `.specs/features/finish-mvp-gap-closure/`.

## Current Baseline

- Real-api Playwright covers checkout happy path through shipping selection, Pix fake approval, final success message, support, buyer registration, and buyer hub basics.
- Widget no longer shows freight in the cart before the buyer chooses a shipping option.
- Buyer hub can show/search tracking code when the completed order has one.
- Completed orders now stay pending for tracking until a real carrier/operator code is attached via the order tracking update path.
- Support panel has FAQ/chat fallback and real-api coverage.
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
| Support | FAQ/chat works, but unresolved cases do not become tickets/handoffs. | Support can feel like a dead end. | Persist support ticket/handoff for unanswered questions. |
| Merchant dashboard | Dashboard does not yet operate all pilot surfaces: orders, tracking, support, shipping, metrics. | Pilot requires database edits and manual inspection. | Add order/support/shipping operational panels incrementally. |
| Secure embed | Token-only embed and runtime validation are not fully closed end-to-end. | Sensitive checkout facts may leak into browser config or malformed payloads may render. | Enforce token and widget response schemas on public flows. |
| CI/observability | Local gates exist, but pilot needs repeatable CI plus logs/metrics. | Regressions and production issues are harder to catch. | Document and automate API/widget/Prisma/Playwright gates. |

## Immediate Priority

1. Add support handoff/ticket state.
2. Harden secure embed/runtime validation.
3. Add dashboard pilot metrics and repeatable gates.
4. Connect real carrier/provider tracking sync to the completed-order update path.
5. Add real-provider/commerce smoke with configured credentials.

## Definition of Done for MVP Pilot

- Buyer can complete checkout through real API with persisted checkout/payment/order records.
- Payment approval is provider-driven and idempotent.
- Store/commerce order is created pending and marked paid after approval.
- Selected freight is persisted and charged exactly once.
- Buyer hub shows order and tracking state.
- Support can answer FAQ or create a visible handoff.
- Merchant can operate rules, support, shipping, tracking, and metrics from dashboard.
- Full local gates pass from a clean setup.
