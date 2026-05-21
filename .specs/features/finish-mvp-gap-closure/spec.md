# Finish MVP Gap Closure Specification

## Problem Statement

The checkout flow now has a tested local happy path, but the application is not yet a pilot-ready MVP. Several critical seams still depend on in-memory state, fake providers, partial integrations, or UI-only assumptions. This feature closes those gaps with traceable, testable slices so the app can move from local demo to merchant pilot.

## Goals

- [ ] Make the real checkout sequence enforceable on the server, not only in the widget.
- [ ] Replace happy-path fake seams with Prisma-backed, provider-backed flows where credentials exist.
- [ ] Connect payment approval, commerce order sync, shipping selection, tracking, buyer hub, support, and dashboard metrics into one auditable lifecycle.
- [ ] Keep every closing slice covered by unit, integration, or Playwright tests.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Advanced logistics optimization | MVP needs reliable quote/selection/tracking, not a full TMS. |
| Omnichannel recovery | Useful after checkout/payment/commerce lifecycle is stable. |
| ML scoring | Deterministic scoring is enough for MVP validation. |
| Full marketplace multi-store OAuth | First pilot can use configured merchant credentials. |

---

## User Stories

### P1: Enforced Checkout Sequence MVP

**User Story**: As a buyer, I want the checkout to only let me pay after required shipping and cart facts are settled so that I am not charged the wrong amount.

**Why P1**: The original bug involved freight state and checkout completion. The server must reject invalid payment attempts even if a client bypasses the UI.

**Acceptance Criteria**:

1. WHEN a physical cart has no selected shipping on the checkout session THEN the API SHALL reject payment intent creation.
2. WHEN shipping is selected THEN the API SHALL charge product total plus selected shipping minus authorized discount.
3. WHEN payment is approved THEN the checkout SHALL complete exactly once for the merchant/session/payment reference.

**Independent Test**: API payment use-case tests can create a session without shipping and assert `shipping_method_required_before_payment`; the full Playwright flow can still complete after selecting shipping.

---

### P1: Real Provider Payment Lifecycle MVP

**User Story**: As a merchant, I want buyer payments to be created and confirmed by a real payment provider so that completed orders reflect actual payment state.

**Why P1**: A pilot cannot rely on fake auto-approval except for deterministic E2E.

**Acceptance Criteria**:

1. WHEN Asaas credentials are configured THEN payment intent creation SHALL use Asaas for Pix/card paths that belong to Asaas.
2. WHEN Asaas sends an approved webhook THEN the payment repository SHALL mark the intent approved idempotently.
3. WHEN a duplicate webhook arrives THEN the checkout SHALL not complete twice.
4. WHEN provider value does not match the intent amount THEN the payment SHALL fail and the checkout SHALL not complete.

**Independent Test**: Existing webhook tests plus a Prisma-backed E2E can prove idempotency and completion.

---

### P1: Commerce Order Sync MVP

**User Story**: As a merchant, I want AACP to create a pending commerce order and mark it paid only after provider approval so that my store remains the operational source of fulfillment.

**Why P1**: The current commerce use cases exist but are not yet part of the main checkout lifecycle.

**Acceptance Criteria**:

1. WHEN payment is about to start for a commerce-backed cart THEN the API SHALL validate the cart against the commerce adapter.
2. WHEN validation passes THEN the API SHALL create or reuse one pending commerce order for the checkout session.
3. WHEN payment is approved THEN the API SHALL mark the commerce order paid idempotently.
4. WHEN commerce sync fails after payment approval THEN the order SHALL remain recoverable through an auditable retry path.

**Independent Test**: Commerce application tests plus one payment-approved lifecycle test can verify pending-order creation and paid sync.

---

### P1: Shipping Quote, Selection, and Tracking MVP

**User Story**: As a buyer, I want to select a real shipping option and later see tracking in the hub so that delivery state is clear.

**Why P1**: Freight is central to the product and was one of the reported broken areas.

**Acceptance Criteria**:

1. WHEN the buyer provides a CEP THEN the API SHALL quote shipping from the configured origin ZIP and cart package data.
2. WHEN the buyer selects a shipping option THEN the session SHALL persist that exact option.
3. WHEN tracking code becomes available THEN the buyer hub SHALL show it and allow searching by it.
4. WHEN no tracking code exists THEN the hub SHALL show an explicit pending state.

**Independent Test**: API quote/selection tests and Playwright buyer hub tests verify selected freight and tracking display.

---

### P1: Buyer Hub and Support MVP

**User Story**: As a buyer, I want account, order, support, and tracking surfaces to work from the checkout widget so that I do not need merchant-side support for basic post-purchase questions.

