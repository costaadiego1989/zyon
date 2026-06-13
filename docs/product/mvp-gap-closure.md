# AACP MVP Gap Closure

This document lists the remaining gaps to move AACP from local checkout demo to pilot-ready MVP. The executable SDD closure for tenant integrations and checkout enterprise polish lives in `.specs/features/tenant-integrations-mvp/`.

## Current Baseline

- Real-api Playwright covers checkout happy path through shipping selection, Pix fake approval, final success message, support, buyer registration, and buyer hub basics.
- Widget no longer shows freight in the cart before the buyer chooses a shipping option.
- Buyer hub can show/search tracking code when the completed order has one.
- Buyer hub purchase history now prefers durable `Shipment` tracking code/status/timeline when tenant tracking is registered after approval.
- Real-api Playwright now proves the tenant integration loop: merchant API key/webhook setup, checkout approval, signed `order.approved` and `customer.upserted` deliveries to fake receiver, tenant tracking update, signed `order.tracking.updated` delivery, API-key timeline lookup, buyer hub purchases with tracking timeline, and visible browser hub search/timeline rendering.
- Completed orders now stay pending for tracking until a real carrier/operator code is attached via the order tracking update path.
- Support panel answers configured FAQ immediately and creates a support ticket/handoff with a visible protocol when FAQ cannot resolve the question.
- Merchant dashboard support can list handoff tickets and update their status.
- Merchant dashboard overview shows pilot cards for orders, conversion, offers, selected/pending freight, support tickets, and revenue.
- Local gates for API, widget, dashboard, Prisma/Postgres, and Playwright are documented and passed in the current local stack.
- Pilot integration closure is now tracked in `.specs/features/tenant-integrations-mvp/` as the source of truth for API keys, tenant webhooks, tracking inbound, operational dashboard menus, professional embed issuance, and configurable enterprise checkout UX.
- Tenant integration first slice is implemented in API: scoped server-to-server API keys, HMAC webhook configuration/delivery logs, async webhook dispatcher, order/customer outbound events, tracking inbound API, and persisted shipment/tracking tables.
- Tenant dashboard operations now expose Integracoes, Pedidos/Envios, Clientes, and Embed menus over the new API surface.
- Tenant dashboard auth foundation now has a dedicated login/signup screen, authenticated sidebar shell, logout endpoint, and local default API base aligned to port `3000`; after user review, the dashboard is parked as not pilot-ready until a complete enterprise redesign/UAT pass.
- Professional embed sessions can be issued by dashboard session or scoped tenant API key with allowed origin, scopes, and cart reference claims.
- Public coupon application is embed-token scoped and checks checkout-session ownership before applying discounts.
- Widget public checkout responses are runtime-validated before render for start, tracking, chat, offer, coupon, payment, and product-cart flows.
- Widget buyer chat now handles OTP copied from API logs without mistaking PID/date values for the code, keeps OTP messages from being reused as CPF/phone data, and leaves the composer usable while agent text is still animating.
- Merchant embed bootstrap no longer injects selected freight by default; freight stays pending until the buyer quotes/selects it.
- Freight quote fallback now exposes professional selectable options for Correios PAC, Correios Sedex, and Transportadora Parceira; real carrier quotes are preserved and fallback options are appended/deduped instead of collapsing to one generic shipping label.
- Widget freight cards now show carrier, method, ETA, and price while preserving the existing dark/light theme tokens.
- Cross-sell is now part of the real checkout sequence before coupon/payment: eligible suggestions are returned through the checkout experience, accepted through an embed-scoped endpoint, added to the real cart, and reflected in totals.
- Coupon is now a gated pre-payment step: the buyer explicitly chooses whether they have a coupon, the coupon input only appears on "Sim", and payment methods only appear after skip/apply.
- Coupon application persists the current discount in the checkout session and returns an updated experience, so cart, chat, and payment share one total.
- Buyer hub profile fields now hydrate from verified checkout session data when the logged buyer profile is still incomplete.
- `full-checkout-real` Playwright now passes against the local API/widget stack, including frete pending before selection, real chat quote/selection, payment success, support API, and buyer hub API checks.
- Payment has fake E2E auto-approval and Asaas webhook handling, but local E2E still uses fake provider for determinism.
- API now rejects payment before selected shipping and persists selected shipping from the public shipping selection path into the checkout session.
- Commerce-backed payment validates the trusted commerce cart and creates/reuses one pending commerce order before provider payment when `commerceCartRef` is present.
- Approved Asaas/Stripe webhook paths now use the persisted `PaymentIntent.commerceOrderId` to mark the linked commerce order paid idempotently; if commerce paid sync fails after approval, the provider event is not marked processed so retry can recover without completing checkout twice.

## Open Gaps

