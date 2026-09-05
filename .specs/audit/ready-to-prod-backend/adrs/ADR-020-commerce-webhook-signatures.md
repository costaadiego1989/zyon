# ADR-020 — Commerce webhooks require signatures (Tray/VTEX/Nuvemshop)

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `commerce`
**Issue:** P0-009

---

## Context

Five commerce webhook controllers, only 2 verify HMAC:

| Platform | HMAC | Auth |
|----------|------|------|
| Shopify | ✓ | HMAC-SHA256 + Base64 + timingSafeEqual |
| WooCommerce | ✓ | HMAC-SHA256 + Base64 |
| Nuvemshop | conditional | optional HMAC; in-memory rateMap (multi-replica unsafe); createHmac compare path needs spot-audit |
| **Tray** | **✗** | URL `merchantId` is the only auth → forgery |
| **VTEX** | **✗** | URL `merchantId` + body `accountName` match → forgery possible |

Forgery against any AACP-connected merchant by attacker who learns the merchant ID is feasible on Tray and VTEX. Worse: accountName is often public on the merchant's storefront.

---

## Decision

Add HMAC signature verification for Tray + VTEX. Make Nuvemshop HMAC mandatory (not conditional).

Pattern: per-merchant webhook secret stored at connection time. Recipient computes `hmac-sha256(secret, raw_body)`. AACP verifies with `timingSafeEqual`.

---

## Implementation Steps

### 1. Add `webhookSecret` to `MerchantCommerceConnection`

Already exists via `MerchantCommerceConnection.webhookSecret?` (verify). Required at connect time for all 5 platforms.

### 2. Tray signature verification

Per Tray docs: signature header `X-Tray-Signature` (verify exact algorithm against vendor docs).

```typescript
const expected = createHmac('sha256', connection.webhookSecret).update(rawBody).digest('hex');
const provided = req.headers['x-tray-signature'];
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
  throw new UnauthorizedException();
}
```

### 3. VTEX signature verification

Per VTEX docs: header `X-VTEX-Signature`. Verify HMAC-SHA256 with master key.

### 4. Nuvemshop mandatory HMAC

`webhookSecret` becomes REQUIRED. Reject connection if missing.

### 5. Fail-closed + metrics

Add metric for failed sig verifies (alertable).

---

## Verification

```bash
pnpm test commerce -- --testPathPattern webhook-signatures
# Cross-platform signature forgery tests
pnpm test:prisma commerce-webhook-forgery
```

---

## Files Touched

- `apps/api/src/modules/commerce/presentation/http/tray-webhook.controller.ts`
- `apps/api/src/modules/commerce/presentation/http/vtex-webhook.controller.ts`
- `apps/api/src/modules/commerce/presentation/http/nuvemshop-webhook.controller.ts`
- `apps/api/src/modules/commerce/application/use-cases/commerce-connect.use-case.ts` (require webhookSecret)
- Tests
