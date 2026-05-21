# Finish MVP Gap Closure Tasks

**Design**: `.specs/features/finish-mvp-gap-closure/design.md`
**Status**: Done

**Progress**:

- T1 completed: gap inventory, spec, design, and task breakdown created.
- T2 completed: API now rejects payment before selected shipping; payment and embed E2E fixtures updated to respect the sequence.
- T3 completed: public shipping selection now persists the selected quote into checkout session state; Prisma JSON persistence covers selected paid/free shipping.
- T4 completed: commerce-backed payment now validates the trusted cart, creates/reuses one pending commerce order, and carries the commerce order reference into payment audit data.
- T5 completed: approved provider webhooks now mark linked commerce orders paid idempotently and keep post-approval commerce failures retryable.
- T6 completed: completed orders no longer invent fake tracking codes; real codes can be attached after completion and buyer hub shows pending/searchable tracking states.
- T7 completed: unresolved support messages create support ticket/handoff records, the widget shows the protocol, and dashboard support can list/update ticket status.
- T8 completed: public coupon apply now requires embed auth and merchant/session ownership; widget public API responses are parsed with runtime schemas before render; merchant embed bootstrap no longer injects default freight; `full-checkout-real` Playwright gate is stable.
- T9 completed: dashboard overview shows pilot metrics and the documented API/widget/dashboard/Prisma/Playwright gates passed locally.

---

## Execution Plan

### Phase 1: Product Safety Foundation

```
T1 -> T2 -> T3
```

### Phase 2: Provider and Commerce Lifecycle

```
T3 -> T4 -> T5 -> T6
```

### Phase 3: Operator Surfaces and Hardening

```
T6 -> T7 -> T8 -> T9
```

---

## Task Breakdown

### T1: Document MVP Gaps

**What**: Create the gap inventory and SDD feature spec/design/tasks for MVP closure.
**Where**: `.specs/features/finish-mvp-gap-closure/*`, `docs/product/mvp-gap-closure.md`
**Depends on**: None
**Reuses**: `.specs/project/ROADMAP.md`, `.specs/project/STATE.md`
**Requirement**: MVP-CLOSE-01 through MVP-CLOSE-08

**Tools**:

- MCP: none
- Skill: `tlc-spec-driven`

**Status**: Done

**Done when**:

- [x] Gap document identifies product, integration, testing, and hardening gaps.
- [x] Requirements have traceable IDs.
- [x] This task list maps every requirement to an execution slice.

**Tests**: none
**Gate**: documentation review

---

### T2: Enforce Selected Shipping Before Payment

**What**: Reject payment intent creation when a checkout session with cart items has no selected shipping.
**Where**: `apps/api/src/modules/payment/application/create-payment-intent.use-case.ts`, `apps/api/src/modules/payment/application/create-payment-intent.use-case.spec.ts`
**Depends on**: T1
**Reuses**: existing `CreatePaymentIntentUseCase` and in-memory checkout/payment test fixtures.
**Requirement**: MVP-CLOSE-01

**Tools**:

- MCP: none
- Skill: `tlc-spec-driven`

**Status**: Done

**Done when**:

- [x] API throws `shipping_method_required_before_payment` before creating provider payment.
- [x] Existing payment amount behavior still includes selected shipping and discount.
- [x] Free shipping remains allowed when `session.shipping` is present.
- [x] Gate check passes: `cmd /c pnpm --filter @aacp/api test -- create-payment-intent.use-case.spec.ts`

**Verify**:

- `cmd /c pnpm --filter @aacp/api test -- create-payment-intent.use-case.spec.ts`
- Result: 352 tests, 339 passed, 13 skipped, 0 failed.

**Tests**: unit
**Gate**: quick

---

### T3: Persist Shipping Selection in Prisma Flow

**What**: Verify and complete Prisma persistence for selected shipping, including zero-price free shipping.
**Where**: shipping use case, checkout repository, Prisma integration tests.
**Depends on**: T2
**Reuses**: `SelectShippingMethodUseCase`, `PrismaCheckoutRepository`.
**Requirement**: MVP-CLOSE-04

