# Webhook Delivery System Audit

Scope: tenant-to-merchant outbound webhooks in `apps/api/src/modules/integrations`.
Date: 2026-07-14.
Auditor: integrations module, code-level review.

## Files Audited

- `apps/api/src/modules/integrations/application/webhook-delivery-dispatcher.service.ts`
- `apps/api/src/modules/integrations/application/integrations.use-cases.ts` (`TenantWebhookPublisher`, `RotateWebhookSigningSecretUseCase`, `ReplayWebhookDeliveryUseCase`, `TestWebhookEndpointUseCase`, `UpdateTenantOrderTrackingUseCase`)
- `apps/api/src/modules/integrations/domain/webhook-signature.service.ts`
- `apps/api/src/modules/integrations/domain/ports/webhook-target-policy.port.ts`
- `apps/api/src/modules/integrations/infrastructure/dns-webhook-target-policy.ts`
- `apps/api/src/modules/integrations/infrastructure/event-handlers/tenant-webhooks-on-checkout.handler.ts`
- `apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts`
- `apps/api/src/modules/integrations/domain/integrations.types.ts`
- `apps/api/prisma/schema.prisma` (`MerchantWebhookEndpoint`, `MerchantWebhookDelivery`)

## 1. Compliance Matrix

Legend: PASS = meets best practice, PARTIAL = implemented with caveats, GAP = missing.

