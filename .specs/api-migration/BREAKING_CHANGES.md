# API Migration — Breaking Changes Registry

## Purpose
Document every breaking change during REST L2 migration. Each entry tracks old → new mapping, affected consumers, risk level, and mitigation strategy.

## Format

| Old Endpoint | New Endpoint | HTTP Method | Consumer(s) | Risk | Breaking | Mitigation |
|---|---|---|---|---|---|---|
| `/checkout/start-checkout` | `/v1/checkouts` | POST | widget_v2, storefront | HIGH | ✅ YES | Dual route + deprecation header |
| `/checkout/track-event` | `/v1/checkouts/{id}/events` | POST | widget_v2 | MEDIUM | ✅ YES | Adapter layer in widget |
| ... | ... | ... | ... | ... | ... | ... |

## Key Columns

- **Old Endpoint**: Current path used in production
- **New Endpoint**: REST L2 path
- **HTTP Method**: GET, POST, PATCH, PUT, DELETE
- **Consumer(s)**: Which app(s) call this endpoint
  - `widget_v2` = Widget embed iframe
  - `storefront` = Public storefront page
  - `dashboard` = Merchant dashboard
  - `api_client` = External SDK consumers (future)
  - `tests` = E2E or unit tests
- **Risk**: HIGH / MEDIUM / LOW
- **Breaking**: ✅ YES (response shape/URL changes) / ⚠️ PARTIAL (additive only) / ❌ NO (backward compat)
- **Mitigation**: How we keep it non-breaking during transition

---

## Migration Phases

### Phase 1: Foundation (3 modules)
### Phase 2: Core (7 modules)
### Phase 3: Consumer Updates (widget, storefront, dashboard)
### Phase 4: Cleanup

---

## Response Format Breaking Changes

### Request Path & Method
```
OLD:  POST /checkout/start-checkout
NEW:  POST /v1/checkouts

BREAKING: ✅ YES (URL changed)
MITIGATION: Dual route in legacy-compat/ layer
```

### Response Shape (Envelope)
```
OLD:
{
  "sessionId": "...",
  "status": "pending",
  "cart": [...]
}

NEW:
{
  "data": {
    "id": "...",
    "session_id": "...",
    "status": "pending",
    "cart": [...]
  },
  "meta": {
    "request_id": "...",
    "timestamp": "2026-08-18T...",
    "version": "v1"
  }
}

BREAKING: ✅ YES (field names + envelope structure)
MITIGATION: Widget adapter layer unwraps envelope + maps snake_case → camelCase
```

### Error Response
```
OLD:
{
  "statusCode": 422,
  "message": "Validation failed",
  "error": "Unprocessable Entity"
}

NEW: RFC 7807 ProblemDetails
{
  "type": "https://docs.aacp.dev/problems/validation_failed",
  "title": "Validation Failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "Cart is required",
  "fields": {
    "cart": ["Cart is required"]
  },
  "correlation_id": "req_..."
}

BREAKING: ✅ YES (error structure changed)
MITIGATION: Create error adapter in widget
```

### Field Naming Convention
```
OLD: camelCase in some places, inconsistent
  "sessionId", "customerId", "merchantId", "orderId"

NEW: snake_case everywhere (JSON API standard)
  "session_id", "customer_id", "merchant_id", "order_id"

BREAKING: ✅ YES (field names changed)
MITIGATION: Mapper layer converts back to camelCase for internal use
```

### Pagination
```
OLD: None (no standard)
  GET /orders → returns array directly

NEW: Cursor-based + envelope
  GET /v1/orders?cursor=abc123 → 
  {
    "data": [{...}, {...}],
    "meta": { ... },
    "pagination": {
      "cursor": "abc123",
      "has_more": true
    }
  }

BREAKING: ✅ YES (response shape)
MITIGATION: Widget adapter handles both old (array) and new (envelope)
```

---

## Module-by-Module Breaking Changes

### Checkout Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `POST /checkout/start-checkout` | `POST /v1/checkouts` | widget_v2, storefront | ✅ | Dual route |
| `POST /checkout/track-event` | `POST /v1/checkouts/{id}/events` | widget_v2 | ✅ | Adapter |
| `GET /checkout/{id}` | `GET /v1/checkouts/{id}` | widget_v2 | ⚠️ | Response envelope |
| `POST /checkout/chat/message` | `POST /v1/checkouts/{id}/messages` | widget_v2 | ⚠️ | Nested URL |
| `POST /checkout/shipping/evaluate` | `POST /v1/checkouts/{id}/shipping` | widget_v2 | ✅ | Nested URL + method |
| `POST /checkout/offers/apply` | `POST /v1/checkouts/{id}/offers` | widget_v2 | ✅ | Nested URL + POST |
| `POST /checkout/orders/complete` | `POST /v1/checkouts/{id}/complete` | widget_v2 | ✅ | Nested URL |