**Status**: Done

**Done when**:

- [x] Selected quote persists and reloads from Prisma.
- [x] Payment guard passes after selected quote is persisted.
- [x] Prisma integration test covers paid/free shipping.

**Verify**:

- `cmd /c pnpm --filter @aacp/api test -- shipping.use-cases.spec.ts`
- Result: 354 tests, 341 passed, 13 skipped, 0 failed.
- `cmd /c "set DATABASE_URL=postgresql://test:test@localhost:5432/test&& node --input-type=module -e ..."`
- Result: `AppModule boot ok`.

**Tests**: integration
**Gate**: full

---

### T4: Wire Commerce Pending Order Before Provider Payment

**What**: Validate commerce cart and create/reuse pending commerce order before provider payment creation.
**Where**: commerce module/application and payment lifecycle wiring.
**Depends on**: T3
**Reuses**: `ValidateCartForPaymentUseCase`, `SyncPendingOrderUseCase`.
**Requirement**: MVP-CLOSE-03

**Status**: Done

**Done when**:

- [x] Commerce-backed checkout validates cart server-side.
- [x] One pending commerce order is linked to one merchant/session.
- [x] Provider payment includes an audit reference to the pending commerce order.

**Verify**:

- `cmd /c pnpm --filter @aacp/api test -- create-payment-intent.use-case.spec.ts`
- Result: 356 tests, 343 passed, 13 skipped, 0 failed.
- AppModule boot with dummy `DATABASE_URL`: `AppModule boot ok`.
- `cmd /c pnpm --filter @aacp/widget test`
- Result: 18 files, 239 tests passed. First sandbox run hit Windows permission `Acesso negado`; rerun with approved escalation passed.

**Tests**: integration
**Gate**: full

---

### T5: Mark Commerce Order Paid After Provider Approval

**What**: On approved payment, mark linked commerce order paid idempotently.
**Where**: payment webhook/use-case handler and commerce use case wiring.
**Depends on**: T4
**Reuses**: `MarkCommerceOrderPaidUseCase`, payment webhook dedup.
**Requirement**: MVP-CLOSE-02, MVP-CLOSE-03

**Status**: Done

**Done when**:

- [x] Approved webhook completes checkout and marks commerce order paid once.
- [x] Duplicate webhook does not duplicate checkout or commerce sync.
- [x] Commerce failure remains retryable and auditable.

**Verify**:

- `cmd /c pnpm --filter @aacp/api test`
- Result: 359 tests, 346 passed, 13 skipped, 0 failed.
- AppModule boot with dummy `DATABASE_URL`: `AppModule boot ok`.
- `cmd /c pnpm --filter @aacp/widget test`
- Result: 18 files, 239 tests passed. First sandbox run hit Windows permission `Acesso negado`; rerun with approved escalation passed.

**Tests**: integration
**Gate**: full

---

### T6: Complete Tracking Lifecycle

**What**: Provide an operator/API path to attach or sync tracking code and make buyer hub search it.
**Where**: completed order API/repository, buyer hub API, widget `UserPanel`.
**Depends on**: T5
**Reuses**: completed order tracking field and buyer purchase query.
**Requirement**: MVP-CLOSE-04, MVP-CLOSE-05

**Status**: Done

**Implementation notes**:

- Completed orders must not invent synthetic `TRK-*` codes. Missing carrier tracking remains `null`/pending.
- `PATCH /orders/tracking` records the real tracking code after fulfillment/provider sync and emits `order.tracking.updated`.
- Buyer hub already searches `tracking_code`; tests must cover pending and searchable states.

**Done when**:

- [x] Tracking code can be added or synced after order completion.
- [x] Buyer hub shows pending tracking until code exists.
- [x] Buyer hub search finds order by tracking code.

**Verify**:

- `cmd /c pnpm --filter @aacp/api test`
- Result: 364 tests, 351 passed, 13 skipped, 0 failed.
- `cmd /c pnpm --filter @aacp/widget test`
- Result: 18 files, 240 tests passed. First sandbox run hit Windows permission `Acesso negado`; rerun with approved escalation passed.
- AppModule boot with dummy `DATABASE_URL`: `AppModule boot ok`.

