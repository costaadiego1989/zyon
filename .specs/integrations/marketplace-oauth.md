---
name: marketplace-integration-spec
description: Mercado Livre, Shopee, TikTok Shop OAuth setup and testing
metadata:
  type: reference
---

# Marketplace Integration: Setup + Testing

## Overview

3 marketplace connectors (ML, Shopee, TikTok Shop) ready for OAuth registration and testing.

## Prerequisites

### Environment Variables

Add to `apps/api/.env`:

```env
# Mercado Livre
MERCADOLIVRE_CLIENT_ID=<your-app-id>
MERCADOLIVRE_CLIENT_SECRET=<your-secret>
MERCADOLIVRE_REDIRECT_URI=https://your-domain/api/v1/inventory/erp-oauth/callback

# Shopee
SHOPEE_PARTNER_ID=<partner-id>
SHOPEE_PARTNER_KEY=<partner-key>
SHOPEE_REDIRECT_URI=https://your-domain/api/v1/inventory/erp-oauth/callback

# TikTok Shop
TIKTOKSHOP_CLIENT_KEY=<client-key>
TIKTOKSHOP_CLIENT_SECRET=<client-secret>
TIKTOKSHOP_REDIRECT_URI=https://your-domain/api/v1/inventory/erp-oauth/callback

# ngrok tunnel (for local testing)
NGROK_URL=https://your-ngrok-url.ngrok-free.dev
```

## Step 1: Register Apps

### Mercado Livre

1. Go to https://developers.mercadolibre.com.br/
2. Create app → Get `app_id` and `secret_key`
3. Set redirect URI in app settings

### Shopee

1. Go to https://partner.shopeemobile.com/
2. Create seller account → Get partner ID + key
3. Add callback URL

### TikTok Shop

1. Go to https://seller-us.tiktok.com/seller
2. Settings → Connected Apps → Create app
3. Get client key + secret

## Step 2: Connect via Dashboard

**Endpoint:** `POST /inventory/erp-oauth/connect/:provider`

**Request:**
```bash
curl -X POST http://localhost:3000/api/v1/inventory/erp-oauth/connect/mercadolivre \
  -H "Authorization: Bearer <merchant-jwt>" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "authUrl": "https://auth.mercadolibre.com.br/authorization?client_id=...",
  "state": "random-state-string"
}
```

User redirected to auth → approves → redirected back to callback.

## Step 3: Callback Handler

**Endpoint:** `GET /inventory/erp-oauth/callback`

**Flow:**
1. Auth server redirects with `code` + `state`
2. Controller validates state
3. Exchanges code for access token
4. Stores encrypted token in ErpConnection
5. Calls TriggerMarketplaceSyncUseCase
6. Redirects to dashboard with success

## Step 4: Product Import

After OAuth connect, automatically triggered:

**Flow:**
```
TriggerMarketplaceSyncUseCase.execute
  → listProducts via marketplace adapter
  → Create/update FederatedProduct (external mapping)
  → Map to internal Product (matching by SKU)
  → Create InventoryItem rows
```

**Endpoint:** `POST /inventory/erp-oauth/:connectionId/sync`

Manual sync (if needed):
```bash
curl -X POST http://localhost:3000/api/v1/inventory/erp-oauth/conn_xyz/sync \
  -H "Authorization: Bearer <merchant-jwt>"
```

## Step 5: Stock Sync

After order completion:

**Flow:**
```
Order.completed event
  → MarketplaceStockPushService.pushStock
  → For each InventoryItem.marketplace connection:
      → Call adapter.updateStock(accessToken, externalId, quantity)
      → Log result
```

**Automatic:** Happens in background, no manual step.

## Testing: Manual Flow (Local)

### 1. Start API

```bash
cd apps/api
pnpm dev
```

### 2. Expose via ngrok

```bash
ngrok http 3000
# Copy URL: https://xxxx-xxx.ngrok-free.dev
```

### 3. Update .env

```env
NGROK_URL=https://xxxx-xxx.ngrok-free.dev
MERCADOLIVRE_REDIRECT_URI=https://xxxx-xxx.ngrok-free.dev/api/v1/inventory/erp-oauth/callback
```

### 4. Get Merchant JWT

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"..."}' \
  | jq -r '.accessToken'
