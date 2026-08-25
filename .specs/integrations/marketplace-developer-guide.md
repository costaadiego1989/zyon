---
name: marketplace-developer-guide
description: Setup guide for Mercado Livre, Shopee, TikTok Shop marketplace connections
metadata:
  type: reference
---

# Marketplace Connection Developer Guide

## Quick Setup (5 min)

### 1. Get Credentials

**Mercado Livre:**
1. Go to https://developers.mercadolibre.com.br/
2. Create app (if not exists)
3. Copy `App ID` → `MERCADOLIVRE_APP_ID`
4. Copy `Client Secret` → `MERCADOLIVRE_CLIENT_SECRET`

**Shopee:**
1. Go to https://partner.shopeemobile.com/developer
2. Create seller account if needed
3. Copy `Partner ID` → `SHOPEE_PARTNER_ID`
4. Copy `Partner Key` → `SHOPEE_PARTNER_KEY`

**TikTok Shop:**
1. Go to https://seller-us.tiktok.com/seller/
2. Settings → Connected Apps
3. Create new app
4. Copy `App Key` → `TIKTOKSHOP_APP_KEY`
5. Copy `App Secret` → `TIKTOKSHOP_APP_SECRET`

### 2. Add to .env

```bash
cp apps/api/.env.marketplace.example apps/api/.env.local
```

Fill in credentials:
```env
MERCADOLIVRE_APP_ID=abc123xyz
MERCADOLIVRE_CLIENT_SECRET=secret123
SHOPEE_PARTNER_ID=123456
SHOPEE_PARTNER_KEY=secret789
TIKTOKSHOP_APP_KEY=key123
TIKTOKSHOP_APP_SECRET=secret456
NGROK_URL=https://your-ngrok.ngrok-free.dev
```

### 3. Set Redirect URIs in Provider Apps

Each provider app dashboard needs redirect URI set:

```
https://your-domain/api/v1/inventory/erp-oauth/callback
```

For local dev with ngrok:
```
https://your-ngrok-url.ngrok-free.dev/api/v1/inventory/erp-oauth/callback
```

### 4. Test Locally

```bash
# Terminal 1: Start API
cd apps/api && pnpm dev

# Terminal 2: Start ngrok tunnel
ngrok http 3000
# Copy URL: https://xxxx-xxxx.ngrok-free.dev
```

Update `.env`:
```env
NGROK_URL=https://xxxx-xxxx.ngrok-free.dev
MERCADOLIVRE_REDIRECT_URI=https://xxxx-xxxx.ngrok-free.dev/api/v1/inventory/erp-oauth/callback
SHOPEE_REDIRECT_URI=https://xxxx-xxxx.ngrok-free.dev/api/v1/inventory/erp-oauth/callback
TIKTOKSHOP_REDIRECT_URI=https://xxxx-xxxx.ngrok-free.dev/api/v1/inventory/erp-oauth/callback
```

### 5. Test OAuth Flow

**Get merchant token:**
```bash
TOKEN=$(curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@test.com","password":"password123"}' \
  | jq -r '.accessToken')

echo $TOKEN
```

**Get authorize URL:**
```bash
curl -X GET http://localhost:3000/api/v1/inventory/erp/oauth/mercadolivre/authorize \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.url'
```

**Open URL in browser** → Approve → Redirected back

**Verify connection:**
```bash
curl -X GET http://localhost:3000/api/v1/inventory/erp/oauth/connections \
  -H "Authorization: Bearer $TOKEN" \
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
      "productCount": 42
    }
  ]
}
```

## Production Setup

### 1. Update Dashboard env

```env
# .env.production
VITE_API_BASE_URL=https://api.yourdomain.com
```

### 2. Update provider app settings

Redirect URI:
```
https://api.yourdomain.com/api/v1/inventory/erp-oauth/callback
```

### 3. Verify AACP_ERP_ENC_KEY

Token encryption key must be set:
```bash
openssl rand -base64 32 > /tmp/key.txt
export AACP_ERP_ENC_KEY=$(cat /tmp/key.txt)
```