### Orders Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `GET /orders` | `GET /v1/orders` | dashboard, storefront | ⚠️ | Pagination |
| `GET /orders/:id` | `GET /v1/orders/{id}` | dashboard | ⚠️ | Envelope |
| `POST /orders` | `POST /v1/orders` | dashboard | ✅ | Envelope + fields |
| `PUT /orders/:id/status` | `PATCH /v1/orders/{id}` | dashboard | ✅ | HTTP method + URL |
| `GET /orders/:id/tracking` | `GET /v1/orders/{id}/tracking` | storefront | ⚠️ | Nested |
| `PUT /orders/:id/tracking` | `PATCH /v1/orders/{id}/tracking` | dashboard | ✅ | Method |

### Products Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `GET /merchants/:mid/products` | `GET /v1/merchants/{mid}/products` | dashboard, embed | ⚠️ | Pagination |
| `POST /merchants/:mid/products` | `POST /v1/merchants/{mid}/products` | dashboard | ✅ | Envelope |
| `GET /merchants/:mid/products/:pid` | `GET /v1/merchants/{mid}/products/{pid}` | dashboard, embed | ⚠️ | Envelope |
| `PUT /merchants/:mid/products/:pid` | `PATCH /v1/merchants/{mid}/products/{pid}` | dashboard | ✅ | Method |
| `DELETE /merchants/:mid/products/:pid` | `DELETE /v1/merchants/{mid}/products/{pid}` | dashboard | ❌ | URL only |

### Payments Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `POST /payment/intents` | `POST /v1/payments/intents` | widget_v2, embed | ✅ | Envelope |
| `GET /payment/intents/:id/status` | `GET /v1/payments/intents/{id}` | widget_v2 | ✅ | URL + fields |
| `POST /payment/intents/:id/stripe/confirm` | `POST /v1/payments/intents/{id}/confirm` | widget_v2 | ✅ | Nested URL |
| `POST /payment/intents/:id/crypto/confirm` | `POST /v1/payments/intents/{id}/crypto/confirm` | widget_v2 | ✅ | Nested URL |

### Shipping Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `POST /embed/shipping/quote` | `POST /v1/checkouts/{id}/shipping/quote` | widget_v2 | ✅ | Nested + method |
| `POST /embed/shipping/select` | `POST /v1/checkouts/{id}/shipping/select` | widget_v2 | ✅ | Nested |
| `POST /shipping/labels` | `POST /v1/shipments` | dashboard | ✅ | URL |
| `GET /shipping/tracking/:id` | `GET /v1/shipments/{id}/tracking` | storefront, dashboard | ⚠️ | Nested |

### Coupons Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `POST /merchant/coupons` | `POST /v1/merchants/{mid}/coupons` | dashboard | ✅ | URL |
| `GET /merchant/coupons` | `GET /v1/merchants/{mid}/coupons` | dashboard | ⚠️ | Pagination |
| `POST /embed/coupons/apply` | `POST /v1/checkouts/{id}/coupons` | widget_v2 | ✅ | Nested |
| `DELETE /merchant/coupons/:id` | `DELETE /v1/merchants/{mid}/coupons/{id}` | dashboard | ❌ | URL |

### Cross-Sell Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `POST /merchant/cross-sell/promotions` | `POST /v1/merchants/{mid}/cross-sell/promotions` | dashboard | ✅ | URL |
| `GET /merchant/cross-sell/promotions` | `GET /v1/merchants/{mid}/cross-sell/promotions` | dashboard | ⚠️ | Pagination |
| `POST /embed/cross-sell/suggest` | `POST /v1/checkouts/{id}/cross-sell/suggest` | widget_v2 | ✅ | Nested |
| `POST /embed/cross-sell/accept` | `POST /v1/checkouts/{id}/cross-sell/accept` | widget_v2 | ✅ | Nested |

### Settings & Configuration

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `GET /checkout-settings` | `GET /v1/merchants/{mid}/settings/checkout` | dashboard | ⚠️ | URL |
| `PUT /checkout-settings` | `PUT /v1/merchants/{mid}/settings/checkout` | dashboard | ⚠️ | ETag handling |
| `GET /agent-rules` | `GET /v1/merchants/{mid}/settings/agent-rules` | dashboard | ⚠️ | URL |
| `PUT /agent-rules` | `PUT /v1/merchants/{mid}/settings/agent-rules` | dashboard | ✅ | ETag |
| `GET /merchant/rules` | `GET /v1/merchants/{mid}/rules` | dashboard | ✅ | URL |

