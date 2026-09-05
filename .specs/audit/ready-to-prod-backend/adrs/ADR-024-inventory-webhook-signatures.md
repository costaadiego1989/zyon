# ADR-024 — Inventory marketplace webhook requires signature

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `inventory`
**Issue:** P0-013

---

## Context

`apps/api/src/modules/inventory/presentation/http/marketplace-webhook.controller.ts` accepts POST `/inventory/erp/webhook/:provider` with **no HMAC/signature verification**. Provider switch dispatches to ML/Shopee/TikTokShop handlers that only log. Once order handlers are wired, this becomes a public unauthenticated mutation path.

---

## Decision

Per-provider HMAC signature verification using vendor-specified algorithms + secret stored in `erpConnection` (or `merchantCommerceConnection`).

---

## Implementation Steps

### 1. Per-provider signature handlers

```typescript
private verifyML(req, rawBody): boolean {
  // Per MercadoLibre: header x-signature (HMAC-SHA256 with merchant secret)
}
private verifyShopee(req, rawBody): boolean {
  // Per Shopee: HMAC-SHA256 over `${url_path}|${body}`
}
private verifyTikTokShop(req, rawBody): boolean {
  // Per TikTok Shop: HMAC-SHA256 with app secret
}
```

### 2. Dispatch

```typescript
async handle(provider, req, rawBody) {
  const connection = await this.erpRepo.findByMerchantAndProvider(req.principal.tenantId, provider);
  if (!connection?.webhookSecret) throw new UnauthorizedException();
  if (!this.verifyProvider(provider, req, rawBody, connection.webhookSecret)) {
    throw new UnauthorizedException();
  }
  // dispatch...
}
```

### 3. Fail-closed

Reject if `webhookSecret` missing on connection.

---

## Verification

```bash
pnpm test inventory -- --testPathPattern webhook-signatures
pnpm test:prisma inventory-webhook-forgery
```

---

## Files Touched

- `apps/api/src/modules/inventory/presentation/http/marketplace-webhook.controller.ts`
- `apps/api/src/modules/inventory/infrastructure/adapters/` (per-provider signature helpers)
- Tests
