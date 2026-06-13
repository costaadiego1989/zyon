# Tenant Integrations MVP Tasks

## Status Legend

- `[ ]` Pending
- `[~]` In progress
- `[x]` Done

## Tasks

- `[x]` **TIM-T000 Commit prior checkpoint**
  - Requirement: source control hygiene
  - Verification: commit `84f79c7 feat(dashboard): add pilot metrics and local gates`

- `[x]` **TIM-T001 Source of truth docs**
  - Requirements: TIM-R001..TIM-R015
  - Work: create feature spec/design/tasks and update MVP gap doc.
  - Verification: committed in `2fd4cf8 feat(integrations): add tenant api keys and tracking webhooks`; docs continue as source of truth for each slice.

- `[x]` **TIM-T002 API key foundation**
  - Requirements: TIM-R001, TIM-R002, TIM-R012
  - Work done: Prisma model/migration, in-memory/Prisma repository, key generation/hash, API-key guard, dashboard-facing CRUD API routes for create/list/revoke.
  - Work done 2026-05-21: Prisma live repository spec covers create/list/find/touch/revoke and tenant isolation.
  - Tests: API unit green via `cmd /c pnpm --filter @aacp/api test`; Prisma gate green via `cmd /c "set AACP_RUN_PRISMA_TESTS=1&& set DATABASE_URL=postgresql://postgres:postgres@localhost:55432/aacp_test&& pnpm --filter @aacp/api test:prisma"`.

- `[x]` **TIM-T003 Webhook foundation**
  - Requirements: TIM-R003, TIM-R004, TIM-R005
  - Work done: endpoint/delivery Prisma models, in-memory/Prisma repository, HMAC signer, async delivery dispatcher, dashboard API routes and UI for list/create/test/replay and delivery log.
  - Work done 2026-05-21: Prisma live repository spec covers endpoint upsert/list/get, delivery idempotency, delivery update, due delivery lookup, and tenant isolation.
  - Work done 2026-05-21: API unit coverage now verifies replay reset, signed dispatcher delivery, retry scheduling on HTTP failure, and final failure after max attempts.
  - Tests: signer, delivery creation, replay, dispatcher success/retry/fail, and Prisma live integrations repository spec green.

- `[x]` **TIM-T004 Order/customer webhook events**
  - Requirements: TIM-R006, TIM-R007
  - Work done: `order.completed` domain events publish tenant `order.approved` and `customer.upserted` deliveries with order/items/totals/freight/customer/payment/tracking payload.
  - Work done 2026-05-21: Playwright real-api registers a tenant webhook receiver and asserts signed `order.approved` HTTP delivery after checkout payment approval.
  - Work done 2026-05-21: the same real-api receiver gate now also asserts signed `customer.upserted` delivery with customer email, checkout session, and external order id.
  - Work done 2026-05-21: Prisma live repository spec covers persisted webhook delivery storage/update used by the outbound event path.

- `[x]` **TIM-T005 Tracking inbound and fulfillment persistence**
  - Requirements: TIM-R008, TIM-R009, TIM-R010
  - Work done: `PUT /integrations/orders/:external_order_id/tracking` with API key auth, checkout order lookup by external order id, shipment/tracking persistence models, dashboard shipment list API, API-key tracking timeline API, tenant `order.tracking.updated` delivery, buyer hub read-model enrichment from durable shipments/tracking events, and in-memory buyer purchase fallback for real-api E2E.
  - Work done 2026-05-21: Playwright real-api completes checkout, tenant registers tracking, fake receiver receives `order.tracking.updated`, API-key timeline returns events, and buyer hub purchases endpoint returns tracking code/status/carrier/timeline.
  - Work done 2026-05-21: Playwright real-api now opens the widget in the browser with the buyer session, searches the hub by tracking code, and asserts carrier/status/timeline text visibly rendered.
  - Work done 2026-05-21: Prisma live repository spec covers shipment upsert/list/get, tracking event append/list, ordering, and tenant isolation.
  - Tests: API unit green for inbound tracking, shipment timeline, webhook delivery enqueue, and buyer purchases preferring durable shipment timeline; widget hub renders tracking status/timeline; Playwright real-api tracking scenario green; Prisma live integrations spec green.

