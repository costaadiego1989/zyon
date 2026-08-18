# Webhooks

Receive real-time notifications when checkout events occur.

## Overview

Athom can notify your backend when key events happen:
- A checkout session completes
- A payment is confirmed
- An offer is applied
- A buyer completes an order

## Setup

### 1. Register a Webhook Endpoint

[TODO] — Webhook registration is currently managed via the Athom Console or by contacting support. A self-service API endpoint is planned.

### 2. Expected Endpoint Behavior

Your endpoint must:
- Accept `POST` requests with `Content-Type: application/json`
- Return `2xx` status within 10 seconds
- Be publicly accessible (no VPN-only URLs)

Example (Node.js):

```javascript
// POST /webhooks/athom
app.post("/webhooks/athom", (req, res) => {
  const event = req.body;

  switch (event.type) {
    case "checkout.completed":
      handleCheckoutCompleted(event.payload);
      break;
    case "payment.confirmed":
      handlePaymentConfirmed(event.payload);
      break;
    case "offer.applied":
      handleOfferApplied(event.payload);
      break;
    default:
      console.log("Unknown event type:", event.type);
  }

  res.status(200).json({ received: true });
});
```

---

## Event Types

### checkout.completed

Fired when a buyer completes the checkout flow (payment confirmed).

```json
{
  "id": "evt_abc123",
  "type": "checkout.completed",
  "created_at": "2024-01-15T14:30:00Z",
  "payload": {
    "session_id": "session_xyz",
    "merchant_id": "cm_abc123",
    "order_id": "ord_def456",
    "total_amount": 27400,
    "currency": "BRL",
    "payment_method": "pix",
    "customer": {
      "email": "buyer@example.com",
      "name": "Maria Silva"
    },
    "items": [
      {
        "external_id": "sku_001",
        "name": "Wireless Headphones",
        "price": 29900,
        "quantity": 1
      }
    ],
    "offer_applied": {
      "id": "offer_789",
      "type": "free_shipping",
      "discount_amount": 2500
    }
  }
}
```

### payment.confirmed

Fired when a payment intent transitions to `confirmed` status.

```json
{
  "id": "evt_def456",
  "type": "payment.confirmed",
  "created_at": "2024-01-15T14:30:00Z",
  "payload": {
    "intent_id": "pi_abc123",
    "session_id": "session_xyz",
    "merchant_id": "cm_abc123",
    "method": "pix",
    "amount": 27400,
    "currency": "BRL",
    "confirmed_at": "2024-01-15T14:30:00Z"
  }
}
```

### offer.applied

Fired when a buyer accepts and applies a negotiated offer.

```json
{
  "id": "evt_ghi789",
  "type": "offer.applied",
  "created_at": "2024-01-15T14:28:00Z",
  "payload": {
    "session_id": "session_xyz",
    "merchant_id": "cm_abc123",
    "offer_id": "offer_789",
    "offer_type": "free_shipping",
    "discount_amount": 2500,
    "original_total": 29900,
    "new_total": 27400,
    "trigger": "shipping_objection_detected"
  }
}
```

### payment.failed

Fired when a payment attempt fails.

```json
{
  "id": "evt_jkl012",
  "type": "payment.failed",
  "created_at": "2024-01-15T14:35:00Z",
  "payload": {
    "intent_id": "pi_abc123",
    "session_id": "session_xyz",
    "merchant_id": "cm_abc123",
    "method": "card",
    "amount": 27400,
    "error_code": "card_declined",
    "error_message": "Insufficient funds"
  }
}
```

---

## Security

### Signature Verification

[TODO] — Webhook signature verification (HMAC-based) is planned. Until then, use IP allowlisting to verify webhook authenticity.

### IP Allowlist

Webhook requests originate from:
- `34.95.X.X/24` (production)
- [TODO: document production IPs]

### Best Practices

1. **Verify the signature** (when available)
2. **Respond quickly** — return 200 before processing heavy logic
3. **Handle duplicates** — use `event.id` for idempotency
4. **Store raw payloads** — log the full event body for debugging

---

## Retry Policy

If your endpoint returns a non-2xx status or times out:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |
| 6 | 12 hours |
| 7 | 24 hours |

After 7 failed attempts, the webhook is marked as failed. You can view and retry failed webhooks in the Athom Console.

---

## Testing Webhooks

### Using ngrok (local development)

```bash
ngrok http 3000
# Copy the https://xxx.ngrok.io URL and register as webhook endpoint
```

### Using the CLI [TODO]

```bash
athom webhooks test \
  --event checkout.completed \
  --url http://localhost:3000/webhooks/athom
```

### Sample Payloads

Use these for testing your handler without a real checkout:

```bash
curl -X POST http://localhost:3000/webhooks/athom \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_test_001",
    "type": "checkout.completed",
    "created_at": "2024-01-15T14:30:00Z",
    "payload": {
      "session_id": "session_test",
      "merchant_id": "cm_test",
      "order_id": "ord_test",
      "total_amount": 5000,
      "currency": "BRL",
      "payment_method": "pix",
      "customer": {
        "email": "test@example.com",
        "name": "Test User"
      },
      "items": [
        {
          "external_id": "test_sku",
          "name": "Test Product",
          "price": 5000,
          "quantity": 1
        }
      ],
      "offer_applied": null
    }
  }'
```

---

## Filtering Events [TODO]

When the webhook registration API is available, you'll be able to subscribe to specific events:

```json
{
  "url": "https://mystore.com/webhooks/athom",
  "events": ["checkout.completed", "payment.confirmed"],
  "secret": "whsec_abc123"
}
```

Until then, filter by `event.type` in your handler.