| Area | Requirement | Status | Evidence / Location |
| --- | --- | --- | --- |
| Signing algorithm | HMAC-SHA256 of `${timestamp}.${body}` | PASS | `webhook-signature.service.ts:7-13` |
| Signature header | `X-AACP-Signature: sha256=<hex>` | PARTIAL | `webhook-delivery-dispatcher.service.ts:118`; non-standard header name (Shopify/Stripe use `X-Shop-Hmac-Sha256` / `Stripe-Signature`); prefix-only framing is fine, but header name is custom |
| Signing secret format | prefixed (`whsec_<base64url>`) | PASS | `integrations.use-cases.ts:210,251`; Stripe-style prefix |
| Secret rotation API | `POST /endpoints/:id/rotate-secret` | PASS | `webhook-endpoints.controller.ts` (`rotate` handler) |
| Old secret compatibility window | still signable for N hours after rotation | GAP | current `RotateWebhookSigningSecretUseCase` rotates immediately; no overlap window; no `previousSecret` field |
| Per-attempt timeout (5s target) | request abort after 5s | GAP | `fetch(endpointUrl, fetchOptions)` has no `AbortSignal.timeout` or `AbortController` |
| Retry policy | exponential backoff with jitter | PARTIAL | `retryOrFail`: `delay = min(3600, 2^attempts * 30s)` -> 30s/60s/120s/240s/480s capped at 3600s; **no jitter** (deterministic -> thundering herd) |
| Max attempts | configurable / industry default 5-10 | PASS | `MAX_ATTEMPTS = 5` constant in dispatcher |
| Backoff cap | max delay (typically 1h, 24h) | PASS | `Math.min(3600, ...) -> 1h` |
| Dead letter queue | terminal-failed deliveries retained + replayable | PASS | status `failed` retained in DB; `POST .../deliveries/:id/replay` |
| Dead letter retention TTL | bounded retention (90d industry) | GAP | no TTL/cleanup job; deliveries accumulate forever |
| Deduplication (idempotency on `event_id`) | unique `(endpointId, eventId)` | PASS | `@@unique([endpointId, eventId])` on `MerchantWebhookDelivery` (Prisma) |
| Single-flight dispatch | atomic claim before send | PASS | `claimWebhookDelivery` (pending -> sending) in dispatcher; second worker exits if claimed |
| Crash recovery | recover `sending` rows on restart | PASS | dispatcher picks up `["pending","sending"]` and re-uses `sending` rows without re-claim |
| Ordering guarantees | documented as at-least-once, no ordering | PARTIAL | dispatcher is `setInterval(...)` poll; per-endpoint ordering not guaranteed; **not documented** |
| Event schema versioning | `api_version` field | PASS | envelope carries `api_version: "2026-05-21"`; literal type forces version updates to be intentional |
| Schema migration story | version change documented, multi-version support | GAP | only one version is currently in code (pinned literal type); no migration plan for breaking changes |
| DNS / SSRF protection | block private IPs, IPv6 ULA, link-local | PASS | `dns-webhook-target-policy.ts` + `ipaddr.js` `range() !== "unicast"` |
| DNS rebinding protection | pin DNS-resolved IP into connection | PASS | `createPinnedAgent` in dispatcher with custom lookup |
| Re-validate per dispatch | policy re-check at each delivery | PASS | `targetPolicy.assertAllowed` runs every attempt |
| Loopback HTTP (non-prod) | dev/test escape hatch | PASS | env-gated (`NODE_ENV !== "production"`); matches existing dev-only pattern |
| URL scheme / port | require `https:443` in production | PASS | policy enforces `https:` and default port |
| Bearer creds in URL | reject userinfo | PASS | `policy` rejects `username/password` in URL |
| Response code interpretation | 2xx success / 4xx no-retry / 5xx retry / 410 Gone no-retry | GAP | dispatcher retries on **all** non-`response.ok` (line `retryOrFail(claimed, "http_${response.status}", ...)`); 4xx and 410 are retried instead of being marked permanently failed |
| 401/403 from target | treat as misconfigured endpoint | GAP | retried like 5xx -> wastes retries |
| Network errors | classify and retry | PASS | `catch` -> `retryOrFail(..., "network_error")` |
| DNS policy failure | mark delivery permanently failed | PARTIAL | `webhook_target_blocked` sets `status: "failed"` immediately but only the dispatcher path; not blocked on save (lazy) |
| Event-id on every request | header carries `event_id` | PASS | `X-AACP-Event-Id` header |
| Idempotency-Key for receiver | `Idempotency-Key` header on POST | PARTIAL | `X-AACP-Event-Id` doubles as idempotency key (Stripe-style) but not explicitly named/signed as such |
| Timestamp anti-replay | receiver compares `timestamp` window | PARTIAL | signature includes `timestamp` and `X-AACP-Timestamp` exposed; **no documented tolerance window** (Stripe default is 300s) |
| Payload size limit | cap on JSON size | GAP | no cap on `body` before signing/dispatching (only response body truncated to 2KB) |
| User-Agent | identifies sender | PASS | `User-Agent: AACP-Webhooks/1.0` |
| Event types taxonomy | central, versioned, documented | PARTIAL | union `TenantWebhookEventType` is version-pinned but the TAXONOMY is not externally documented (no public spec page) |
| Audit trail / delivery log | rows persisted with attempt + response | PASS | `MerchantWebhookDelivery` rows: `attempts`, `responseStatus`, `responseBody`, `error`, `deliveredAt`, `nextAttemptAt` |
| List deliveries API | paginated read API | PASS | `GET /endpoints/:id/deliveries` (capped via `parseLimit`) |
| Single-tenant scoping | all queries by `merchant_id` | PASS | Prisma models + repository port enforce tenant boundary |
| ETag concurrency for PUT | optimistic concurrency | PASS | `assertIfMatch` in update path |
| `Idempotent` decorator on admin endpoints | replay-safe admin calls | PASS | `@Idempotent()` on create/update/test/replay/rotate |
| Test endpoint | synthetic test payload | PASS | `POST .../test` -> publishes a synthetic `order.approved` |
| Secret returned on create / rotate | one-time reveal | PASS | `redactResponseFields: ["signing_secret"]` decorators + `signing_secret_hint` |
| Sign-side hardening | use `timingSafeEqual` | PASS | `webhook-signature.service.ts:18` |
| Secret reuse across deliveries | persisted at delivery time? | PASS | post-INT-H3: secret no longer persisted on delivery rows; resolved per dispatch from the endpoint |
| Header signing method (HMAC of body only) | also include timestamp to defeat replay | PASS | signature covers `${timestamp}.${body}` (same shape as Stripe) |

## 2. Gap Detail and Severity