- `[~]` **TIM-T006 Dashboard operations**
  - Requirements: TIM-R011
  - Work done: added Integracoes, Pedidos/Envios, Clientes, Embed, and Tema pages plus dashboard API client methods for API keys, webhooks, deliveries, shipments, embed sessions, and theme.
  - Corrective slice 2026-05-21: dashboard now has a dedicated authenticated shell, login/signup screen, logout, sidebar navigation, and default API base `http://localhost:3000`.
  - User decision 2026-05-21: dashboard is parked and must be considered not pilot-ready; layout/auth UX needs a complete enterprise redesign later instead of more small polish.
  - Remaining: full redesign/UAT, filters/search, empty/loading states, and signup/login browser smoke before dashboard can be called ready.
  - Tests: `cmd /c pnpm --filter @aacp/dashboard typecheck`; `cmd /c pnpm --filter @aacp/dashboard test`.

- `[x]` **TIM-T007 Professional embed issuance**
  - Requirements: TIM-R012
  - Work: allow dashboard session or scoped API key auth on `POST /embed-sessions`, add allowed origin/scopes/cart ref claims, and expose a dashboard snippet generator.
  - Tests: API controller specs for issued claims plus full API suite.

- `[~]` **TIM-T008 Enterprise checkout theme**
  - Requirements: TIM-R013, TIM-R014
  - Work done: extended theme DTO/default merge, API validation, dashboard theme editor, widget theme variables, Google font injection, and tests for configured tenant copy.
  - Corrective slice 2026-05-21: removed the heavy widget CSS override that broke dark theme and removed default header copy/trust badges so tenant copy only appears when configured.
  - Remaining: refined page-level design pass after UAT; do not force visual chrome over existing dark/light theme.
  - Tests: theme validation, widget theme mapping, dashboard theme save, dark-theme regression by UAT.

- `[~]` **TIM-T010 Dashboard auth and enterprise shell**
  - Requirements: TIM-R011, TIM-R012
  - Work done: dashboard signup uses `POST /auth/register`; login uses `POST /auth/login`; logout clears cookie through new `POST /auth/logout`; unauthenticated users see auth screen before operations; authenticated users see sidebar shell.
  - Remaining: visual QA in browser, page-by-page operational redesign, and end-to-end signup/login smoke against local API.
  - Tests: API logout unit; dashboard api-client register/logout tests; API full suite; dashboard typecheck/test.

- `[x]` **TIM-T009 Full real-api gate**
  - Requirements: TIM-R015
  - Work: Playwright receiver/tracking scenario covers checkout approval, signed `order.approved` and `customer.upserted` tenant webhook deliveries, inbound tenant tracking update, signed tracking delivery, API-key timeline lookup, buyer hub purchases read model, and visible buyer hub tracking/timeline UI.
  - Tests: `full-checkout-real` passed 2026-05-21 with all 8 real-api tests green.

- `[x]` **TIM-T011 Buyer OTP paste and chat progression regression**
  - Requirements: TIM-R014, TIM-R015
  - Work done 2026-05-22: e-mail/SMS OTP validation now treats a pending OTP message as OTP-only, so pasted API log metadata cannot be extracted as CPF/phone/CEP after verification.
  - Work done 2026-05-22: OTP extraction now prefers labeled OTP/code values and falls back to the last 6-digit candidate, preventing Nest PID/date values from being validated instead of the real code.
  - Work done 2026-05-22: widget composer remains usable while the latest agent bubble is still animating, and thread autoscroll re-runs after quick replies/stage changes.
  - Tests: API extraction/use-case regression, widget composer availability regression, full API suite, widget typecheck/test.

