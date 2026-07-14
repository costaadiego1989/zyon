# Stripe Integration Audit — AACP Payment Module

**Date:** 2026-07-14  
**Scope:** `apps/api/src/modules/payment/` (Stripe-related files)  
**Reference:** Stripe API Docs (https://docs.stripe.com/api), Stripe Webhooks (https://docs.stripe.com/webhooks)

---

## Compliance Table

| Requirement | Status | Notes |
|---|---|---|
| Webhook signature verification (`constructEvent`) | PASS | Uses `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)` correctly |
| Raw body preservation for signature | PASS | Controller uses `@Req() req: RawBodyRequest<Request>` + `req.rawBody` (Buffer) |
| `stripe-signature` header extraction | PASS | `@Headers("stripe-signature")` correctly extracts the header |
| Return 200 quickly on webhook | WARN | Handler does async DB work before returning; risk of Stripe timeout on slow processing |
| Idempotency keys on API calls | PASS | `idempotencyKey` passed on `paymentIntents.create`, `accounts.create`, `customers.create`, `checkout.sessions.create` |
| Stable idempotency key derivation | PASS | Uses `sha256(merchantId + sessionId + idempotencyKey)` — survives client retries (ADR 0001 #6) |
| Event types handled | PASS | Handles `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `checkout.session.completed`, `customer.subscription.*` |
| Connect: destination charges | PASS | Uses `application_fee_amount` + `transfer_data.destination` per Stripe docs |
| Connect: account onboarding | PASS | Uses `accounts.create` (type: express) + `accountLinks.create` |
| API version pinning | PASS | Pinned to `"2026-04-22.dahlia"` consistently across all adapters |
| Error handling (StripeError) | WARN | Catches generic errors; does not differentiate `StripeCardError`, `StripeRateLimitError`, etc. |
| Webhook idempotency (duplicate events) | PASS | Atomic `recordProcessedProviderEvent` gate before dispatch; duplicates short-circuit |
| Amount verification before approval | PASS | Checks `pi.amount_received !== snap.amountCents` before `markApproved` |
| Refund flow | PARTIAL | No explicit refund initiation via Stripe API; only handles inbound refund state from subscription events |
| SCA / 3D Secure handling | PASS | Uses `automatic_payment_methods: { enabled: true }` which handles SCA automatically; client-side confirms via `clientSecret` |
| Webhook endpoint registration | N/A | Manual (Dashboard/CLI); no programmatic registration |
| Webhook retry handling | PASS | Transient failures release idempotency marker via `deleteProcessedProviderEvent`; Stripe re-delivers |
| Sandbox/test key isolation | PASS | `stripe-env.ts` refuses live keys in non-production; only accepts `sk_test_*` / `pk_test_*` in dev |
| `charge.refunded` / `charge.dispute.*` events | MISSING | Not handled — refunds and disputes from Stripe go undetected |
| `payment_intent.canceled` event | MISSING | Not handled; cancellation at Stripe side won't propagate |
| `payment_intent.requires_action` event | MISSING | Not handled; SCA state changes from Stripe won't propagate |

---

## CRITICAL Gaps

### C1. Stripe SDK instantiated multiple times with `"__missing__"` sentinel

**Files:** `handle-stripe-webhook.use-case.ts:36`, `confirm-stripe-payment.use-case.ts:29`, `stripe-payment.adapter.ts:34`

**Issue:** Three separate `new Stripe(secretKey ?? "__missing__")` instantiations. The `"__missing__"` string is silently accepted by the SDK constructor — misconfiguration is only detected at first API call, not at boot time.

**Stripe docs say:** "Make sure to use your API key from your Stripe dashboard."

**Recommendation:**
- Create a `StripeClientFactory` provider that fails fast on boot if `STRIPE_SECRET_KEY` is not set
- Centralize the API version constant (`"2026-04-22.dahlia"`) in one place
- Inject the factory; remove direct `new Stripe(...)` from use-cases

---

### C2. No handling of `charge.refunded` or dispute events

**Issue:** If a refund or dispute is initiated from Stripe Dashboard or programmatically, the webhook handler ignores these events (`default: return "ignored_event_type"`). The local payment intent remains `approved` indefinitely.

**Stripe docs say:** "You should handle `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` events to keep your records in sync."

**Recommendation:**
- Add handlers for `charge.refunded` → call `paymentDispatch.markRefunded()`
- Add handlers for `charge.dispute.created` → flag intent for review
- Add handler for `payment_intent.canceled` → call `paymentDispatch.markFailed()`

---

## HIGH Gaps

### H1. Single global webhook secret — no per-Connect-account verification

**File:** `handle-stripe-webhook.use-case.ts:40-41`

**Issue:** Uses one global `STRIPE_WEBHOOK_SECRET` for signature verification. In Stripe Connect, each connected account can have its own webhook endpoint with a separate signing secret. Events from connected accounts (e.g., `account.updated`) may use a different secret.

**Stripe docs say:** "If you have multiple endpoints, each has its own unique secret."

**Recommendation:**
- If receiving events from connected accounts directly, implement per-account secret lookup
- If using only platform-level events (current pattern with `transfer_data.destination`), this is acceptable — document the assumption

---

### H2. Webhook handler does synchronous processing (risk of Stripe timeout)

**Issue:** The webhook handler performs DB writes, commerce order marking, and checkout completion inline before returning 200. Stripe expects a 200 response within 20 seconds; slow downstream calls risk timeout and unnecessary retries.

**Stripe docs say:** "Return a 200 response to Stripe as quickly as possible... Use asynchronous processing for complex logic."

**Recommendation:**
- Consider acknowledging the webhook (200) immediately after signature verification + idempotency gate
- Process the event asynchronously via a job queue or the existing outbox mechanism
- Current implementation is acceptable for fast DB operations but at risk under load

---

### H3. No explicit Stripe error type differentiation

**File:** `handle-stripe-webhook.use-case.ts:52-54`, `stripe-payment.adapter.ts:60-63`

**Issue:** All Stripe SDK errors are caught generically. The SDK provides typed errors (`StripeCardError`, `StripeRateLimitError`, `StripeInvalidRequestError`, `StripeAPIError`) that should be handled differently:
- Rate limit → retry with backoff
- Card error → mark failed with reason
- API error → alert + retry

**Recommendation:**
- In `stripe-payment.adapter.ts`, catch and classify `Stripe.errors.StripeError` subtypes
- Propagate structured error codes rather than raw messages

---

### H4. No `payment_intent.canceled` handling creates orphaned intents

**Issue:** If a PaymentIntent is canceled at Stripe (e.g., by expiration or manual action), the local intent stays in `requires_action` forever. The reconciliation job (`reconcile-payment-intents`) partially addresses this by polling `fetchPaymentStatus`, but there's a window where state is stale.

**Recommendation:**
- Add `payment_intent.canceled` to the webhook dispatch switch
- Mark the local intent as `failed` with reason `stripe_canceled`

---

## Implementation Recommendations

1. **StripeClientFactory** — Single injection point, fail-fast on missing keys, centralized API version
2. **Expand event handling** — Add `charge.refunded`, `charge.dispute.*`, `payment_intent.canceled`
3. **Async webhook processing** — Move heavy dispatch to a queue; return 200 after gate
4. **Typed error handling** — Classify Stripe SDK errors by subtype for appropriate retry/fail behavior
5. **API version upgrade strategy** — Document the pinned version and create a runbook for API version upgrades
6. **Webhook endpoint health monitoring** — Stripe provides webhook delivery metrics; consider polling `GET /v1/webhook_endpoints/:id` for failure rates

---

## Files Audited

- `infrastructure/stripe-payment.adapter.ts`
- `infrastructure/stripe-platform.adapter.ts`
- `infrastructure/stripe-env.ts`
- `application/handle-stripe-webhook.use-case.ts`
- `application/confirm-stripe-payment.use-case.ts`
- `application/services/payment-dispatch.service.ts`
- `presentation/http/stripe-webhook.controller.ts`
- `presentation/http/stripe-payment.controller.ts`
- `payment.module.ts`