**Tests**: API unit/integration and widget unit/e2e
**Gate**: full

---

### T7: Add Support Handoff/Ticket State

**What**: Persist unresolved support requests and surface them for buyer and merchant operation.
**Where**: support module, dashboard support page, widget support panel.
**Depends on**: T1
**Reuses**: support FAQ/chat settings.
**Requirement**: MVP-CLOSE-05, MVP-CLOSE-06

**Status**: Done

**Implementation notes**:

- FAQ matches stay immediate and do not create operational tickets.
- Unanswered support creates `support_tickets` with merchant/session scope, open status, and buyer-visible protocol.
- Dashboard support surface reads `/support/tickets` and updates status through `/support/tickets/:ticketId`.

**Done when**:

- [x] FAQ matches still answer immediately.
- [x] Unresolved support creates a ticket/handoff record.
- [x] Dashboard can list and update ticket status.
- [x] Gate checks pass and T7 is committed.

**Verify**:

- `cmd /c pnpm --filter @aacp/api test`
- Result: 369 tests, 356 passed, 13 skipped, 0 failed.
- `cmd /c pnpm --filter @aacp/dashboard typecheck`
- Result: passed.
- `cmd /c pnpm --filter @aacp/dashboard test`
- Result: 1 file, 7 tests passed. First sandbox run hit Windows permission `Acesso negado`; rerun with approved escalation passed.
- `cmd /c pnpm --filter @aacp/widget test`
- Result: 18 files, 242 tests passed. First sandbox run hit Windows permission `Acesso negado`; rerun with approved escalation passed.
- AppModule boot with dummy `DATABASE_URL`: `AppModule boot ok`.

**Tests**: API unit/integration, dashboard component, widget e2e
**Gate**: full

---

### T8: Secure Embed and Runtime Validation

**What**: Remove sensitive browser payload assumptions and validate public API responses before render.
**Where**: embed controllers, widget schemas, bootstrap/config.
**Depends on**: T2
**Reuses**: existing secure embed token and widget schemas.
**Requirement**: MVP-CLOSE-07

**Status**: Done

**Implementation Notes**:

- `/embed/coupons/apply` now uses `EmbedAuthGuard` and verifies the checkout session belongs to the merchant in the embed token.
- Coupon application ignores browser-supplied `merchant_id`; merchant scope comes from the signed embed token.
- `checkoutJson` can parse responses through runtime schemas before returning payloads to UI hooks.
- Widget start, tracking, chat, offer, coupon, payment, and product-cart responses now use zod response schemas.
- Runtime customer schema accepts the backend's empty address complement for "sem complemento" answers.
- Merchant embed defaults no longer include selected shipping; freight remains pending until quote/selection happens in checkout.
- Real-api Playwright harness uses `cmd /c`, API `PORT=3000`, memory repositories, product query params, explicit support/coupon/full-checkout coverage, and serial UI execution for stable local gates.

**Done when**:

- [x] Public endpoints reject invalid/expired merchant-mismatched token.
- [x] Widget renders only validated response shapes.
- [x] Sensitive fields stay server-side.

**Tests**: API unit/e2e and widget schema tests
**Gate**: full

**Verified**:

- `cmd /c pnpm --filter @aacp/api test`
- Result: 371 tests, 358 passed, 13 skipped.
- `cmd /c pnpm --filter @aacp/widget typecheck`
- Result: passed.
- `cmd /c pnpm --filter @aacp/widget test`
- Result: 18 files, 244 tests passed. Run required approved Windows escalation after sandbox `Acesso negado`.
- `cmd /c pnpm --filter @aacp/widget test -- src/__tests__/widget-schemas.test.ts src/__tests__/use-checkout-chat.test.ts`
- Result: 2 files, 14 tests passed.
- `cmd /c pnpm --filter @aacp/widget exec playwright test e2e/realapi/full-checkout-real.spec.ts --project=widget-realapi`
- Result: 7 tests passed after fixing runtime schema and serializing the UI block.
- AppModule boot with dummy `DATABASE_URL`: `AppModule boot ok`.
- `git diff --check`
- Result: passed with line-ending warnings only.
- Remaining T9 work: dashboard pilot metrics and clean-stack gate documentation beyond the focused full-checkout real-api run.