| # | Gap | Severity | Notes |
| --- | --- | --- | --- |
| G1 | 4xx responses (and 410) are retried instead of being marked permanently failed | High | causes up to 5 attempts of pointless traffic against a misconfigured/permanently-gone endpoint; should split `retryable_status` vs `terminal_status` |
| G2 | No per-attempt timeout (`AbortSignal.timeout` missing) | High | a slow-but-not-failing endpoint can hold a worker indefinitely; default `fetch` timeout is platform-dependent (Node 18+ has none) |
| G3 | Backoff has no jitter | Medium | synchronized retry storms when many endpoints share a transient failure |
| G4 | Custom `X-AACP-Signature` header (vs `Stripe-Signature` / `Shopify`-style) | Medium | breaks merchant pattern-matching; mitigatable with a documentation note |
| G5 | No timestamp tolerance window documented on receiver side | Medium | signature scheme requires it; without `300s window` documented, receivers cannot safely reject replays |
| G6 | No payload size cap | Medium | a runaway `data` blob can produce multi-MB POSTs; cap at ~256 KB and trim or split before posting |
| G7 | Secret rotation has no overlap window (`prev_secret` retained for grace period) | Medium | rotating without overlap guarantees lost webhooks during rolling deploys; Stripe-style: keep both for 24h |
| G8 | No delivery TTL / cleanup job | Low | `failed` deliveries accumulate forever; needs daily prune job (e.g. 90d) |
| G9 | No public event-schema catalog | Medium | merchants need a stable OpenAPI / JSON-Schema page per `event_type`; current `api_version` is locked literal but no per-type schemas are published |
| G10 | Ordering not documented | Low | dispatcher is async-poll + retry, no per-endpoint ordering; merchants must idempotency-key on `event_id`; say so on `/docs` |
| G11 | Only one `api_version` in code; no multi-version support | Low (today) | literal type is `2026-05-21` only; once breaking change happens we need a migration plan (event_type prefix `v2.order.*` or dual dispatch) |
| G12 | `X-AACP-Event-Id` doubles as idempotency key but isn't named / signed as such | Low | rename or document idempotency contract |
| G13 | `webhook_target_blocked` classified as `failed` even though the endpoint may temporarily be blocked | Low | consider leaving `pending` and retrying on next dispatch instead of hard-fail (currently only the dispatcher path checks; re-check on every attempt is correct, but on hard DNS failure the endpoint is permanently broken) |

## 3. Recommendations (prioritized)

### P0 (fix before opening to external partners)

1. **Split retryable vs terminal HTTP statuses.**
   `webhook-delivery-dispatcher.service.ts` -> treat:
   - `2xx` -> `delivered`
   - `408`, `425`, `429`, `5xx` -> retry
   - everything else `4xx` (notably `400`, `401`, `403`, `404`, `410`, `422`) -> mark `failed` immediately with `error: "http_4xx_non_retryable"`. Aligns with Stripe behavior.
2. **Add per-attempt timeout**:
   ```ts
   const ac = new AbortController();
   const t = setTimeout(() => ac.abort(), 5000);
   try { response = await fetch(url, { ...fetchOptions, signal: ac.signal }); }
   finally { clearTimeout(t); }
   ```
   On `AbortError` -> `error: "timeout"`, retry eligible.
3. **Add jitter to backoff**:
   `delaySeconds = min(3600, 2^attempts * 30) + Math.floor(Math.random() * 30)` (or full jitter).

### P1

4. **Document receiver verification recipe** (see Section 4 below). Ships with `INTEGRATION_AUDIT_WEBHOOKS.md` and should be linked from merchant docs.
5. **Secret rotation with overlap**: keep both `signing_secret` and `previous_signing_secret` valid for 24h; dispatcher signs with the active one; receivers should try both.
6. **Cap payload size** before signing (e.g. 256 KB). Reject `data` larger than that at publish time with a clear error.
7. **Document timestamp tolerance window**: 300s default; expose a `tolerance_seconds` env var.
8. **Public schema catalog** under `apps/api/src/modules/integrations/docs/EVENTS.md` or generated OpenAPI fragment per event_type.

### P2

9. **Delivery retention / cleanup cron**: delete `delivered`/`failed` rows older than 90 days; expose retention as env var.
10. **Idempotency-Key header**: rename `X-AACP-Event-Id` -> explicit `Idempotency-Key` header OR document it as the idempotency key.
11. **Order / delivery sequencing doc**: state explicitly "at-least-once, no ordering guarantee; use `event_id` for idempotency".
12. **Multi-version support**: when changing envelope shape, version-bump to `2026-MM-DD` and emit `api_version_changed` event in `TENANT_WEBHOOK_EVENTS`.

