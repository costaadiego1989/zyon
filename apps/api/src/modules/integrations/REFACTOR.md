# REFACTOR.md — Integrations Module

## Summary

The integrations module manages API key lifecycle, webhook endpoint CRUD, webhook
delivery dispatch (inline + poller), tenant tracking, and event fan-out for
`order.completed`. Architecture is generally sound (Clean Architecture layers,
ports/adapters, domain services), but several CRITICAL security gaps and
structural issues remain.

---

## Findings

### CRITICAL

#### INT-C1 — SSRF via DNS rebinding (TOCTOU in webhook dispatch)

- **File:** `infrastructure/dns-webhook-target-policy.ts`, `application/webhook-delivery-dispatcher.service.ts`
- **Category:** Security
- **Description:** `DnsWebhookTargetPolicy.assertAllowed()` resolves the hostname,
  validates IPs are public unicast, then returns the original URL string. The
  dispatcher calls `fetch(endpointUrl)` which performs an independent DNS
  resolution. An attacker controlling their DNS can return a public IP during
  validation and a private/link-local IP (`169.254.169.254`, `10.x`, `127.0.0.1`)
  during the actual fetch — classic TOCTOU DNS rebinding.
- **Impact:** SSRF from API egress; cloud metadata credential exfiltration, VPC
  port-scanning, internal service access. Any merchant can trigger via a normal
  webhook endpoint + background dispatcher.
- **Remediation:** `assertAllowed` must return `{ url, pinnedAddresses }`.
  Dispatcher must use a custom `http(s).Agent` with a `lookup` override that
  only delivers the pre-validated addresses. Re-validate on every delivery
  attempt (addresses may rotate).

#### INT-C2 — Webhook delivery duplicate dispatch (no atomic claim before ADR-0002 fix)

- **File:** `application/webhook-delivery-dispatcher.service.ts`, `application/integrations.use-cases.ts`
- **Category:** Concurrency / Reliability
- **Description:** The dispatcher now has a `claimWebhookDelivery` call
  (`pending -> sending`), but `TenantWebhookPublisher.publish()` creates
  deliveries with `status: "pending"` and `nextAttemptAt: now`. The inline
  dispatch from the event handler races with the poller's `listDueWebhookDeliveries`
  which queries `["pending", "sending"]`. If the claim implementation is not
  truly atomic (`UPDATE ... WHERE status = 'pending' RETURNING *`), two workers
  can both read the row as pending and proceed.
- **Impact:** Duplicate webhook POSTs to merchants for the same `event_id`.
- **Remediation:** Verify Prisma claim uses `updateMany` with `where: { id, status: 'pending' }`
  and checks `count === 1`. Alternatively, remove inline dispatch entirely and
  rely solely on the poller with atomic claim.

---

### HIGH

#### INT-H1 — God file: `application/integrations.use-cases.ts`

- **File:** `application/integrations.use-cases.ts`
- **Category:** SOLID (SRP), Maintainability
- **Description:** Single file contains 15+ injectable use-case classes:
  `CreateMerchantApiKeyUseCase`, `ListMerchantApiKeysUseCase`,
  `RevokeMerchantApiKeyUseCase`, `RotateMerchantApiKeyUseCase`,
  `UpsertWebhookEndpointUseCase`, `GetWebhookEndpointUseCase`,
  `RotateWebhookSigningSecretUseCase`, `ListWebhookEndpointsUseCase`,
  `TenantWebhookPublisher`, `ListWebhookDeliveriesUseCase`,
  `GetWebhookDeliveryUseCase`, `ReplayWebhookDeliveryUseCase`,
  `TestWebhookEndpointUseCase`, `UpdateTenantOrderTrackingUseCase`,
  `GetTrackingTimelineUseCase`, `ListTenantShipmentsUseCase`, plus helper
  functions. This violates SRP and makes navigation/testing difficult.
- **Remediation:** Split into cohesive files:
  - `api-key.use-cases.ts` (create, list, revoke, rotate)
  - `webhook-endpoint.use-cases.ts` (upsert, get, list, rotate-secret, test)
  - `webhook-delivery.use-cases.ts` (publisher, list, get, replay)
  - `tenant-tracking.use-cases.ts` (update tracking, get timeline, list shipments)