---

### T9: Pilot Gates and Dashboard Metrics

**What**: Add operator metrics and CI-ready gate commands for pilot readiness.
**Where**: dashboard overview, API metrics/read models, CI/docs.
**Depends on**: T5
**Reuses**: dashboard overview read model and observability service.
**Requirement**: MVP-CLOSE-06, MVP-CLOSE-08

**Status**: In Progress

**Progress**:

- Focused `full-checkout-real` Playwright gate passes against local API/widget stack.
- Dashboard overview now shows pilot metrics for completed orders, conversion, offer acceptance, selected/pending freight, support tickets, and attributed revenue.
- Local gate docs now list API, widget, dashboard, Prisma, and Playwright commands.
- Clean local database Prisma gate passed with explicit `AACP_RUN_PRISMA_TESTS=1` and `DATABASE_URL`.

**Done when**:

- [x] Dashboard shows completed orders, conversion, offers, support, and shipping metrics.
- [x] CI/local gate docs list API, widget, Prisma, and Playwright commands.
- [x] Full gate is repeatable from a clean local database.

**Tests**: API/dashboard/widget tests and Playwright real-api
**Gate**: build

**Verified**:

- `cmd /c pnpm --filter @aacp/dashboard typecheck`
- Result: passed.
- `cmd /c pnpm --filter @aacp/dashboard test`
- Result: 2 files, 9 tests passed.
- `cmd /c pnpm --filter @aacp/widget exec playwright test e2e/realapi/full-checkout-real.spec.ts --project=widget-realapi`
- Result: 7 tests passed.
- `cmd /c pnpm db:up`
- Result: Postgres container running.
- `cmd /c pnpm db:migrate`
- Result: all Prisma migrations applied successfully.
- `$env:AACP_RUN_PRISMA_TESTS='1'; $env:DATABASE_URL='postgresql://postgres:postgres@localhost:55432/aacp_test'; cmd /c pnpm --filter @aacp/api test:prisma`
- Result: 22 tests passed, 0 skipped.

---

## Validation Tables

### Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | documentation slice | OK |
| T2 | one payment precondition | OK |
| T3 | one persistence invariant | OK |
| T4 | one commerce pre-payment link | OK |
| T5 | one commerce post-payment link | OK |
| T6 | one tracking lifecycle slice | OK |
| T7 | one support handoff slice | OK |
| T8 | one secure embed validation slice | OK |
| T9 | one pilot gate/dashboard slice | OK |

### Diagram-Definition Cross-Check

| Task | Depends On | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | start | OK |
| T2 | T1 | T1 -> T2 | OK |
| T3 | T2 | T2 -> T3 | OK |
| T4 | T3 | T3 -> T4 | OK |
| T5 | T4 | T4 -> T5 | OK |
| T6 | T5 | T5 -> T6 | OK |
| T7 | T1 | T1 -> T7 allowed as Phase 3 work | OK |
| T8 | T2 | T2 -> T8 allowed after payment guard | OK |
| T9 | T5 | T5 -> T9 | OK |

### Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | docs | none | none | OK |
| T2 | API use case | unit | unit | OK |
| T3 | API persistence | integration | integration | OK |
| T4 | API integration | integration | integration | OK |
| T5 | API integration | integration | integration | OK |
| T6 | API + widget | unit/e2e | API unit/integration and widget unit/e2e | OK |
| T7 | API + dashboard + widget | integration/e2e | API unit/integration, dashboard component, widget e2e | OK |
| T8 | API + widget | unit/e2e | API unit/e2e and widget schema tests | OK |
| T9 | API + dashboard + CI docs | build/full | API/dashboard/widget tests and Playwright real-api | OK |