| Area | Gap | Risk | First Closure Slice |
| --- | --- | --- | --- |
| Checkout sequence | Backend now guards payment before selected shipping, validates commerce carts before provider payment, marks commerce paid after provider approval, keeps OTP/chat progression covered, exposes professional freight options, runs cross-sell before coupon, gates coupon before payment, and persists discounts in checkout session. | Remaining checkout risks are in production provider/carrier smoke and browser UAT under real tenant themes. | Add real-provider/carrier smoke plus tenant-theme UAT pass. |
| Payment | Asaas/Stripe webhook approval is idempotent and drives checkout completion; local E2E still uses fake provider for determinism. | Pilot still needs a real-credential smoke against Asaas/commerce in a controlled environment. | Prisma-backed payment lifecycle test with Asaas webhook and configured credentials. |
| Commerce sync | Pending and paid lifecycle is wired through payment intent `commerceOrderId`. | External adapter credentials and durable operator retry still need pilot hardening. | Add real-provider/commerce smoke and operational retry visibility. |
| Shipping | Quote/selection persistence is covered; fallback now provides PAC/Sedex/transportadora choices; tracking can be attached after completion; real carrier configuration remains. | Freight can still diverge from fulfillment if no carrier sync exists. | Add real carrier sync/smoke for quote and label flows. |
| Tracking | Tenant tracking API can attach tracking by external order id, persist shipment/timeline data, feed buyer hub purchase history from the durable shipment read model, and pass the real-api receiver/tracking/hub timeline gate including visible browser hub search/timeline assertions. Prisma live coverage now validates shipment/timeline persistence and tenant isolation. | Pilot still needs real carrier/provider sync. | Add real carrier smoke. |
| Support | FAQ and ticket handoff now work from widget through dashboard status operation. | Pilot still needs SLA/notification routing beyond the persisted ticket. | Add operator notifications and SLA filters. |
| Merchant dashboard | Dashboard has backend routes and a corrective auth/shell foundation, but the user explicitly parked it after review. | The current dashboard is not pilot-ready; small layout polish is not enough. | Redesign the dashboard as a separate enterprise UX track with real browser UAT. |
| Secure embed | Core public checkout flows now use embed-token scoped endpoints and runtime response schemas; backend embed sessions can be issued via dashboard or scoped API key with origin/scopes/cart ref claims. | Pilot still needs production headers/CSP, token rotation policy, and real-store credential review. | Add production embed hardening checklist to pilot gates. |
| CI/observability | Local API/widget/dashboard/Prisma/Playwright gates are documented and passed against the local stack. | Production CI still needs to run the same gates automatically on every change. | Wire the documented local gates into CI. |
| Tenant integrations | API key, outbound tenant webhook, inbound tracking, durable shipment/tracking, embed issuance, signed `order.approved`/`customer.upserted`/`order.tracking.updated` receiver assertions, full browser-visible hub real-api gate, Prisma live repository coverage, and unit coverage for webhook replay/retry/final failure are implemented. | Remaining integration risk is production retry/observability hardening. | Add production retry visibility and alerting. |
| Enterprise checkout UX | Theme now covers fonts, surfaces, background, avatar, header copy, trust badges, density, and enterprise tokens; heavy widget CSS overrides were removed after dark-theme regression; the current flow now has freight cards, cross-sell, coupon gate, and hub hydration covered by tests. | Pilots still need browser UAT to ensure each tenant style looks premium without breaking dark/light theme. | Refine typography/layout using existing widget structure, not broad overrides. |

## Immediate Priority

1. Keep the dashboard parked until a full enterprise redesign track is opened; do not treat the current shell as pilot-ready.
2. Add production retry visibility and alerting for tenant webhooks.
3. Add real-provider/commerce/carrier smoke with configured credentials.
4. Add production embed hardening checklist: CSP, token rotation, allowed origins, and real-store credential review.
5. Run tenant-theme browser UAT on the refined checkout sequence.
6. Open a separate dashboard redesign SDD before investing more in tenant-panel UI.

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

The focused real-api Playwright gate is currently green against the local memory stack, including the tenant receiver/tracking/hub timeline scenario. The Prisma gate is green with Postgres from `pnpm db:up`, migrated schema, and the explicit envs above. On 2026-05-22, API unit gate passed with 387 tests / 13 skipped, widget typecheck passed, widget unit suite passed with 249 tests, and focused `widget-realapi` passed for freight quote cards, cross-sell accept, coupon gate, cart update, and checkout continuation.

## Definition of Done for MVP Pilot

- Buyer can complete checkout through real API with persisted checkout/payment/order records.
- Payment approval is provider-driven and idempotent.
- Store/commerce order is created pending and marked paid after approval.
- Selected freight is persisted and charged exactly once.
- Buyer hub shows order and tracking state.
- Support can answer FAQ or create a visible handoff/ticket.
- Public widget flows are token-scoped and reject malformed public API payloads before render.
- Merchant can operate rules, support, shipping, tracking, and metrics from dashboard.
- Merchant can sign up, log in, stay in an authenticated dashboard shell, and log out cleanly.
- Merchant can integrate backend-to-backend through API keys, webhooks, and tracking update API.
- Tenant can configure checkout appearance beyond basic colors: fonts, surfaces, background, avatar, copy, trust badges, and premium visual density.
- Full local gates pass from a clean setup.
