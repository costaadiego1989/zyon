# ADR-008 — Outbound M2M webhook HMAC signing

**Status:** PROPOSED (P1)
**Module:** `negotiation`
**Issue:** P1-003

---

## Context

`apps/api/src/modules/negotiation/infrastructure/m2m-webhook-dispatcher.service.ts` posts JSON to merchant-configured URLs without signing. Recipients can't verify authenticity.

Retry/backoff (1s, 4s, 5s timeout) is in place.

---

## Decision

Add `X-AACP-Signature: sha256=<hmac>` and `X-AACP-Timestamp: <unix-seconds>`. Document on merchant dashboard.

Backward-compat: send with signature only after merchant registers webhook (opt-in). Track via `merchantWebhookDelivery.status`.

---

## Implementation Steps

1. Generate per-merchant webhook secret on register.
2. Sign: `hmac = HMAC-SHA256(secret, timestamp + '.' + rawBody)`.
3. Headers: `X-AACP-Signature: sha256=<hex>`, `X-AACP-Timestamp: <s>`.
4. Recipient docs: example signature verify snippet.
5. Dashboard: show secret once + rotate endpoint.

---

## Files Touched

- `apps/api/src/modules/negotiation/infrastructure/m2m-webhook-dispatcher.service.ts`
- `apps/api/src/modules/merchant-webhooks` (if exists) or `merchantWebhookDelivery`
- Dashboard UI for secret rotation
