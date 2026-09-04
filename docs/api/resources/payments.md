# Payments

Create and manage payment intents for checkout sessions (Stripe integration).

## Endpoints

### POST /v1/payments/intents

Create a payment intent for a checkout session.

**Auth:** `checkout:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| session_id | string | Yes | Checkout session ID |
| idempotency_key | string | No | Client-generated idempotency key |
| method | string | Yes | Payment method (credit_card, pix, boleto) |
| accepted_offer_id | string | No | Offer applied at checkout |
| credit_card | object | No | Credit card token data (from frontend) |

**Response:**
```json
{
  "data": {
    "intent_id": "pi_abc123",
    "session_id": "sess_xyz",
    "status": "requires_confirmation",
    "amount": 4990,
    "currency": "BRL",
    "method": "credit_card",
    "client_secret": "pi_abc123_secret_def456",
    "created_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

**cURL Example:**
```bash
curl -X POST https://api.aacp.dev/v1/payments/intents \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "sess_xyz",
    "method": "credit_card",
    "accepted_offer_id": "offer_abc"
  }'
```

### GET /v1/payments/intents/:id

Get current status of a payment intent.

**Auth:** `payments:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Payment intent ID |
| session_id | string (query) | Yes | Session ID for validation |

**Response:**
```json
{
  "data": {
    "intent_id": "pi_abc123",
    "session_id": "sess_xyz",
    "status": "succeeded",
    "amount": 4990,
    "currency": "BRL",
    "method": "credit_card",
    "paid_at": "2024-08-18T10:30:05Z",
    "created_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/payments/intents/:id/confirm

Confirm a payment intent (Stripe client-side confirmation flow).

**Auth:** `checkout:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| session_id | string | Yes | Checkout session ID |

**Response:**
```json
{
  "data": {
    "intent_id": "pi_abc123",
    "status": "succeeded",
    "confirmed_at": "2024-08-18T10:30:05Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:05Z",
    "version": "v1"
  }
}
```
