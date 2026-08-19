# Quickstart

Make your first API call in under 5 minutes.

## Prerequisites

- An AACP merchant account
- A test API key (see [Authentication](./AUTHENTICATION.md))

## 1. Get Your API Key

```bash
# Your test key looks like:
# sk_test_abc123def456...
export AACP_API_KEY="sk_test_your_key_here"
```

## 2. Create a Checkout Session

Start an agentic checkout session for a customer:

```bash
curl -X POST https://api.aacp.dev/v1/checkouts \
  -H "Authorization: Bearer $AACP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: idk_checkout_$(date +%s)" \
  -d '{
    "product_url": "https://store.example.com/products/premium-headphones",
    "product_name": "Premium Wireless Headphones",
    "product_price": 29900,
    "currency": "BRL",
    "customer": {
      "name": "Maria Silva",
      "email": "maria@example.com"
    }
  }'
```

**Response:**

```json
{
  "data": {
    "id": "chk_a1b2c3d4e5",
    "status": "active",
    "product_name": "Premium Wireless Headphones",
    "product_price": 29900,
    "currency": "BRL",
    "created_at": "2026-08-18T14:30:00.000Z"
  },
  "meta": {
    "request_id": "req_1723987800000",
    "timestamp": "2026-08-18T14:30:00.000Z",
    "version": "v1"
  }
}
```

## 3. Track a Checkout Event

Record customer interactions during the checkout:

```bash
curl -X POST https://api.aacp.dev/v1/checkouts/chk_a1b2c3d4e5/events \
  -H "Authorization: Bearer $AACP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "page_view",
    "metadata": {
      "page": "product_detail",
      "time_on_page_ms": 45000
    }
  }'
```

**Response:**

```json
{
  "data": {
    "id": "evt_x7y8z9",
    "checkout_id": "chk_a1b2c3d4e5",
    "event_type": "page_view",
    "created_at": "2026-08-18T14:31:00.000Z"
  },
  "meta": {
    "request_id": "req_1723987860000",
    "timestamp": "2026-08-18T14:31:00.000Z",
    "version": "v1"
  }
}
```

## 4. Evaluate a Shipping Option

Get shipping quotes for the checkout:

```bash
curl -X POST https://api.aacp.dev/v1/checkouts/chk_a1b2c3d4e5/shipping/evaluate \
  -H "Authorization: Bearer $AACP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "zip_code": "01310-100",
    "state": "SP"
  }'
```

**Response:**

```json
{
  "data": {
    "options": [
      {
        "carrier": "Correios",
        "method": "SEDEX",
        "price": 1590,
        "estimated_days": 3
      },
      {
        "carrier": "Correios",
        "method": "PAC",
        "price": 890,
        "estimated_days": 7
      }
    ]
  },
  "meta": {
    "request_id": "req_1723987900000",
    "timestamp": "2026-08-18T14:31:40.000Z",
    "version": "v1"
  }
}
```

## 5. Complete the Order

Convert the checkout session into an order:

```bash
curl -X POST https://api.aacp.dev/v1/checkouts/chk_a1b2c3d4e5/complete \
  -H "Authorization: Bearer $AACP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: idk_complete_chk_a1b2c3d4e5" \
  -d '{
    "shipping_method": "SEDEX",
    "shipping_address": {
      "street": "Av Paulista 1000",
      "city": "São Paulo",
      "state": "SP",
      "zip_code": "01310-100",
      "country": "BR"
    }
  }'
```

**Response:**

```json
{
  "data": {
    "order_id": "ord_m4n5o6p7",
    "checkout_id": "chk_a1b2c3d4e5",
    "status": "confirmed",
    "total": 31490,
    "created_at": "2026-08-18T14:32:00.000Z"
  },
  "meta": {
    "request_id": "req_1723987920000",
    "timestamp": "2026-08-18T14:32:00.000Z",
    "version": "v1"
  }
}
```

## 6. Retrieve the Order

Verify the order was created:

```bash
curl https://api.aacp.dev/v1/orders/ord_m4n5o6p7 \
  -H "Authorization: Bearer $AACP_API_KEY"
```

**Response:**

```json
{
  "data": {
    "id": "ord_m4n5o6p7",
    "checkout_id": "chk_a1b2c3d4e5",
    "status": "confirmed",
    "customer": {
      "name": "Maria Silva",
      "email": "maria@example.com"
    },
    "items": [
      {
        "name": "Premium Wireless Headphones",
        "price": 29900,
        "quantity": 1
      }
    ],
    "shipping": {
      "method": "SEDEX",
      "price": 1590,
      "estimated_days": 3
    },
    "total": 31490,
    "created_at": "2026-08-18T14:32:00.000Z"
  },
  "meta": {
    "request_id": "req_1723987950000",
    "timestamp": "2026-08-18T14:32:30.000Z",
    "version": "v1"
  }
}
```

## Next Steps

- Set up [Webhooks](./WEBHOOKS.md) to receive real-time event notifications
- Explore the [full API reference](https://api.aacp.dev/docs)
- Configure [Analytics](https://console.aacp.dev/analytics) in the dashboard
- Read about [Error Handling](./ERRORS.md) for production integrations
