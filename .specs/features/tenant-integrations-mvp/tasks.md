# Tenant Integrations MVP Tasks

## Status Legend

- `[ ]` Pending
- `[~]` In progress
- `[x]` Done

## Tasks

- `[x]` **TIM-T000 Commit prior checkpoint**
  - Requirement: source control hygiene
  - Verification: commit `84f79c7 feat(dashboard): add pilot metrics and local gates`

- `[~]` **TIM-T001 Source of truth docs**
  - Requirements: TIM-R001..TIM-R015
  - Work: create feature spec/design/tasks and update MVP gap doc.
  - Verification: docs created and staged; commit attempt was blocked by terminal approval and must be retried.

- `[~]` **TIM-T002 API key foundation**
  - Requirements: TIM-R001, TIM-R002, TIM-R012
  - Work done: Prisma model/migration, in-memory/Prisma repository, key generation/hash, API-key guard, dashboard-facing CRUD API routes for create/list/revoke.
  - Remaining: API-key issuing through professional embed route and Prisma live repository spec.
  - Tests: API unit green via `cmd /c pnpm --filter @aacp/api test`.

- `[~]` **TIM-T003 Webhook foundation**
  - Requirements: TIM-R003, TIM-R004, TIM-R005
  - Work done: endpoint/delivery Prisma models, in-memory/Prisma repository, HMAC signer, async delivery dispatcher, dashboard API routes for list/create/test/replay and delivery log.
  - Remaining: direct retry/replay unit coverage and dashboard UI.
  - Tests: signer and delivery creation covered in API suite.

- `[~]` **TIM-T004 Order/customer webhook events**
  - Requirements: TIM-R006, TIM-R007
  - Work done: `order.completed` domain events publish tenant `order.approved` and `customer.upserted` deliveries with order/items/totals/freight/customer/payment/tracking payload.
  - Remaining: test asserting checkout completion creates both tenant deliveries and signed HTTP delivery.

- `[~]` **TIM-T005 Tracking inbound and fulfillment persistence**
  - Requirements: TIM-R008, TIM-R009, TIM-R010
  - Work done: `PUT /integrations/orders/:external_order_id/tracking` with API key auth, checkout order lookup by external order id, shipment/tracking persistence models, dashboard shipment list API, API-key tracking timeline API, and tenant `order.tracking.updated` delivery.
  - Remaining: buyer hub read-model enrichment, Prisma live spec, and Playwright hub/search assertions.
  - Tests: API unit green for inbound tracking, shipment timeline, and webhook delivery enqueue.

- `[ ]` **TIM-T006 Dashboard operations**
  - Requirements: TIM-R011
  - Work: add Integracoes, Pedidos/Envios, Clientes, Embed pages and API client methods.
  - Tests: dashboard unit tests for render/submit/error states.

- `[ ]` **TIM-T007 Professional embed issuance**
  - Requirements: TIM-R012
  - Work: allow API key auth on `POST /embed-sessions`, add allowed origin/scopes/cart ref claims, document snippet.
  - Tests: controller/unit tests for JWT and API key issuance.

- `[ ]` **TIM-T008 Enterprise checkout theme**
  - Requirements: TIM-R013, TIM-R014
  - Work: extend theme DTO, validation, dashboard theme editor, widget CSS variables and premium visual pass.
  - Tests: theme validation, widget theme mapping, dashboard theme save.

- `[ ]` **TIM-T009 Full real-api gate**
  - Requirements: TIM-R015
  - Work: Playwright receiver/tracking scenario.
  - Tests: API, Prisma, widget, dashboard, and `full-checkout-real`.

## Running Verification

- `cmd /c pnpm --filter @aacp/api test` - passed 2026-05-21, 375 tests, 13 skipped Prisma/env live tests.
- `$env:AACP_RUN_PRISMA_TESTS='1'; $env:DATABASE_URL='postgresql://postgres:postgres@localhost:55432/aacp_test'; cmd /c pnpm --filter @aacp/api test:prisma`
- `cmd /c pnpm --filter @aacp/widget typecheck`
- `cmd /c pnpm --filter @aacp/widget test`
- `cmd /c pnpm --filter @aacp/dashboard typecheck`
- `cmd /c pnpm --filter @aacp/dashboard test`
- `cmd /c pnpm --filter @aacp/widget exec playwright test e2e/realapi/full-checkout-real.spec.ts --project=widget-realapi`
