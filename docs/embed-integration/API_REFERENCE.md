# API Reference

Complete reference for the Athom Checkout Embed HTTP endpoints.

## Base URL

| Environment | URL |
|---|---|
| Production | `https://api.athom.io` |
| Sandbox | `https://sandbox.api.athom.io` |

## Authentication

All endpoints require authentication via embed session tokens or service API keys.

### Embed Session Token

Used by the widget to make client-side requests. Passed as:

```
X-AACP-Embed-Token: <embed_session_token>
```

### Service API Key

Used by your backend to issue embed tokens. Passed as:

```
Authorization: Bearer <service_api_key>
```

Or explicitly:
```
X-AACP-API-Key: <service_api_key>
```

---

## Session Management

### POST /embed-sessions

Issue a short-lived embed session token.

**Authentication**: Service API key (backend-only)

**Request**:
```bash
curl -X POST https://api.athom.io/embed-sessions \
  -H "Authorization: Bearer sk_live_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "ttl_seconds": 900,
    "allowed_origin": "https://checkout.example.com",
    "scopes": ["checkout:start", "checkout:chat", "offers:apply", "payment:intents:create"],
    "installation_id": "inst_abc123",
    "cart_ref": "cart_456"
  }'
```

**Body Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ttl_seconds` | integer | No | Token lifetime (60–86400, default 900) |
| `allowed_origin` | string | No | Restrict token to this origin (recommended for production) |
| `scopes` | string[] | No | Permissions granted to this session |
| `installation_id` | string | No | Bind to a specific widget installation |
| `cart_ref` | string | No | External cart reference (max 120 chars) |

**Response** `201 Created`:
```json
{
  "embed_session_token": "eyJ0eXAiOiJhYWNwX2VtYmVkX3YxIiwi...",
  "expires_at_unix": 1692914400,
  "installation_id": "inst_abc123",
  "environment": "live",
  "widget_version": "2.1.0",
  "scopes": ["checkout:start", "checkout:chat", "offers:apply", "payment:intents:create"]
}
```

**Errors**:

| Status | Code | Description |
|--------|------|-------------|
| 400 | `invalid_allowed_origin` | Origin is not a valid URL |
| 400 | `invalid_scopes` | One or more scope values are not recognized |
| 400 | `merchant_id_is_credential_derived` | Do not pass `merchant_id` in the body; it's derived from your API key |
| 401 | `missing_embed_issuer_context` | Missing or invalid service API key |

**Idempotency**: Supports `Idempotency-Key` header for safe retries.

---

## Checkout Endpoints

All checkout endpoints require an `X-AACP-Embed-Token` header.

### POST /embed/start

Start a checkout session for the current cart.

**Required Scope**: `checkout:start`

```bash
curl -X POST https://api.athom.io/embed/start \
  -H "X-AACP-Embed-Token: eyJ0eXAiOiJhYWNw..." \
  -H "Content-Type: application/json" \
  -d '{
    "cart_items": [
      {
        "external_id": "sku_001",
        "name": "Wireless Headphones",
        "price": 29900,
        "quantity": 1,
        "image_url": "https://example.com/headphones.jpg"
      }
    ],
    "customer": {
      "email": "buyer@example.com",
      "name": "Maria"
    },
    "session_id": "session_abc123"
  }'
```

**Response** `200 OK`:
```json
{
  "session_id": "session_abc123",
  "status": "active",
  "agent_greeting": "Oi, Maria! Vi que você está interessada nos headphones. Posso ajudar?",
  "offers_available": true
}
```

---

### POST /embed/chat

Send a message to the AI checkout agent. The agent qualifies objections and negotiates.

**Required Scope**: `checkout:chat`

```bash
curl -X POST https://api.athom.io/embed/chat \
  -H "X-AACP-Embed-Token: eyJ0eXAiOiJhYWNw..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session_abc123",
    "message": "O frete está muito caro"
  }'
```

**Response** `200 OK`:
```json
{
  "session_id": "session_abc123",
  "reply": "Entendo, R$25 de frete pesa no bolso. Que tal se eu conseguir frete grátis pra você?",
  "offers": [
    {
      "id": "offer_789",
      "type": "free_shipping",
      "label": "Frete Grátis",
      "conditions": "Aplicável para este pedido"
    }
  ],
  "classification": "shipping_objection"
}
```

---

### POST /embed/track

Track a user interaction event (page view, idle, scroll depth, etc.).

**Required Scope**: `checkout:track`

```bash
curl -X POST https://api.athom.io/embed/track \
  -H "X-AACP-Embed-Token: eyJ0eXAiOiJhYWNw..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session_abc123",
    "event_type": "idle_30_seconds",
    "metadata": {
      "page": "/checkout",
      "scroll_depth": 0.75
    }
  }'