## 4. Partner Integration Recipe (for merchant-facing docs)

### Verification (Node.js example)

```js
const crypto = require('node:crypto');

function verifyAACPWebhook(rawBody, headerSignature, headerTimestamp, secret, toleranceSeconds = 300) {
  const ts = Number(headerTimestamp);
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (!Number.isFinite(skew) || skew > toleranceSeconds) throw new Error('timestamp_out_of_tolerance');

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${headerTimestamp}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(headerSignature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### Request shape

```http
POST /your/webhook HTTP/1.1
Host: your-host.example
Content-Type: application/json
User-Agent: AACP-Webhooks/1.0
X-AACP-Event-Id: evt_<uuid>
X-AACP-Event-Type: order.approved
X-AACP-Timestamp: 1718000000
X-AACP-Signature: sha256=<hex>
Content-Length: ...

{ "event_id": "evt_<uuid>", "event_type": "order.approved",
  "merchant_id": "mrc_<uuid>", "occurred_at": "2026-05-21T12:00:00.000Z",
  "api_version": "2026-05-21",
  "data": { ... } }
```

### Receiver rules

| Receiver returns | AACP behavior |
| --- | --- |
| `2xx` | delivery marked `delivered` |
| `408`, `425`, `429`, `5xx` | retry with exponential backoff + jitter, up to 5 attempts |
| `400`, `401`, `403`, `404`, `410`, `422` | marked `failed` permanently (after fix: no retries) |
| network error / timeout / DNS failure | retry |
| body too large or non-JSON | treated as `network_error` (after fix: capped) |

Always process duplicate deliveries by `event_id`. AACP guarantees at-least-once delivery.

### Secret management

- Secrets are returned ONCE on `POST /v1/webhook-endpoints` and on `POST .../rotate-secret` (look for `signing_secret` in the response).
- The hint `signing_secret_hint` (`whsec_xxx…abcd`) can be stored for display.
- Use a separate secret per environment (`sandbox` / `production`); the API supports this via the tenant scopes (`webhooks:write`).

## 5. Event Schema (current as of audit)

`api_version`: `"2026-05-21"`

Envelope:

```ts
interface TenantWebhookEnvelope<TData = Record<string, unknown>> {
  event_id: string;          // evt_<uuid>; unique per publish; idempotency key
  event_type: TenantWebhookEventType;
  merchant_id: string;       // tenant boundary
  occurred_at: string;       // ISO-8601
  api_version: "2026-05-21"; // pinned literal — bumping is intentional
  data: TData;               // per-event-type payload
}
```

Event types (`TenantWebhookEventType`):

| Event type | Trigger | `data` shape (current; flagged for spec) |
| --- | --- | --- |
| `checkout.started` | emitted by checkout module on session create | `{ session_id, customer, items, total, currency }` |
| `checkout.abandoned` | session timeout without approval | `{ session_id, last_status, occurred_at }` |
| `order.created` | post-approval order created | `{ order: { external_order_id, session_id, created_at, total, currency, status } }` |
| `order.approved` | payment approved + order finalized | `{ success, order: { external_order_id, session_id, completed_at, total, currency, status } }` |
| `order.cancelled` | explicit cancellation | `{ order: { external_order_id, reason, cancelled_at } }` |
| `order.cancellation_provider_failed` | provider rejected cancellation | `{ order: { external_order_id, error } }` |
| `payment.pending` | payment intent created | `{ payment_intent_id, amount, currency, status }` |
| `payment.approved` | webhook from gateway confirmed | `{ payment_intent_id, status, paid_at }` |
| `payment.failed` | gateway rejected | `{ payment_intent_id, status, error } }` |
| `payment.refunded` | full/partial refund | `{ payment_intent_id, refund_id, amount }` |
| `customer.upserted` | success path of order | `{ customer, session_id, external_order_id, global_user_id }` |
| `tracking.updated` | general tracking mutation | `{ shipment_id, status, carrier, tracking_code } }` |
| `order.tracking.updated` | use case `UpdateTenantOrderTrackingUseCase` | `{ order, tracking_code, carrier, tracking_url, status, events: [...] } }` |
| `support.ticket.created` | new ticket | `{ ticket_id, customer, subject, status }` |
| `commerce.connection.degraded` | sync issue | `{ connection_id, provider, error } }` |

> Note: the per-event `data` payload is currently inline in handlers; there is no JSON-Schema catalog yet. Create `docs/EVENTS.md` (or per-type `.specs/features/tenant-integrations/events/<event_type>.schema.json`) before GA.

## 6. Operational Knobs (env vars)

- `WEBHOOK_DISPATCHER_ENABLED` (default false) — required to enable the poller in production.
- `dispatchIntervalMs()` — currently 10s with no env var override found; consider exposing `WEBHOOK_DISPATCH_INTERVAL_MS`.
- No `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS`, or `WEBHOOK_BACKOFF_BASE_SECONDS` overrides; constants in source only.

## 7. Comparison with Shopify / Stripe

| Capability | AACP | Stripe | Shopify | Notes |
| --- | --- | --- | --- | --- |
| HMAC-SHA256 signed body | YES | YES | YES | Aligned |
| Signed payload includes timestamp | YES | YES | NO (Shopify signs raw body) | Aligned with Stripe |
| Signature header name | `X-AACP-Signature` (custom) | `Stripe-Signature` (standard) | `X-Shop-Hmac-Sha256` (standard) | **Gap G4** |
| Signing secret prefix | `whsec_` | `whsec_` | shared secret, no prefix | Aligned with Stripe |
| Secret rotation with overlap window | NO | YES (`webhook_endpoint.update` allows both old and new) | YES (secret versions via app) | **Gap G7** |
| Per-attempt timeout | NO | YES (~10s) | YES | **Gap G2** |
| Jitter | NO | YES | YES | **Gap G3** |
| 4xx = no retry | NO (retried) | YES | YES | **Gap G1** |
| Deduplication on event id | YES (DB unique) | YES | YES (Shopify uses `X-Shopify-Webhook-Id`) | Aligned |
| Dead letter / replay | YES (DB + replay endpoint) | YES (dashboard) | YES (dashboard) | Aligned |
| Public schema catalog | PARTIAL | YES (`stripe.com/docs/api/events/types`) | YES (`shopify.dev/docs/api/webhooks`) | **Gap G9** |
| Versioning | YES (literal `api_version`) | YES (API version header) | YES (webhook API version) | Aligned; needs multi-version plan |

### Merchants can verify AACP webhooks?

Yes, with three ingredients: signing secret, raw request body, and the `X-AACP-Timestamp` / `X-AACP-Signature` headers. The verification recipe in Section 4 mirrors Stripe's exactly. The friction points are (a) the custom header names and (b) the missing public schema catalog.

### Is the payload structure documented?

Partially. The envelope shape is fully typed (`TenantWebhookEnvelope`) and unit-tested, but the per-event `data` shape lives inline in event handlers and lacks a public JSON-Schema catalog. See Gap G9.

## 8. Suggested Follow-up ADRs / Specs

- `.specs/features/tenant-integrations/events.md` — canonical event-type + payload schemas + JSON-Schema fragments.
- `.specs/features/tenant-integrations/retry-policy.md` — codify retryable/terminal status codes + backoff + jitter + cap.
- `.specs/features/tenant-integrations/secret-rotation.md` — overlap window + grace period + revocation semantics.
- `.specs/features/tenant-integrations/receiver-cookbook.md` — partner-facing verification recipes for Node, Python, Go, PHP.

## 9. Verification Checklist Before GA

- [ ] G1 fixed: 4xx non-retryable.
- [ ] G2 fixed: 5s timeout enforced via `AbortSignal.timeout`.
- [ ] G3 fixed: jitter added (full jitter recommended).
- [ ] G5 fixed: 300s tolerance documented and enforced server-side? (server does not currently check; receiver responsibility — but document).
- [ ] G6 fixed: 256KB payload cap.
- [ ] G7 fixed: rotation overlap window (24h).
- [ ] G9 fixed: public schema catalog published.
- [ ] G8 fixed: retention cron.
- [ ] End-to-end test: simulates 5xx, 4xx, 429, timeout, network error, replay, and verifies DB state matches expectations.
- [ ] Tenant-scoped audit log: confirm no cross-tenant data leaks in audit trail (currently enforced by `merchant_id` in primary keys).