# Copy token
```

### 5. Trigger OAuth

```bash
curl -X POST http://localhost:3000/api/v1/inventory/erp-oauth/connect/mercadolivre \
  -H "Authorization: Bearer <token>" \
  | jq '.authUrl'
```

### 6. Auth + Callback

- Click authUrl in browser
- Log in to Mercado Livre
- Approve access
- Redirected back to dashboard

### 7. Verify Connection

```bash
curl http://localhost:3000/api/v1/inventory/erp-oauth/connections \
  -H "Authorization: Bearer <token>" \
  | jq
```

Should show:
```json
{
  "connections": [
    {
      "id": "conn_xxx",
      "provider": "mercadolivre",
      "status": "connected",
      "connectedAt": "2026-08-25T...",
      "productCount": 42,
      "lastSyncAt": "2026-08-25T..."
    }
  ]
}
```

### 8. Verify Stock Sync

Create order in internal system:
```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"productId":"prod_xxx","quantity":5}],"buyer":"..."}'
```

Mark order as completed:
```bash
curl -X PATCH http://localhost:3000/api/v1/orders/ord_xxx \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'
```

Check MarketplaceStockPushService logs:
```
[Inventory] Pushing stock to marketplace...
marketplace=mercadolivre itemId=ML-12345678 quantity=5
```

Verify in Mercado Livre seller dashboard: quantity updated ✓

## Testing: E2E Suite

Create `apps/api/test/e2e/marketplace-oauth.e2e-spec.ts`:

```typescript
describe('Marketplace OAuth + Sync', () => {
  it('should OAuth connect to Mercado Livre', async () => {
    // GET connect URL
    // Simulate OAuth callback (mock redirect)
    // Verify ErpConnection created + encrypted token stored
    // Verify product sync triggered
  });

  it('should push stock after order completion', async () => {
    // Create order
    // Mark completed
    // Verify MarketplaceStockPushService called
    // Verify adapter.updateStock called with correct quantity
  });

  it('should respect merchant boundary', async () => {
    // Merchant A connects
    // Merchant B cannot see connection
    // Stock push only affects merchant A's marketplace account
  });
});
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Redirect URI mismatch" | .env REDIRECT_URI doesn't match OAuth app config | Update app settings on provider dashboard |
| "Invalid state token" | Callback handler lost state (session expired) | Ensure Redis/session store running |
| Stock not syncing | adapter.updateStock returned false | Check API credentials in ErpConnection (decrypted ok?) |
| Products imported with quantity=0 | Marketplace product has no stock field | Adapter fallback: stock = available_quantity ?? 0 |
| "Unknown provider" | Typo in connect endpoint | Use exactly: "mercadolivre", "shopee", "tiktokshop" |

## Architecture

```
dashboard (user clicks "Connect Mercado Livre")
  ↓
POST /inventory/erp-oauth/connect/mercadolivre
  ↓
ErpOAuthController.getAuthUrl
  ↓
Redirect to OAuth authorize endpoint
  ↓
User logs in + approves
  ↓
OAuth provider redirects: GET /callback?code=...&state=...
  ↓
ErpOAuthController.handleCallback
  ↓
Exchange code for token (via adapter)
  ↓
Store in ErpConnection (encrypted via AACP_ERP_ENC_KEY)
  ↓
TriggerMarketplaceSyncUseCase
  ↓
listProducts via adapter → create FederatedProduct + InventoryItem
  ↓
Redirect to dashboard: "Connected! 42 products imported."
```

## Security

1. **Token encryption:** Access tokens stored as AES-256-GCM (key: AACP_ERP_ENC_KEY)
2. **State validation:** OAuth state token compared before exchange
3. **Merchant boundary:** ErpConnection filtered by merchantId on every query
4. **Redirect URI:** Must match provider app config (CSRF mitigation)
5. **HMAC signing:** Shopee requires signed requests (adapter handles)

## Next (Optional Enhancements)

- [ ] Webhook delivery from marketplace (new order, stock change)
- [ ] Bidirectional sync (AACP → marketplace on product updates)
- [ ] Rate limiting per adapter (ML: 300/min, Shopee: 200/min, TikTok: 100/min)
- [ ] Exponential backoff retry on failed stock push
- [ ] Dashboard: view sync log per connection

---

**Adapters ready:** Mercado Livre, Shopee, TikTok Shop
**Status:** OAuth flows implemented, token storage encrypted, product import automatic
**Testing:** Manual + E2E suite template provided