```

**Response** `200 OK`:
```json
{
  "tracked": true,
  "trigger_fired": true,
  "intervention": "open_widget"
}
```

---

### POST /embed/offers/apply

Apply a negotiated offer to the cart.

**Required Scope**: `offers:apply`

```bash
curl -X POST https://api.athom.io/embed/offers/apply \
  -H "X-AACP-Embed-Token: eyJ0eXAiOiJhYWNw..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session_abc123",
    "offer_id": "offer_789"
  }'
```

**Response** `200 OK`:
```json
{
  "applied": true,
  "offer_id": "offer_789",
  "discount_amount": 2500,
  "new_total": 27400,
  "expires_at": "2024-01-15T14:30:00Z"
}
```

---

## Payment Endpoints

### POST /embed/payment/intents

Create a payment intent for the current session.

**Required Scope**: `payment:intents:create`

```bash
curl -X POST https://api.athom.io/embed/payment/intents \
  -H "X-AACP-Embed-Token: eyJ0eXAiOiJhYWNw..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session_abc123",
    "idempotency_key": "pay_unique_12345",
    "method": "pix",
    "accepted_offer_id": "offer_789"
  }'
```

**Body Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | string | Yes | Active checkout session |
| `idempotency_key` | string | Yes | Unique key for safe retries |
| `method` | string | No | Payment method: `pix`, `card`, `boleto`, `crypto` |
| `accepted_offer_id` | string | No | Previously applied offer |

**Response** `201 Created` (Pix example):
```json
{
  "intent_id": "pi_abc123",
  "status": "pending",
  "method": "pix",
  "amount": 27400,
  "pix_qr_code": "00020101021226870014br.gov.bcb.pix...",
  "pix_copy_paste": "00020101021226870014...",
  "expires_at": "2024-01-15T15:00:00Z"
}
```

**Response** `201 Created` (Card example):
```json
{
  "intent_id": "pi_def456",
  "status": "confirmed",
  "method": "card",
  "amount": 27400,
  "last4": "4242",
  "brand": "visa"
}
```

---

### POST /embed/payment/intents/:intentId/crypto/confirm

Confirm a crypto payment after on-chain transaction.

**Required Scope**: `payment:intents:confirm`

```bash
curl -X POST https://api.athom.io/embed/payment/intents/pi_abc123/crypto/confirm \
  -H "X-AACP-Embed-Token: eyJ0eXAiOiJhYWNw..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session_abc123",
    "tx_hash": "0xabc123...",
    "wallet_address": "0xdef456..."
  }'
```

---

### POST /embed/customer/update

Update customer information mid-session (name, email, CPF).

```bash
curl -X POST https://api.athom.io/embed/customer/update \
  -H "X-AACP-Embed-Token: eyJ0eXAiOiJhYWNw..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session_abc123",
    "customer": {
      "fullName": "Maria Silva",
      "email": "maria@example.com",
      "cpf": "123.456.789-00",
      "phone": "+5511999999999"
    }
  }'
```

---

## Error Responses

All errors follow this format:

```json
{
  "statusCode": 401,
  "message": "invalid_embed_session_token",
  "error": "Unauthorized"
}
```

### Common Error Codes

| Status | Code | Cause |
|--------|------|-------|
| 400 | `session_id_required` | Missing `session_id` in request body |
| 400 | `email_required` | Missing email in customer update |
| 400 | `full_name_required` | Missing name in customer update |
| 401 | `invalid_embed_session_token` | Token is malformed, expired, or signature doesn't match |
| 403 | `embed_origin_not_allowed` | Request origin doesn't match token's `allowed_origin` |
| 403 | `embed_scope_insufficient` | Token doesn't have the required scope for this endpoint |
| 403 | `embed_origin_binding_required_for_transactional_scopes` | Token with transactional scopes must have an `allowed_origin` |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /embed-sessions` | 60 req/min per API key |
| `POST /embed/start` | 30 req/min per session |
| `POST /embed/chat` | 20 req/min per session |
| `POST /embed/track` | 60 req/min per session |
| `POST /embed/offers/apply` | 10 req/min per session |
| `POST /embed/payment/intents` | 5 req/min per session |

Rate-limited responses return `429 Too Many Requests` with a `Retry-After` header.

---

## Token Format

Embed session tokens are `base64url(payload).base64url(hmac_sha256(payload))`:

```
<base64url-json-payload>.<base64url-hmac-signature>
```

Decoded payload structure:
```json
{
  "typ": "aacp_embed_v1",
  "merchantId": "cm_abc123",
  "installationId": "inst_xyz",
  "environment": "live",
  "issuedAtUnix": 1692913500,
  "expiresAtUnix": 1692914400,
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "allowedOrigin": "https://checkout.example.com",
  "scopes": ["checkout:start", "checkout:chat"],
  "cartRef": "cart_456"
}
```

Tokens are validated server-side on every request. The widget never reads the token contents directly.
