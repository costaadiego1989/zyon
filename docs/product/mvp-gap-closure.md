# AACP MVP Gap Closure

This document lists the remaining gaps to move AACP from local checkout demo to pilot-ready MVP. The executable SDD feature lives in `.specs/features/finish-mvp-gap-closure/`.

## Current Baseline

- Real-api Playwright covers checkout happy path through shipping selection, Pix fake approval, final success message, support, buyer registration, and buyer hub basics.
- Widget no longer shows freight in the cart before the buyer chooses a shipping option.
- Buyer hub can show/search tracking code when the completed order has one.
- Completed orders now stay pending for tracking until a real carrier/operator code is attached via the order tracking update path.
- Support panel answers configured FAQ immediately and creates a support ticket/handoff with a visible protocol when FAQ cannot resolve the question.
- Merchant dashboard support can list handoff tickets and update their status.
- Merchant dashboard overview shows pilot cards for orders, conversion, offers, selected/pending freight, support tickets, and revenue.
- Local gates for API, widget, dashboard, Prisma/Postgres, and Playwright are documented and passed in the current local stack.
- Public coupon application is embed-token scoped and checks checkout-session ownership before applying discounts.
- Widget public checkout responses are runtime-validated before render for start, tracking, chat, offer, coupon, payment, and product-cart flows.
- Merchant embed bootstrap no longer injects selected freight by default; freight stays pending until the buyer quotes/selects it.
- `full-checkout-real` Playwright now passes against the local API/widget stack, including frete pending before selection, real chat quote/selection, payment success, support API, and buyer hub API checks.
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
| Merchant dashboard | Dashboard can operate support FAQ/tickets and now shows pilot metrics for orders, conversion, offers, freight, support, and revenue. | Pilot still requires database edits/manual inspection for order tracking and shipping operations. | Add order/tracking/shipping operational panels incrementally. |
| Secure embed | Core public checkout flows now use embed-token scoped endpoints and runtime response schemas. | Pilot still needs production headers/CSP, token rotation policy, and real-store credential review. | Add production embed hardening checklist to pilot gates. |
| CI/observability | Local API/widget/dashboard/Prisma/Playwright gates are documented and passed against the local stack. | Production CI still needs to run the same gates automatically on every change. | Wire the documented local gates into CI. |

## Immediate Priority

1. Connect real carrier/provider tracking sync to the completed-order update path.
2. Add support SLA/notification routing on top of persisted tickets.
3. Add real-provider/commerce smoke with configured credentials.
4. Add production embed hardening checklist: CSP, token rotation, allowed origins, and real-store credential review.
5. Add order/tracking/shipping operational panels beyond the current pilot metric cards.

## Local Pilot Gates

Run from Windows PowerShell at the repo root. Use `cmd /c` for `pnpm` commands so Windows does not block on `pnpm.ps1`.

1. `cmd /c pnpm db:up`
2. `cmd /c pnpm db:migrate`
3. `cmd /c pnpm --filter @aacp/api test`
4. `$env:AACP_RUN_PRISMA_TESTS='1'; $env:DATABASE_URL='postgresql://postgres:postgres@localhost:55432/aacp_test'; cmd /c pnpm --filter @aacp/api test:prisma`
5. `cmd /c pnpm --filter @aacp/widget typecheck`
6. `cmd /c pnpm --filter @aacp/widget test`
7. `cmd /c pnpm --filter @aacp/dashboard typecheck`
8. `cmd /c pnpm --filter @aacp/dashboard test`
9. `cmd /c pnpm --filter @aacp/widget exec playwright test e2e/realapi/full-checkout-real.spec.ts --project=widget-realapi`

The focused real-api Playwright gate is currently green against the local memory stack. The Prisma gate requires Postgres from `pnpm db:up`, a migrated database, and the explicit envs above so the full Prisma suite does not skip integration specs.

## Definition of Done for MVP Pilot

- Buyer can complete checkout through real API with persisted checkout/payment/order records.
- Payment approval is provider-driven and idempotent.
- Store/commerce order is created pending and marked paid after approval.
- Selected freight is persisted and charged exactly once.
- Buyer hub shows order and tracking state.
- Support can answer FAQ or create a visible handoff/ticket.
- Public widget flows are token-scoped and reject malformed public API payloads before render.
- Merchant can operate rules, support, shipping, tracking, and metrics from dashboard.
- Full local gates pass from a clean setup.