#### INT-H2 — Non-deterministic `event_id` causes duplicate deliveries on redelivery

- **File:** `application/integrations.use-cases.ts` (`TenantWebhookPublisher`)
- **Category:** Idempotency / Reliability
- **Description:** `publish()` generates `event_id: evt_${randomUUID()}` on every
  call. The delivery upsert deduplicates on `(endpointId, eventId)`, but since
  `event_id` is always new, redelivery of the same domain event produces new
  deliveries every time.
- **Impact:** If the event bus redelivers `order.completed` (at-least-once),
  merchants receive duplicated webhook events.
- **Remediation:** Derive `event_id` deterministically from source data (e.g.,
  `hash(merchantId + externalOrderId + eventType)`) or accept a caller-supplied
  idempotency key.

#### INT-H3 — Signing secret stored in delivery record

- **File:** `application/integrations.use-cases.ts` (`TenantWebhookPublisher`)
- **Category:** Security
- **Description:** `saveWebhookDelivery` persists `signingSecret` in plaintext
  alongside the delivery record. The delivery table is queryable via list/get
  endpoints. Even if the API redacts it, the secret is at rest in a general-purpose
  table expanding the attack surface.
- **Impact:** Any DB read (backup, log, injection) leaks the per-endpoint
  signing secret.
- **Remediation:** Do not persist `signingSecret` in the delivery row. The
  dispatcher should look up the endpoint's current secret at dispatch time.

#### INT-H4 — `integrations.use-cases.ts` imports from `checkout` module

- **File:** `application/integrations.use-cases.ts`
- **Category:** Strong Coupling / Architecture
- **Description:** Imports `CHECKOUT_SESSION_REPOSITORY`, `ORDER_REPOSITORY`,
  `UpdateOrderTrackingUseCase` from the checkout module. This creates a
  bidirectional dependency between integrations and checkout, violating the
  dependency direction rule.
- **Remediation:** The tracking use-cases that need checkout data should either:
  (a) live in checkout and be re-exported, or (b) use a domain event / query
  port abstraction instead of direct repository injection.

#### INT-H5 — Webhook delivery listing filters in memory after merchant-wide limit

- **File:** `application/integrations.use-cases.ts`, `presentation/http/webhook-endpoints.controller.ts`
- **Category:** Bug / Performance
- **Description:** `GET /webhook-endpoints/:id/deliveries` calls
  `listDeliveries(merchantId, limit=100)` then filters by `endpointId` in
  memory. For merchants with many endpoints, the target endpoint's deliveries
  may be absent from the first 100 rows. Pagination returns `has_more: false`
  falsely.
- **Impact:** Merchants cannot reliably view deliveries for a specific endpoint.
- **Remediation:** Add `listWebhookDeliveriesByEndpoint(merchantId, endpointId, cursor, limit)`
  to the repository port with SQL-level filtering.

---

### MEDIUM

#### INT-M1 — `setInterval` poller is not distributed-safe

- **File:** `application/webhook-delivery-dispatcher.service.ts`
- **Category:** Scalability / KISS violation
- **Description:** Uses `setInterval(10s)` within the NestJS process. In a
  multi-instance deployment, every replica runs its own poller. The atomic claim
  mitigates double-dispatch but wastes DB queries proportional to replica count.
  No leader election or distributed lock.
- **Impact:** Wasted DB load at scale; potential thundering herd on due deliveries.
- **Remediation:** Use a distributed job queue (BullMQ, pg-boss) or add a
  `pg_advisory_lock` / `FOR UPDATE SKIP LOCKED` pattern to the poller query.

#### INT-M2 — `TestWebhookEndpointUseCase` performs real HTTP call without timeout cap

- **File:** `application/integrations.use-cases.ts`
- **Category:** Reliability / DoS
- **Description:** `testWebhookEndpoint` calls `fetch(url)` with no explicit
  timeout. A slow-responding endpoint can hold the request thread indefinitely.
- **Impact:** Resource exhaustion under malicious or misconfigured endpoints.
- **Remediation:** Add `AbortSignal.timeout(10_000)` to the fetch call.

#### INT-M3 — `IntegrationsController` is a god controller