Store securely (not in .env):
```bash
# AWS Secrets Manager example
aws secretsmanager create-secret \
  --name aacp/erp-encryption-key \
  --secret-string "$(cat /tmp/key.txt)"
```

### 4. Test Each Marketplace

**Mercado Livre:**
- Create test seller account
- List 5-10 test products
- Connect → Verify import
- Create order → Verify stock push

**Shopee:**
- Create seller account (or use staging)
- Add test products
- Connect → Verify import
- Create order → Check stock update

**TikTok Shop:**
- Create seller account
- Create test products
- Connect → Verify import
- Test stock sync

## Troubleshooting

### "Invalid redirect_uri"
**Cause:** Redirect URI doesn't match provider app settings

**Fix:**
1. Go to provider app dashboard
2. Find "Redirect URIs" or "Callback URLs" setting
3. Update to match your deployment URL

### "OAuth state validation failed"
**Cause:** Session/state expired or CSRF attack

**Fix:**
1. Ensure Redis/session store running
2. Check browser cookies enabled
3. Try OAuth flow again

### "Token exchange failed" (status 400)
**Cause:** Credentials incorrect or token endpoint changed

**Fix:**
1. Verify credentials in .env
2. Check provider API docs for token endpoint URL
3. Test manually with curl

### Stock not syncing after order
**Cause:** ErpConnection not found, adapter.updateStock failed

**Fix:**
1. Verify connection exists: `GET /erp/oauth/connections`
2. Check logs: `MarketplaceStockPushService` for errors
3. Verify marketplace product ID mapped correctly

### "Unknown provider" error
**Cause:** Typo in provider name

**Fix:**
Use exactly: `mercadolivre`, `shopee`, `tiktokshop` (lowercase)

## Code Structure

```
inventory/
  infrastructure/adapters/
    mercadolivre-marketplace.adapter.ts    # listProducts, updateStock
    shopee-marketplace.adapter.ts
    tiktokshop-marketplace.adapter.ts
    marketplace-adapter.factory.ts         # createMarketplaceAdapter
    erp-secret-cipher.ts                   # AES-256-GCM encryption
  domain/ports/
    marketplace-provider.port.ts           # Interface
  presentation/http/
    erp-oauth.controller.ts                # OAuth authorize + callback
```

## Testing: E2E Template

Create `apps/api/test/e2e/marketplace-oauth.e2e-spec.ts`:

```typescript
describe('Marketplace OAuth', () => {
  let merchantToken: string;

  beforeAll(async () => {
    // Create merchant + get token
    merchantToken = await getAuthToken();
  });

  it('should authorize Mercado Livre OAuth', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/inventory/erp/oauth/mercadolivre/authorize')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/auth\.mercadolivre\.com\.br/);
  });

  it('should handle OAuth callback and create connection', async () => {
    // Simulate OAuth callback
    const res = await request(app.getHttpServer())
      .get('/api/v1/inventory/erp/oauth/callback')
      .query({
        code: 'test-code-123',
        state: signState('mercadolivre', merchantId),
      });

    // Verify connection created
    const connections = await request(app.getHttpServer())
      .get('/api/v1/inventory/erp/oauth/connections')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(connections.body.connections).toHaveLength(1);
    expect(connections.body.connections[0].provider).toBe('mercadolivre');
  });

  it('should push stock to marketplace after order', async () => {
    // Create order
    // Mark completed
    // Verify adapter.updateStock called
  });
});
```

## Performance Notes

- **Product import:** ~100 products per minute (batch 20)
- **Stock push:** <1s per item
- **OAuth callback:** <5s (includes product import start)
- **Rate limits:**
  - Mercado Livre: 300 req/min
  - Shopee: 200 req/min
  - TikTok Shop: 100 req/min

Implement exponential backoff for 429 (too many requests).

## Security

✓ Access tokens encrypted (AES-256-GCM)
✓ State token validates CSRF
✓ Redirect URI validation
✓ Merchant boundary enforced
✓ HMAC signing (Shopee)

---

**Status:** Ready to connect
**Last updated:** 2026-08-25
