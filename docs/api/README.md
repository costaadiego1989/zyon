# AACP Public API v1 — Reference

The AACP API is a RESTful, JSON-over-HTTPS interface for managing agentic checkout experiences. It exposes 23 resource modules with 100+ endpoints covering the full checkout lifecycle: sessions, orders, payments, analytics, webhooks, and more.

## Base URL

```
https://api.aacp.dev/v1
```

All endpoints are prefixed with `/v1`. The OpenAPI specification is available at:

- Interactive docs: `https://api.aacp.dev/docs`
- Raw spec: `https://api.aacp.dev/openapi.json`

## Authentication

Every request must include one of:

| Method | Header / Mechanism | Use Case |
|--------|-------------------|-----------|
| API Key (Bearer) | `Authorization: Bearer aacp_live_...` | Service-to-service integrations |
| Session Cookie | `aacp_session=...` | Dashboard / console access |

API keys come in two environments: `test` and `live`. Keys are scoped — each key is granted a subset of the 31 available permission scopes.

See [AUTHENTICATION.md](./AUTHENTICATION.md) for full details.

## Response Envelope

All successful responses are wrapped in a standard envelope:

```json
{
  "data": { ... },
  "meta": {
    "request_id": "req_1723987654321",
    "timestamp": "2026-08-18T14:30:00.000Z",
    "version": "v1"
  }
}
```

For paginated endpoints, the envelope includes a `pagination` field:

```json
{
  "data": [ ... ],
  "meta": {
    "request_id": "req_1723987654321",
    "timestamp": "2026-08-18T14:30:00.000Z",
    "version": "v1"
  },
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTE3VDEwOjAwOjAwLjAwMFoiLCJpZCI6Im9yZF8xMjM0NSJ9",
    "has_more": true
  }
}
```

## Pagination

List endpoints use **cursor-based pagination** (keyset). Pass `limit` (max 100, default 20) and `cursor` to traverse pages.

See [PAGINATION.md](./PAGINATION.md) for full guide.

## Idempotency

Mutation endpoints (POST, PUT, PATCH) support the `Idempotency-Key` header to ensure exactly-once processing:

```
Idempotency-Key: idk_unique-request-id-here
```

- Keys are scoped per merchant and per endpoint.
- Replaying a request with the same key and body returns the original response.
- Replaying with the same key but a different body returns `409 Conflict`.
- Keys expire after 24 hours.

## Error Format

Errors follow [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807):

```json
{
  "type": "https://api.aacp.dev/errors/validation_error",
  "title": "Validation Error",
  "status": 422,
  "detail": "One or more fields failed validation.",
  "instance": "/v1/checkouts",
  "errors": [
    {
      "field": "customer.email",
      "message": "must be a valid email address",
      "code": "invalid_format"
    }
  ]
}
```

See [ERRORS.md](./ERRORS.md) for the full error reference.

## Rate Limits

| Tier | Requests / minute | Burst |
|------|-------------------|-------|
| Free | 60 | 10 |
| Pro | 600 | 50 |
| Enterprise | 6,000 | 200 |

Rate limit headers are included in every response:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 594
X-RateLimit-Reset: 1723987700
```

When exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header.

## Versioning

The API is versioned via the URL path (`/v1`). Breaking changes are introduced only in new major versions. Non-breaking additions (new fields, new endpoints) may be added to v1 at any time.

**Deprecation policy**: Fields and endpoints are marked deprecated at least 90 days before removal. Deprecated items include a `Sunset` header with the removal date.

## Wire Format

- Request and response bodies use **snake_case** field names.
- Dates are ISO 8601 strings (`2026-08-18T14:30:00.000Z`).
- IDs are prefixed strings (e.g., `chk_abc123`, `ord_xyz789`).
- Monetary amounts are integers in the smallest currency unit (cents).

## Resources

| Module | Endpoints | Description |
|--------|-----------|-------------|
| [Checkouts](#) | 8 | Create and manage checkout sessions |
| [Orders](#) | 5 | Order lifecycle management |
| [Products](#) | 5 | Product catalog CRUD |
| [Categories](#) | 5 | Product category management |
| [Webhooks](#) | 6 | Event subscription endpoints |
| [Coupons](#) | 4 | Coupon creation and validation |
| [Analytics](#) | 6 | Dashboard and product analytics |
| [Customers](#) | 3 | Customer profiles and history |
| [Experiments](#) | 9 | A/B testing and feature experiments |
| [Settings](#) | 8 | Checkout, agent, store, SEO config |
| [Payments](#) | 3 | Payment intent lifecycle |
| [Team](#) | 5 | Team member and invitation management |
| [Returns](#) | 2 | Return requests |
| [Domains](#) | 3 | Custom domain configuration |
| [Support](#) | 2 | Support settings and tickets |
| [Shipping](#) | 1 | Shipping quote calculation |
| [Fulfillment](#) | 2 | Shipment creation and tracking |
| [Notifications](#) | 4 | Transactional notification triggers |
| [Cross-Sell](#) | 3 | Cross-sell rule management |
| [Installations](#) | 5 | App/plugin installation management |
| [Audit](#) | 1 | Audit event log |
| [Billing](#) | 5 | Plans, subscription, usage, invoices |
| [Commerce](#) | 6 | Platform connections (WooCommerce, Magento, VTEX) |

## SDK

Install the official TypeScript SDK:

```bash
npm install zyon-sdk
```

```typescript
import { createClient } from 'zyon-sdk';
import { getOrders } from 'zyon-sdk/dist/generated/orders/orders';
import { getCheckouts } from 'zyon-sdk/dist/generated/checkouts/checkouts';
import { getWebhooks } from 'zyon-sdk/dist/generated/webhooks/webhooks';

// Initialize SDK
const client = createClient({
  apiKey: 'aacp_test_xxxxx',
  environment: 'sandbox', // or 'production'
});

// Get API methods for each resource
const { ordersList, ordersGet } = getOrders();
const { checkoutsCreate } = getCheckouts();
const { webhooksList, webhooksCreate } = getWebhooks();

// Start a checkout
const checkout = await checkoutsCreate({
  product_url: 'https://store.example.com/products/widget',
  product_name: 'Widget',
  product_price: 4990,
  currency: 'BRL',
  customer: { email: 'buyer@example.com' }
});

// List orders
const orders = await ordersList({ limit: 20 });

// Create a webhook
const webhook = await webhooksCreate({
  url: 'https://myapp.com/webhooks/aacp',
  events: ['order.created', 'checkout.completed']
});
```

**Links:**
- [npm: zyon-sdk](https://www.npmjs.com/package/zyon-sdk)
- [SDK Source (GitHub)](https://github.com/zyon-platform/aacp/tree/main/packages/sdk)
- [SDK README](https://github.com/zyon-platform/aacp/blob/main/packages/sdk/README.md)

## Quick Links

- [Quickstart](./QUICKSTART.md) — Make your first API call
- [Authentication](./AUTHENTICATION.md) — Keys, scopes, and sessions
- [Errors](./ERRORS.md) — Error codes and handling
- [Pagination](./PAGINATION.md) — Cursor-based pagination guide
- [Webhooks](./WEBHOOKS.md) — Event subscriptions and verification