- `[x]` **TIM-T012 Professional freight options**
  - Requirements: TIM-R014, TIM-R015
  - Work done 2026-05-22: quote aggregation now keeps real carrier quotes and appends deduped fallback options instead of hiding fallback carriers when Melhor Envio returns data.
  - Work done 2026-05-22: flat-rate fallback exposes Correios PAC, Correios Sedex, and Transportadora Parceira; checkout fallback also generates all three options.
  - Work done 2026-05-22: checkout quick replies and widget cards display carrier, method, ETA, and price, so the buyer no longer sees a single generic "Envio Padrao".
  - Tests: API full suite green with 385 tests / 13 skipped; widget typecheck green; shipping/unit/full-flow expectations updated for the 3-option contract.

- `[x]` **TIM-T013 Cross-sell and coupon gate**
  - Requirements: TIM-R014, TIM-R015
  - Work done 2026-05-22: cross-sell suggestions are exposed through `experience.suggestedProducts` with stable suggestion ids instead of invalid chat actions.
  - Work done 2026-05-22: embed-scoped cross-sell accept validates session ownership, appends the accepted SKU to the checkout cart, recalculates totals, and appends an agent turn.
  - Work done 2026-05-22: coupon is now a pre-payment gate. The widget asks "Sim, tenho cupom" / "Nao tenho cupom"; the coupon input appears only after an explicit yes, and payment methods are released after skip/apply.
  - Work done 2026-05-22: public coupon apply persists `cart.currentDiscount` in the checkout session and returns an updated checkout experience, so cart and payment share the same discounted total.
  - Tests: API coupon/cross-sell regressions, widget coupon gate/cross-sell regressions, full widget suite, and focused Playwright real-api checkout gate.

- `[x]` **TIM-T014 Buyer hub profile hydration**
  - Requirements: TIM-R014, TIM-R015
  - Work done 2026-05-22: buyer login from checkout session hydrates missing/placeholder profile fields from verified session customer data.
  - Work done 2026-05-22: buyer hub profile inputs fall back to active checkout customer/session email when the wallet profile is not complete yet.
  - Tests: API buyer login hydration spec and widget `UserPanel` profile fallback regression.

## Running Verification

- `cmd /c pnpm --filter @aacp/api test` - passed 2026-05-22 after cross-sell/coupon/hub hydration, 387 tests, 13 skipped Prisma/env live tests.
- `cmd /c pnpm --filter @aacp/api typecheck` - passed 2026-05-22 after OTP paste/chat regression.
- `cmd /c pnpm --filter @aacp/api build` - passed 2026-05-21 after fixing `IntegrationsModule` auth dependency wiring.
- `cmd /c "set AACP_RUN_PRISMA_TESTS=1&& set DATABASE_URL=postgresql://postgres:postgres@localhost:55432/aacp_test&& pnpm --filter @aacp/api test:prisma"` - passed 2026-05-21, 23/23 including Prisma integrations repository spec.
- `cmd /c pnpm --filter @aacp/widget typecheck` - passed 2026-05-22 after cross-sell/coupon gate update.
- `cmd /c pnpm --filter @aacp/widget test` - passed 2026-05-22 after cross-sell/coupon/hub hydration update, 249 tests; sandbox needed escalated rerun for Vitest config access.
- `cmd /c pnpm --filter @aacp/dashboard typecheck` - passed 2026-05-21 after dashboard auth/shell correction.
- `cmd /c pnpm --filter @aacp/dashboard test` - passed 2026-05-21 after dashboard auth/shell correction, 13 tests; sandbox needed escalated rerun for Vitest config access.
- `cmd /c pnpm exec playwright test --project=widget-realapi --grep "real chat quotes"` from `apps/widget` - passed 2026-05-22, 1/1 focused scenario covering real chat freight quotes, cross-sell accept, coupon gate, cart update, and checkout continuation.
- `cmd /c "set CI=1&& set PORT=3000&& pnpm --filter @aacp/widget e2e:realapi -- --grep ..."` - passed 2026-05-21, 8/8 real-api tests including signed receiver/tracking/hub timeline scenario.
- `cmd /c "set CI=1&& set PORT=3000&& pnpm --filter @aacp/widget exec playwright test --project=widget-realapi --grep \"checkout emits tenant\""` - passed 2026-05-21, 1/1 focused scenario with signed `customer.upserted` and visible browser hub search/timeline assertions.
