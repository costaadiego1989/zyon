# Asaas Integration Audit — AACP Payment Module

**Date:** 2026-07-14  
**Scope:** `apps/api/src/modules/payment/` (Asaas-related files)  
**Reference:** Asaas API Docs (https://docs.asaas.com)

---

## Compliance Table

| Requirement | Status | Notes |
|---|---|---|
| Webhook token verification | PASS | Uses `timingSafeEqual` for constant-time comparison (M5 fix applied) |
| Webhook token fail-closed in production | WARN | Token is optional — `assertWebhookToken` is a no-op when `ASAAS_WEBHOOK_TOKEN` is unset (ADR 0001 #12 identifies this) |
| Event types handled | PARTIAL | Handles `PAYMENT_CREATED`, `PAYMENT_RECEIVED`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`, `PAYMENT_OVERDUE`; missing `PAYMENT_CONFIRMED`, `PAYMENT_UPDATED`, `PAYMENT_CHARGEBACK_*` |
| PIX payment flow (QR code) | PASS | Creates payment with `billingType: PIX`, then fetches `/v3/payments/:id/pixQrCode` for QR payload |
| Boleto generation | PASS | Creates payment with `billingType: BOLETO`; returns `invoiceUrl` for buyer |
| Credit card tokenization | PASS | Uses `/v3/creditCard/tokenize` before creating payment with `creditCardToken` |
| Sandbox vs production URLs | PASS | `asaas-env.ts` correctly routes: sandbox=`api-sandbox.asaas.com`, production=`api.asaas.com` |
| Customer creation (required fields) | PASS | Sends `name` (required), `cpfCnpj` (required), `email`; strips non-digits from cpfCnpj |
| API authentication header | PASS | Uses `access_token` header on all requests per Asaas docs |
| `externalReference` for payment tracking | PASS | Sets `externalReference: input.intentId` for payment reconciliation |
| Value in major units (BRL) | PASS | Converts cents to major units: `value: majorUnitsFromCents(input.amountCents)` |
| Due date on payment | PASS | Sets `dueDate` to 7 days from now (acceptable default) |
| Webhook idempotency | PASS | Atomic `recordProcessedProviderEvent` gate before dispatch |
| Amount verification on webhook | PASS | Checks `centsFromWebhook !== snap.amountCents` before approval |
| Split payment support | PARTIAL | `split` parameter documented in Asaas API is not used; platform adapter uses subaccounts instead |
| Webhook retry handling | PASS | Transient failures release idempotency marker; Asaas can re-deliver |
| Subaccount creation | PASS | `AsaasPlatformAdapter.createSubaccount()` posts to `/v3/accounts` |
| Per-merchant API key routing | PASS | `RoutingPaymentAdapter.resolveAsaas()` retrieves per-merchant decrypted API key |
| Error handling on API failures | PASS | Catches non-ok responses and throws structured errors with status code |
| `PAYMENT_CONFIRMED` event | MISSING | Not handled — Asaas sends this for credit card payments after anti-fraud approval |

---

## CRITICAL Gaps

### C1. Webhook authentication is fail-OPEN when token is not configured

**File:** `handle-asaas-webhook.use-case.ts:60-68`

**Issue:** `assertWebhookToken()` returns immediately (no-op) when `expectedToken` is undefined/empty. In any environment without `ASAAS_WEBHOOK_TOKEN` set, the `/webhooks/asaas` endpoint accepts unauthenticated POST requests. An attacker can forge webhook payloads to mark payment intents as approved or failed.

**Asaas docs say:** Webhooks should be authenticated via the `asaas-access-token` header configured in your webhook settings.

**Recommendation:**
- **IMMEDIATE:** In production, fail at application startup if `ASAAS_WEBHOOK_TOKEN` is not set
- Add a guard in the controller or module initialization:
  ```typescript
  if (process.env.NODE_ENV === 'production' && !process.env.ASAAS_WEBHOOK_TOKEN) {
    throw new Error('ASAAS_WEBHOOK_TOKEN is required in production');
  }
  ```
- Consider additionally validating the source IP against Asaas's known IP ranges (if documented)

---

### C2. Missing `PAYMENT_CONFIRMED` event handling

**File:** `handle-asaas-webhook.use-case.ts:153-178`

**Issue:** The webhook only handles `PAYMENT_RECEIVED` for approval. Asaas sends `PAYMENT_CONFIRMED` for credit card payments after anti-fraud analysis completes successfully. Without handling this event, credit card payments via Asaas that pass anti-fraud are never marked as approved.

**Asaas docs say:** `PAYMENT_CONFIRMED` — "Pagamento confirmado (compensacao bancaria ou confirmacao de analise de fraude)" (Payment confirmed after bank clearing or fraud analysis confirmation).

**Recommendation:**
- Add `case "PAYMENT_CONFIRMED":` to the dispatch switch, treating it identically to `PAYMENT_RECEIVED`
- The `asaasStateFromStatus()` in the adapter already maps `CONFIRMED` to `approved` — align the webhook handler

---

## HIGH Gaps

### H1. No handling of chargeback events (`PAYMENT_CHARGEBACK_*`)

**Issue:** Asaas sends chargeback-related events:
- `PAYMENT_CHARGEBACK_REQUESTED` — buyer initiated chargeback
- `PAYMENT_CHARGEBACK_DISPUTE` — dispute in progress

The adapter's `asaasStateFromStatus()` maps these to `failed`, but the webhook handler ignores them entirely (falls to `default: return "ignored_event_type"`).

**Impact:** Chargebacks go undetected. The local intent remains `approved` even after funds are reversed.

**Recommendation:**
- Add chargeback event handlers that call `paymentDispatch.markRefunded()` or a new `markChargeback()` transition
- Emit an alert/metric for chargeback events (financial risk)

---

### H2. No idempotency key on Asaas payment creation requests

**File:** `asaas-payment.adapter.ts:184-199`

**Issue:** The POST to `/v3/payments` does not include any idempotency mechanism. Asaas does not natively support idempotency keys like Stripe does. If the HTTP request succeeds but the response is lost (network issue), a retry creates a duplicate charge.

**Mitigation already in place:** The local intent is persisted in `pending` BEFORE calling the provider, and `externalReference` (intent ID) is set on the Asaas payment. However, Asaas does not enforce uniqueness on `externalReference`.

**Recommendation:**
- Before creating a payment, query Asaas for existing payments with the same `externalReference`: `GET /v3/payments?externalReference={intentId}`
- If found, reuse the existing payment instead of creating a new one
- This provides application-level idempotency despite Asaas lacking native support

---

### H3. `PAYMENT_UPDATED` event not handled

**Issue:** Asaas sends `PAYMENT_UPDATED` when payment details change (e.g., due date extension, value change by the merchant). Ignoring this means local state may diverge from Asaas state.

**Recommendation:**
- Handle `PAYMENT_UPDATED` to refresh local payment metadata
- At minimum, log it for observability

---

### H4. Credit card holder info validation incomplete

**File:** `asaas-payment.adapter.ts:119-165`

**Issue:** The tokenization endpoint requires `creditCardHolderInfo.cpfCnpj` and `creditCardHolderInfo.postalCode` per Asaas docs. The adapter sends these but falls back to empty strings:
```typescript
cpfCnpj: (input.creditCardHolderInfo?.cpfCnpj ?? "").replace(/\D/g, ""),
postalCode: (input.creditCardHolderInfo?.postalCode ?? "").replace(/\D/g, ""),
```

Asaas will reject tokenization with empty `cpfCnpj`. The error propagates but is opaque (`asaas_tokenize_failed:400:...`).

**Recommendation:**
- Validate `cpfCnpj` and `postalCode` are present and non-empty BEFORE calling tokenize
- Return a clear domain error (`credit_card_holder_cpf_required`) instead of relying on Asaas's error response

---

### H5. No webhook source IP validation

**Issue:** Asaas webhook authentication relies solely on a shared secret token in the `asaas-access-token` header. Unlike Stripe (which uses cryptographic signatures), this is a plain bearer token comparison. If the token leaks, there is no secondary defense.

**Recommendation:**
- If Asaas publishes webhook source IP ranges, add IP allowlisting as defense-in-depth
- Monitor for unexpected webhook source IPs in access logs

---

## MEDIUM Gaps

### M1. Float arithmetic in value conversion

**Files:** `asaas-payment.adapter.ts:45-47`, `handle-asaas-webhook.use-case.ts:70-77`

**Issue:** Conversion between cents and major units uses floating-point arithmetic:
```typescript
function majorUnitsFromCents(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}
function paymentValueAsCents(payment): number {
  return Math.round(paymentSlice.value * 100);
}
```

While `toFixed(2)` + `Math.round` mitigates most issues, edge cases with floating-point can produce off-by-one-cent errors (e.g., `19.99 * 100 = 1998.9999...` rounds correctly, but more complex values may not).

**Recommendation:**
- Use decimal-safe parsing: `Math.round(parseFloat(value.toFixed(2)) * 100)`
- Or represent money as strings and parse with integer arithmetic
- This is identified in ADR 0001 #15

---

### M2. No retry logic on Asaas API calls

**File:** `asaas-payment.adapter.ts` (all fetch calls)

**Issue:** All Asaas API calls use a single `fetch` with no retry logic. Transient network errors or Asaas 5xx responses cause immediate failure.

**Recommendation:**
- Implement retry with exponential backoff for 5xx and network errors (not for 4xx)
- The `HttpClientService.toFetch()` wrapper may already provide this — verify

---

### M3. QR code fetch failure is silently swallowed

**File:** `asaas-payment.adapter.ts:208-218`

**Issue:** If the PIX QR code fetch fails (`!qr.ok`), the payment is still returned without QR data. The buyer receives no way to pay via PIX despite the payment being created.

```typescript
if (qr.ok) {
  // parse QR
}
```

**Recommendation:**
- If QR code fetch fails, either retry or fail the payment creation entirely
- At minimum, log a warning and include an `invoiceUrl` fallback so the buyer can still access the payment page

---

### M4. `PAYMENT_RECEIVED_IN_CASH` status not mapped in webhook

**File:** `asaas-payment.adapter.ts:12` vs `handle-asaas-webhook.use-case.ts`

**Issue:** The adapter's `asaasStateFromStatus()` maps `RECEIVED_IN_CASH` to `approved`, but the webhook handler only dispatches on `PAYMENT_RECEIVED`. If Asaas sends a webhook event for cash receipt, it would be ignored.

**Recommendation:**
- Verify if Asaas sends a distinct event for cash payments
- If so, handle it in the webhook dispatch

---

## Implementation Recommendations

1. **Fail-closed webhook auth** — Require `ASAAS_WEBHOOK_TOKEN` in production; error at startup if missing
2. **Add `PAYMENT_CONFIRMED` handler** — Critical for credit card flows through Asaas
3. **Add chargeback event handlers** — Financial risk if chargebacks go undetected
4. **Application-level idempotency** — Query by `externalReference` before creating payments
5. **Pre-validate card holder info** — Fail early with clear errors instead of opaque Asaas 400s
6. **Retry logic** — Add exponential backoff on 5xx for all Asaas API calls
7. **QR code failure handling** — Retry or propagate error to buyer-facing response
8. **Monitor webhook delivery** — Asaas does not provide delivery metrics; implement health checks (periodic test webhooks or heartbeat)

---

## Asaas Webhook Events — Coverage Matrix

| Asaas Event | Handled | Action |
|---|---|---|
| `PAYMENT_CREATED` | YES | No-op (acknowledged) |
| `PAYMENT_AWAITING_RISK_ANALYSIS` | NO | Should log/track |
| `PAYMENT_APPROVED_BY_RISK_ANALYSIS` | NO | Could trigger status update |
| `PAYMENT_REPROVED_BY_RISK_ANALYSIS` | NO | Should mark failed |
| `PAYMENT_CONFIRMED` | NO | **CRITICAL** — Should mark approved |
| `PAYMENT_RECEIVED` | YES | Marks approved |
| `PAYMENT_RECEIVED_IN_CASH` | NO | Should mark approved |
| `PAYMENT_OVERDUE` | YES | Marks failed |
| `PAYMENT_DELETED` | YES | Marks failed |
| `PAYMENT_REFUNDED` | YES | Marks refunded |
| `PAYMENT_REFUND_IN_PROGRESS` | NO | Could track |
| `PAYMENT_CHARGEBACK_REQUESTED` | NO | **HIGH** — Should mark/alert |
| `PAYMENT_CHARGEBACK_DISPUTE` | NO | **HIGH** — Should mark/alert |
| `PAYMENT_UPDATED` | NO | Should refresh metadata |
| `PAYMENT_BANK_SLIP_VIEWED` | NO | Optional (analytics) |
| `PAYMENT_CHECKOUT_VIEWED` | NO | Optional (analytics) |

---

## Files Audited

- `infrastructure/asaas-payment.adapter.ts`
- `infrastructure/asaas-platform.adapter.ts`
- `infrastructure/asaas-env.ts`
- `application/handle-asaas-webhook.use-case.ts`
- `application/services/payment-dispatch.service.ts`
- `presentation/http/asaas-webhook.controller.ts`
- `domain/ports/payment-provider.port.ts`
- `infrastructure/routing-payment.adapter.ts`
- `payment.module.ts`
