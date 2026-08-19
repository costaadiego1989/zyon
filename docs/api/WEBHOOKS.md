# Webhooks

Webhooks allow your application to receive real-time notifications when events occur in AACP. Instead of polling the API, you can subscribe to events and receive HTTP POST callbacks.

## Setting Up Webhooks

### 1. Create a Webhook Endpoint

```bash
curl -X POST https://api.aacp.dev/v1/webhooks \
  -H "Authorization: Bearer $AACP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: idk_webhook_setup_1" \
  -d '{
    "url": "https://myapp.example.com/webhooks/aacp",
    "events": [
      "checkout.completed",
      "order.confirmed",
      "order.shipped",
      "payment.succeeded",
      "payment.failed"
    ],
    "description": "Production webhook",
    "active": true
  }'
```

**Response:**

```json
{
  "data": {
    "id": "wh_abc123def456",
    "url": "https://myapp.example.com/webhooks/aacp",
    "events": [
      "checkout.completed",
      "order.confirmed",
      "order.shipped",
      "payment.succeeded",
      "payment.failed"
    ],
    "secret_key": "whsec_live_xyz789... (show only once)",
    "active": true,
    "created_at": "2026-08-18T14:30:00.000Z"
  },
  "meta": {
    "request_id": "req_1723987800000",
    "timestamp": "2026-08-18T14:30:00.000Z",
    "version": "v1"
  }
}
```

**Store the `secret_key`** — you will not see it again. Use it to verify webhook signatures.

### 2. Verify Your Endpoint

Test the endpoint before production use:

```bash
curl -X POST https://api.aacp.dev/v1/webhooks/wh_abc123def456/test \
  -H "Authorization: Bearer $AACP_API_KEY"
```

---

## Webhook Payload Format

All webhooks are delivered as HTTP POST requests with this structure:

```json
{
  "id": "evt_abc123",
  "type": "order.confirmed",
  "timestamp": "2026-08-18T14:30:00.000Z",
  "merchant_id": "acct_merchant123",
  "data": {
    "order_id": "ord_xyz789",
    "customer_email": "customer@example.com",
    "total": 31490,
    "currency": "BRL",
    "status": "confirmed"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for this event |
| `type` | string | Event type (e.g., `order.confirmed`) |
| `timestamp` | string | ISO 8601 event timestamp |
| `merchant_id` | string | Your merchant ID (tenant boundary) |
| `data` | object | Event-specific payload |

---

## Event Types Catalog

### Checkout Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `checkout.created` | New checkout session started | `{ checkout_id, product_url, product_price, currency }` |
| `checkout.event_tracked` | Customer event recorded (page view, button click, etc.) | `{ checkout_id, event_type, metadata }` |
| `checkout.message_sent` | LLM message sent to customer | `{ checkout_id, message_id, content }` |
| `checkout.offer_applied` | Discount or shipping offer applied | `{ checkout_id, offer_id, discount_percent, discount_amount }` |
| `checkout.completed` | Checkout converted to order | `{ checkout_id, order_id, total }` |
| `checkout.abandoned` | Checkout timed out or cancelled | `{ checkout_id, abandoned_at }` |

### Order Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `order.confirmed` | Order confirmed and payment captured | `{ order_id, customer_email, total, currency }` |
| `order.shipped` | Order dispatched (tracking number provided) | `{ order_id, tracking_number, carrier, estimated_days }` |
| `order.delivered` | Order delivery confirmed | `{ order_id, delivered_at }` |
| `order.cancelled` | Order cancelled by merchant or customer | `{ order_id, reason, cancelled_at }` |
| `order.returned` | Return request initiated | `{ order_id, return_id, reason }` |

### Payment Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `payment.intent_created` | Payment intent created | `{ payment_id, order_id, amount, currency }` |
| `payment.succeeded` | Payment captured successfully | `{ payment_id, order_id, amount, payment_method }` |
| `payment.failed` | Payment declined or error | `{ payment_id, order_id, amount, error_code, error_message }` |
| `payment.refunded` | Refund issued | `{ payment_id, order_id, refund_amount, reason }` |

### Customer Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `customer.created` | New customer profile created | `{ customer_id, email, name }` |
| `customer.updated` | Customer profile updated | `{ customer_id, email, name, previous_values }` |

---

## Signature Verification

Every webhook includes an `X-Webhook-Signature` header. Verify it to ensure the request genuinely came from AACP.

### Header Format

```
X-Webhook-Signature: t=1723987800,v1=...
```

### Verification Algorithm

1. Extract `t` (timestamp) and `v1` (signature) from the header.
2. Construct the signed content: `{timestamp}.{raw_request_body}`
3. Compute HMAC-SHA256 using your webhook secret.
4. Compare the computed signature with the provided `v1` value.
5. Check that the timestamp is recent (within 5 minutes) to prevent replay attacks.

### Example (Node.js)

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(rawBody, headerValue, secret) {
  // Parse header
  const parts = headerValue.split(',').reduce((acc, part) => {
    const [key, value] = part.trim().split('=');
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signatureV1 = parts.v1;

  // Check timestamp freshness (5 minute tolerance)
  const age = Date.now() / 1000 - parseInt(timestamp);
  if (age > 300) {
    throw new Error('Webhook signature too old');
  }

  // Compute signature
  const signedContent = `${timestamp}.${rawBody}`;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(signedContent)
    .digest('hex');

  // Compare
  if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signatureV1))) {
    throw new Error('Webhook signature verification failed');
  }

  return true;
}

// Usage
app.post('/webhooks/aacp', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    verifyWebhookSignature(req.body, req.headers['x-webhook-signature'], process.env.AACP_WEBHOOK_SECRET);
    const event = JSON.parse(req.body);
    
    // Process event
    handleWebhookEvent(event);
    res.status(200).send({ ok: true });
  } catch (err) {
    console.error('Webhook verification failed:', err);
    res.status(403).send({ error: 'Forbidden' });
  }
});
```

---

## Retry Policy

AACP attempts delivery with exponential backoff:

| Attempt | Delay | Total Time |
|---------|-------|-----------|
| 1 | Immediate | 0s |
| 2 | 5 seconds | 5s |
| 3 | 10 seconds | 15s |
| 4 | 30 seconds | 45s |
| 5 | 60 seconds | 105s |
| 6 | 120 seconds | 225s |
| 7 | 300 seconds | 525s |
| 8 | 600 seconds | 1125s |

After 8 failed attempts, the webhook is marked as failed and manually reviewed.

### Endpoint Requirements

- Respond with `2xx` status code within 30 seconds.
- Any `4xx` or `5xx` response triggers a retry.
- Timeout or connection error triggers a retry.

---

## Best Practices

1. **Return `200 OK` quickly** — process events asynchronously.
2. **Verify signatures** — always validate `X-Webhook-Signature`.
3. **Check timestamp freshness** — reject old signatures.
4. **Idempotency** — use `event.id` to prevent duplicate processing.
5. **Store `event.id`** — in your database to detect replays.
6. **Handle out-of-order events** — webhooks can arrive in any order.
7. **Test with the test endpoint** — before going live.
8. **Monitor delivery** — use the [GET /v1/webhooks/:id/deliveries](#) endpoint to debug failed deliveries.
