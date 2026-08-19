# Checkouts

AI-powered checkout sessions with event tracking, messaging, offers, and cart management.

## Endpoints

### POST /v1/checkouts

Start a new AI-powered checkout session.

**Auth:** `checkout:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| session_id | string | No | Unique session identifier |
| cart_reference | string | No | Reference to external cart |
| items | array | Yes | Array of checkout items |
| items[].sku | string | Yes | Product SKU |
| items[].name | string | Yes | Product name |
| items[].quantity | number | Yes | Item quantity |
| items[].price | number | Yes | Price in minor units (cents) |
| items[].image_url | string | No | Product image URL |
| customer | object | No | Customer hints |
| customer.email | string | No | Customer email |
| customer.full_name | string | No | Customer full name |
| customer.phone | string | No | Customer phone number |
| customer.cpf | string | No | Customer CPF (Brazil) |
| currency | string | Yes | Currency code (BRL, USD, EUR) |

**Response:**
```json
{
  "data": {
    "session_id": "sess_abc123",
    "merchant_id": "merch_xyz",
    "status": "active",
    "created_at": "2024-08-18T10:30:00Z",
    "expires_at": "2024-08-18T11:30:00Z"
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
curl -X POST https://api.aacp.dev/v1/checkouts \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "sku": "SKU-001",
        "name": "Product A",
        "quantity": 1,
        "price": 4990
      }
    ],
    "currency": "BRL"
  }'
```

### GET /v1/checkouts/:id

Get checkout session details and current state.

**Auth:** `checkout:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Checkout session ID |

**Response:**
```json
{
  "data": {
    "session_id": "sess_abc123",
    "status": "active",
    "items": [
      {
        "sku": "SKU-001",
        "quantity": 1,
        "price": 4990
      }
    ],
    "cart_total": 4990,
    "offers": [],
    "messages": []
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/checkouts/:id/events

Track checkout lifecycle events.

**Auth:** `checkout:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| event | string | Yes | Event type |
| metadata | object | No | Event-specific metadata |

**Allowed events:**
- checkout_started
- cart_viewed
- shipping_calculated
- shipping_option_selected
- shipping_objection_detected
- coupon_field_clicked
- payment_method_selected
- payment_failed
- exit_intent_detected
- idle_30_seconds
- offer_viewed
- offer_accepted
- order_completed
- checkout_abandoned

**Response:**
```json
{
  "data": {
    "event_id": "evt_xyz",
    "event": "checkout_started",
    "recorded_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/checkouts/:id/messages

Send messages to the AI agent and receive responses.

**Auth:** `checkout:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversation_id | string | Yes | Conversation identifier |
| user_message | string | Yes | User message text |

**Response:**
```json
{
  "data": {
    "conversation_id": "conv_xyz",
    "agent_response": "Thank you for your interest...",
    "response_type": "offer_suggestion",
    "generated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/checkouts/:id/shipping/evaluate

Evaluate shipping options for the cart.

**Auth:** `checkout:read`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| cart_value | number | No | Cart value in minor units |
| shipping_price | number | No | Shipping price quote |
| shipping_real_cost | number | No | Actual shipping cost |
| abandonment_score | number | No | Abandonment risk (0-1) |

**Response:**
```json
{
  "data": {
    "options": [
      {
        "carrier": "sedex",
        "estimated_days": 5,
        "price": 1500,
        "recommended": true
      }
    ],
    "recommended_subsidy": 500
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/checkouts/:id/offers

Apply an offer to the checkout session.

**Auth:** `checkout:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| offer_id | string | Yes | Offer identifier |

**Response:**
```json
{
  "data": {
    "offer_id": "offer_abc123",
    "discount_value": 999,
    "discount_type": "fixed",
    "new_total": 3991,
    "applied_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/checkouts/:id/complete

Complete the checkout and create an order.

**Auth:** `checkout:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| external_order_id | string | Yes | Order ID from commerce platform |
| order_total | number | Yes | Final order total in minor units |
| currency | string | Yes | Currency code |
| accepted_offer_id | string | No | Applied offer ID |
| tracking_code | string | No | Order tracking code |

**Response:**
```json
{
  "data": {
    "order_id": "order_123",
    "session_id": "sess_abc123",
    "status": "completed",
    "final_total": 3991,
    "completed_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PATCH /v1/checkouts/:id/cart

Update cart items in an active checkout session.

**Auth:** `checkout:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| items | array | Yes | Updated item list |
| items[].sku | string | Yes | Product SKU |
| items[].quantity | number | Yes | New quantity |

**Response:**
```json
{
  "data": {
    "session_id": "sess_abc123",
    "items": [
      {
        "sku": "SKU-001",
        "quantity": 2,
        "price": 4990
      }
    ],
    "cart_total": 9980,
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
