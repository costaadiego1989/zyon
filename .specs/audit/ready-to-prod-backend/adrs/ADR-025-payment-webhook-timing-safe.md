# ADR-025 — Payment webhooks use timing-safe signature verification

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `payment`
**Issue:** P0-014

---

## Context

Three payment webhook handlers, but signature verification has weaknesses:

| Handler | Issue |
|---------|-------|
| Stripe | ✓ Stripe SDK (HMAC-SHA256 + 5-min skew) |
| Asaas buyer | ✓ timingSafeEqual + FAIL-CLOSED |
| **Asaas billing** | `!==` plain string compare; FAIL-OPEN when env unset → accepts unauthenticated subscription events in prod |
| MercadoPago | byte-loop compare, not `crypto.timingSafeEqual`; length leak side-channel |
| MP refund body | raw `amountCents / 100` float (missing `.toFixed(2)`) |

---

## Decision

Replace `!==` and byte-loop with `crypto.timingSafeEqual`. FAIL-CLOSED on env unset for billing webhook (no dev-sandbox exception). Convert refund amount to fixed-2 decimals before serialization.

---

## Implementation Steps

### 1. AsaasBillingWebhookController

```typescript
const expected = Buffer.from(process.env.ASAAS_WEBHOOK_TOKEN ?? '', 'utf8');
const provided = Buffer.from(token ?? '', 'utf8');
if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
  throw new UnauthorizedException();
}
if (!process.env.ASAAS_WEBHOOK_TOKEN) {
  throw new UnauthorizedException();  // fail-closed even in dev
}
```

### 2. MercadoPago webhook

```typescript
const expected = Buffer.from(hexExpected, 'hex');
const provided = Buffer.from(signatureProvided, 'hex');
if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
  throw new UnauthorizedException();
}
```

### 3. MercadoPago refund body

```typescript
const body = {
  amount: parseFloat((amountCents / 100).toFixed(2)),
  // ...
};
```

---

## Verification

```bash
pnpm test payment -- --testPathPattern webhook-timing-safe
# Property test: signature forgery attempts fail
pnpm test:prisma payment-webhook-forgery
```

---

## Files Touched

- `apps/api/src/modules/payment/presentation/http/asaas-billing-webhook.controller.ts`
- `apps/api/src/modules/payment/application/handle-mercadopago-webhook.use-case.ts:101-105`
- `apps/api/src/modules/payment/infrastructure/mercadopago-payment.adapter.ts:163`
- Tests
