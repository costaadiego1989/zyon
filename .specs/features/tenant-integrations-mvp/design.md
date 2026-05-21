# Tenant Integrations MVP Design

## Architecture

The new bounded context is `integrations`. It owns merchant API keys, webhook endpoints, webhook deliveries, webhook signing, and server-to-server tenant routes. It imports checkout read/write ports for order lookup and tracking updates, and fulfillment ports for shipment persistence.

Checkout remains the source of truth for purchase completion. Integrations receives checkout facts asynchronously through the existing outbox/event bus and stores tenant webhook deliveries. Tenant receiver outages are isolated to delivery retry state.

Fulfillment becomes durable for shipments/tracking events. The in-memory adapter remains for fast E2E, while Prisma supports pilot persistence.

## Data Model

- `merchant_api_keys`: hashed API keys, prefix, scopes, timestamps, revoked state.
- `merchant_webhook_endpoints`: endpoint URL, events, signing secret, active flag.
- `merchant_webhook_deliveries`: payload envelope, status, attempts, next attempt, response summary.
- `shipments`: merchant order/session tracking state.
- `tracking_events`: shipment timeline events.

## Authentication

Dashboard routes use existing merchant JWT guard.

Server-to-server routes use API key guard:

- Read key from `Authorization: Bearer` or `X-AACP-API-Key`.
- Hash and lookup active key.
- Attach `{ merchantId, keyId, scopes }` to the request.
- Require route scopes such as `embed:sessions`, `orders:tracking`, `webhooks:read`.

## Webhook Envelope

```json
{
  "event_id": "evt_...",
  "event_type": "order.approved",
  "merchant_id": "mrc_demo",
  "occurred_at": "2026-05-21T00:00:00.000Z",
  "api_version": "2026-05-21",
  "data": {}
}
```

Signature base string:

```text
<timestamp>.<raw-json-body>
```

Signature header:

```text
sha256=<hex-hmac>
```

## Event Mapping

- `order.completed` -> `order.approved`
- `order.tracking.updated` -> `order.tracking.updated`
- Checkout/session customer capture with merchant context -> `customer.upserted`

First implementation can publish `customer.upserted` during approved order enrichment when session customer data exists, then expand to earlier capture events.

## Tracking Inbound

`PUT /integrations/orders/:external_order_id/tracking`

Body:

```json
{
  "tracking_code": "BR123456789",
  "carrier": "correios",
  "tracking_url": "https://...",
  "status": "in_transit",
  "events": [
    {
      "status": "posted",
      "description": "Objeto postado",
      "occurred_at": "2026-05-21T00:00:00.000Z",
      "location": "Sao Paulo"
    }
  ]
}
```

The use case resolves the completed order by merchant and external order id, updates checkout tracking, upserts shipment, stores events, and queues `order.tracking.updated`.

## Dashboard UX

Add top-level tabs:

- `Integracoes`: API key creation/revocation, webhook endpoint form, test send, delivery log/replay.
- `Pedidos/Envios`: completed orders, missing tracking filter, tracking update form.
- `Clientes`: merchant-scoped customer records from checkout sessions/purchases.
- `Embed`: production snippet, API key issuance guidance, allowed origin/cart reference token flow.

## Checkout Enterprise Theme

Extend `MerchantTheme` with optional premium tokens:

- `surfaceColor`, `mutedTextColor`, `successColor`, `warningColor`
- `fontDisplay`, `borderRadius`, `density`
- `backgroundImageUrl`, `headerTitle`, `headerSubtitle`, `trustBadges`

The widget maps these tokens to CSS variables and keeps layout stable. Defaults avoid a one-note purple look and favor a quiet enterprise palette.

## Verification Strategy

- Unit tests for key hashing, scope guard, signature, delivery creation, retry/replay, tracking inbound validation, theme validation.
- Prisma integration tests for new tables and tracking update persistence.
- Dashboard tests for integration forms and theme editor behavior.
- Widget tests for theme variable mapping and completion state.
- Playwright real-api for checkout -> webhook -> tracking inbound -> hub lookup -> success.