### Negotiations Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `POST /negotiations/evaluate` | `POST /v1/negotiations/evaluate` | widget_v2, api_client | ✅ | Envelope |
| `GET /negotiations/sessions` | `GET /v1/negotiations/sessions` | dashboard | ⚠️ | Pagination |
| `GET /negotiations/stats` | `GET /v1/merchants/{mid}/analytics/negotiations` | dashboard | ⚠️ | Moved |

### Support Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `GET /support/tickets` | `GET /v1/merchants/{mid}/support/tickets` | dashboard | ⚠️ | URL + pagination |
| `POST /support/tickets` | `POST /v1/merchants/{mid}/support/tickets` | widget_v2, dashboard | ✅ | URL |
| `GET /support/faq` | `GET /v1/merchants/{mid}/support/faq` | storefront | ⚠️ | URL |

### Integrations & Webhooks

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `POST /integrations/api-keys` | `POST /v1/merchants/{mid}/integrations/api-keys` | dashboard | ✅ | URL |
| `GET /integrations/webhooks` | `GET /v1/merchants/{mid}/integrations/webhooks` | dashboard | ⚠️ | Pagination |
| `POST /integrations/webhooks` | `POST /v1/merchants/{mid}/integrations/webhooks` | dashboard | ✅ | URL |
| `POST /webhook-endpoints` | `POST /v1/merchants/{mid}/integrations/webhooks` | api_client | ✅ | Consolidated |

### Analytics Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `GET /checkout/dashboard/overview/:mid` | `GET /v1/merchants/{mid}/analytics/checkout` | dashboard | ⚠️ | URL |
| `GET /checkout/funnel/:mid` | `GET /v1/merchants/{mid}/analytics/funnel` | dashboard | ⚠️ | Nested |
| `GET /merchants/:mid/analytics/products` | `GET /v1/merchants/{mid}/analytics/products` | dashboard | ⚠️ | URL |

### Experiments Module

| Old | New | Consumer | Breaking | Mitigation |
|-----|-----|----------|----------|-----------|
| `POST /experiments` | `POST /v1/merchants/{mid}/experiments` | dashboard | ✅ | URL |
| `GET /experiments` | `GET /v1/merchants/{mid}/experiments` | dashboard | ⚠️ | Pagination |
| `GET /experiments/:id/results` | `GET /v1/merchants/{mid}/experiments/{id}/results` | dashboard | ⚠️ | URL |

---

## Risk Assessment Summary

### HIGH RISK (Immediate fix needed in consumers)
- **18 endpoints** with URL path changes
- **9 endpoints** with HTTP method changes
- **All endpoints** with response envelope changes
- **Estimated widget_v2 impact**: 35+ touchpoints
- **Estimated storefront impact**: 15+ touchpoints

### MEDIUM RISK (May work with adapter)
- **12 endpoints** with pagination changes
- **Field naming** (camelCase → snake_case)
- **Error response** shape
- **Estimated fix time per consumer**: 2-3 hours with adapter layer

### LOW RISK (Additive, backward compat)
- **8 endpoints** with no URL changes
- **Response envelope** (can ignore new fields)
- **Pagination** (backward compat available via flag)

---

## Adapter Strategy

### For Widget_v2
```typescript
// apps/widget/src/lib/api/adapter.ts
type OldEndpoint = {
  sessionId: string;
  // ...
};

type NewEndpoint = {
  data: {
    session_id: string;
    // ...
  };
  meta: {
    request_id: string;
    // ...
  };
};

export const adaptV1Response = (v1: NewEndpoint): OldEndpoint => ({
  sessionId: v1.data.session_id,
  // ...
});

export const adaptOldRequest = (old: OldRequest): NewRequest => ({
  merchant_id: old.merchantId,
  // ...
});
```

### For Storefront
Similar adapter layer for `/storefront/...` → `/v1/...`

---

## Validation Checklist

Per module, before declaring Phase complete:

- [ ] Old routes still work (backward compat test passes)
- [ ] New v1 routes work (new test passes)
- [ ] Response shapes tested (envelope, fields, pagination)
- [ ] Error responses tested (RFC 7807 format)
- [ ] Deprecation headers present on old routes
- [ ] OpenAPI spec updated with v1 endpoints
- [ ] Widget e2e still green (using old routes + adapter)
- [ ] Storefront e2e still green (using old routes + adapter)
- [ ] Breaking changes documented
- [ ] Consumer impact assessed (widget, storefront, dashboard)
- [ ] Mitigation strategy defined and tested