- **File:** `presentation/http/integrations.controller.ts`
- **Category:** SRP / Maintainability
- **Description:** Single controller handles API keys, webhook endpoints,
  webhook deliveries, and shipments. 10+ route handlers injecting 10+ use-cases.
- **Remediation:** Already partially split (WebhookEndpointsController,
  TenantTrackingController exist). Complete the split by extracting
  `ApiKeysController` and `WebhookDeliveriesController`.

#### INT-M4 — No rate limiting on API key creation/rotation

- **File:** `presentation/http/integrations.controller.ts`
- **Category:** Security
- **Description:** `POST /integrations/api-keys` and `POST .../rotate` have no
  rate limit beyond idempotency. A compromised console session can generate
  unlimited keys.
- **Impact:** Key sprawl; harder revocation surface.
- **Remediation:** Add per-merchant rate limit (e.g., max 20 active keys).

#### INT-M5 — DRY violation in helper functions

- **File:** `application/integrations.use-cases.ts`
- **Category:** DRY
- **Description:** `toApiKeyPublic`, `toEndpointPublic`, `toDeliveryPublic`,
  `sanitizeScopes`, `sanitizeName`, `parseFutureExpiry` are utility functions
  embedded in the massive use-case file and not reusable by tests or other
  modules.
- **Remediation:** Extract to `domain/integrations.mappers.ts` and
  `domain/integrations.validators.ts`.

#### INT-M6 — `TenantWebhooksOnCheckoutHandler` mixes infrastructure with application logic

- **File:** `infrastructure/event-handlers/tenant-webhooks-on-checkout.handler.ts`
- **Category:** Architecture / Layer violation
- **Description:** The handler subscribes to domain events (infrastructure
  concern) but also orchestrates multiple repository calls and fan-out
  publishing (application concern). It injects `CheckoutSessionRepository` and
  `OrderRepository` directly.
- **Remediation:** Extract an application-layer service
  `HandleOrderCompletedWebhooksUseCase` that receives the event payload and
  orchestrates the fan-out. The handler becomes a thin infrastructure adapter.

---

### LOW

#### INT-L1 — Magic numbers in backoff calculation

- **File:** `application/webhook-delivery-dispatcher.service.ts`
- **Category:** KISS / Readability
- **Description:** Backoff delays are `[10, 60, 300, 1800, 3600]` seconds
  hardcoded inline in `retryOrFail`.
- **Remediation:** Extract to a named constant array with documentation.

#### INT-L2 — `request as { user?: unknown }` / `request as { apiKey?: unknown }` casts

- **File:** `presentation/http/integrations.controller.ts`, `presentation/http/tenant-tracking.controller.ts`
- **Category:** Type safety
- **Description:** Multiple controllers cast `request` to ad-hoc types instead
  of using a typed request interface.
- **Remediation:** Define `AuthenticatedRequest` / `ApiKeyRequest` interfaces
  and use `@Req() request: ApiKeyRequest`.

#### INT-L3 — No webhook event versioning strategy

- **File:** `domain/integrations.types.ts`
- **Category:** Extensibility
- **Description:** `api_version: "2026-05-21"` is hardcoded. No mechanism to
  support multiple API versions concurrently or migrate merchants.
- **Remediation:** Design a versioned envelope strategy with per-endpoint
  version configuration.

#### INT-L4 — In-memory repository duplicates mapping logic

- **File:** `infrastructure/in-memory-integrations.repository.ts`
- **Category:** DRY
- **Description:** The in-memory repo reimplements filtering, sorting, and
  field mapping that mirrors the Prisma repo. Changes to one are easily
  forgotten in the other.
- **Remediation:** Accept this as inherent to test doubles, but add shared
  integration-level contract tests (already partially done in int-spec).

---

## Priority Execution Order

1. **INT-C1** — SSRF fix (pin resolved IP to fetch agent)
2. **INT-C2** — Verify atomic claim implementation in Prisma repo
3. **INT-H3** — Remove signing secret from delivery persistence
4. **INT-H2** — Deterministic event_id derivation
5. **INT-H1** — Split god use-case file
6. **INT-H4** — Decouple checkout dependency
7. **INT-H5** — SQL-level delivery filtering by endpoint
8. **INT-M1** — Distributed poller or job queue
9. **INT-M6** — Extract event handler application logic
10. Remaining MEDIUM/LOW items