**Why P1**: Hub and support were reported as broken or incomplete.

**Acceptance Criteria**:

1. WHEN a buyer opens the hub THEN it SHALL use buyer-scoped APIs, not merchant hub APIs.
2. WHEN purchases exist THEN the hub SHALL show merchant, order ID, tracking, and status context.
3. WHEN a support FAQ matches the buyer question THEN support SHALL answer from configured FAQ.
4. WHEN support cannot answer from FAQ THEN support SHALL create or route a handoff/ticket instead of silently failing.

**Independent Test**: Widget tests and real-api Playwright support/hub tests cover the visible behavior.

---

### P2: Merchant Dashboard Operational MVP

**User Story**: As a merchant, I want dashboard pages for rules, shipping, support, orders, and metrics so that I can operate the pilot without database edits.

**Why P2**: The dashboard exists, but operational coverage is incomplete.

**Acceptance Criteria**:

1. WHEN a merchant updates checkout/shipping/support rules THEN changes SHALL persist through Prisma.
2. WHEN orders complete THEN dashboard metrics SHALL reflect conversion and recovered revenue.
3. WHEN support handoffs exist THEN the dashboard SHALL show open and closed cases.

**Independent Test**: Dashboard API client tests and dashboard component tests verify persisted settings and metrics rendering.

---

### P2: Secure Embed Production Readiness

**User Story**: As a merchant, I want the browser embed to carry only a signed token and public UI configuration so that sensitive cart, cost, margin, and provider secrets never leak.

**Why P2**: Security is mandatory for pilot expansion, but the first local cycle can still use fixture data for E2E.

**Acceptance Criteria**:

1. WHEN the widget starts THEN it SHALL use an embed token for public checkout endpoints.
2. WHEN token is missing, invalid, expired, or merchant-mismatched THEN public endpoints SHALL reject the request.
3. WHEN the widget receives API responses THEN runtime validation SHALL reject malformed payloads before rendering.

**Independent Test**: Embed controller tests and widget schema tests verify token and response validation.

---

### P3: Post-MVP Hardening

**User Story**: As the engineering team, we want observability, outbox workers, tenant context, and CI gates so that pilot issues can be diagnosed and releases are safe.

**Why P3**: This makes the app production-resilient but does not block the first functional pilot.

**Acceptance Criteria**:

1. WHEN critical flows run THEN structured logs and correlation IDs SHALL be available.
2. WHEN domain events are emitted THEN durable outbox workers SHALL retry safely.
3. WHEN CI runs THEN API, widget, Prisma, and Playwright gates SHALL execute.

---

## Edge Cases

- WHEN a buyer attempts payment before selecting shipping THEN the API SHALL reject the request with a clear business error.
- WHEN selected shipping is free THEN payment SHALL still be allowed because a shipping option exists.
- WHEN payment provider approval is duplicated THEN checkout, purchase history, and commerce sync SHALL remain idempotent.
- WHEN commerce provider is down after payment approval THEN the failure SHALL be retryable and visible to operators.
- WHEN tracking code is unavailable THEN hub SHALL show pending tracking without implying fulfillment has started.
- WHEN support FAQ is empty THEN support SHALL fall back to handoff/ticket behavior.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MVP-CLOSE-01 | P1: Enforced Checkout Sequence | Execute | Verified |
| MVP-CLOSE-02 | P1: Real Provider Payment Lifecycle | Execute | Partially Verified |
| MVP-CLOSE-03 | P1: Commerce Order Sync | Execute | Verified |
| MVP-CLOSE-04 | P1: Shipping Quote, Selection, and Tracking | Execute | Partially Verified |
| MVP-CLOSE-05 | P1: Buyer Hub and Support | Tasks | Pending |
| MVP-CLOSE-06 | P2: Merchant Dashboard Operational MVP | Tasks | Pending |
| MVP-CLOSE-07 | P2: Secure Embed Production Readiness | Tasks | Pending |
| MVP-CLOSE-08 | P3: Post-MVP Hardening | Tasks | Pending |

**Coverage:** 8 total, 8 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] A buyer can complete a real-api Playwright checkout only after selecting shipping.
- [ ] API rejects invalid payment attempts that bypass the widget sequence.
- [ ] Payment approval completes checkout idempotently.
- [ ] Buyer hub shows completed purchases and tracking state.
- [ ] Support answers FAQ and exposes a handoff path.
- [ ] Merchant dashboard can operate pilot settings without direct database changes.
- [ ] Full gates pass: API typecheck/test, widget typecheck/test, Playwright real-api.
