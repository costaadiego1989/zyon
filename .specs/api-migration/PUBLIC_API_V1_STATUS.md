# Public API v1 — Implementation Status

> Source of truth for REST v1 headless API surface.
> Last updated: 2026-08-18
> **Status: COMPLETE — All 19 modules, 86 endpoints implemented**

## Architecture

- Pattern: Thin presentation layer delegating to existing use-cases
- Location: `apps/api/src/modules/public-api/{resource}/`
- Structure per resource:
  ```
  {resource}/
    presentation/http/{resource}-v1.controller.ts
    presentation/http/dtos/{resource}.dtos.ts
    application/mappers/{resource}-entity.mapper.ts
    public-api-{resource}.module.ts
  ```
- Barrel: `apps/api/src/modules/public-api/public-api.module.ts` (19 modules)
- Routes registered in: `apps/api/src/shared/http/api-documentation.ts` → `PUBLIC_OPERATIONS`
- Auth: `TenantCredentialGuard` + `TenantAccessGuard` + `@RequireTenantAccess`
- Envelope: `@UseInterceptors(ResponseEnvelopeInterceptor)` → `{ data, meta, pagination? }`
- Pagination: `CursorPaginationHelper` (cursor = base64 JSON)
- Idempotency: `@Idempotent()` on mutations
- Wire format: snake_case (DTOs transform to/from camelCase domain)

## ✅ Complete Implementation (86 endpoints)

### Checkouts (8 endpoints)
- POST /checkouts
- GET /checkouts/:id
- POST /checkouts/:id/events
- POST /checkouts/:id/messages
- POST /checkouts/:id/shipping/evaluate
- POST /checkouts/:id/offers
- POST /checkouts/:id/complete
- PATCH /checkouts/:id/cart

### Orders (5 endpoints)
- GET /orders
- GET /orders/:id
- POST /orders/:id/cancel
- GET /orders/:id/tracking
- PATCH /orders/:id/tracking

### Products (5 endpoints)
- GET /products
- GET /products/:id
- POST /products
- PATCH /products/:id
- DELETE /products/:id

### Categories (5 endpoints)
- GET /categories
- POST /categories
- GET /categories/:id
- PATCH /categories/:id
- DELETE /categories/:id

### Webhooks (6 endpoints)
- GET /webhooks
- POST /webhooks
- GET /webhooks/:id
- PUT /webhooks/:id
- DELETE /webhooks/:id
- POST /webhooks/:id/test

### Coupons (4 endpoints)
- GET /coupons
- POST /coupons
- PATCH /coupons/:id
- POST /coupons/:id/validate

### Analytics (6 endpoints)
- GET /analytics/dashboard
- GET /analytics/products
- GET /analytics/products/:id
- GET /analytics/offers/roi
- GET /analytics/payments
- GET /analytics/customers

### Customers (3 endpoints)
- GET /customers
- GET /customers/:id
- GET /customers/:id/orders

### Experiments (9 endpoints)
- GET /experiments
- POST /experiments
- GET /experiments/:id
- PATCH /experiments/:id
- POST /experiments/:id/start
- POST /experiments/:id/stop
- POST /experiments/:id/archive
- GET /experiments/:id/results
- POST /experiments/:id/promote

### Settings (8 endpoints)
- GET /settings/checkout
- PUT /settings/checkout
- GET /settings/agent-rules
- PUT /settings/agent-rules
- GET /settings/store
- PUT /settings/store
- GET /settings/seo
- PUT /settings/seo

### Payments (3 endpoints)
- POST /payments/intents
- GET /payments/intents/:id
- POST /payments/intents/:id/confirm

### Team (5 endpoints)
- GET /team/members
- POST /team/invitations
- POST /team/invitations/:id/accept
- PATCH /team/members/:id/role
- DELETE /team/members/:id

### Returns (2 endpoints)
- GET /returns
- POST /returns

### Domains (3 endpoints)
- GET /domains
- POST /domains
- POST /domains/:id/verify

### Support (2 endpoints)
- GET /support/settings
- GET /support/tickets

### Shipping (1 endpoint)
- POST /shipping/quotes

### Fulfillment (2 endpoints)
- POST /fulfillment/shipments
- GET /fulfillment/shipments

### Notifications (4 endpoints)
- POST /notifications/order-confirmation
- POST /notifications/order-shipped
- POST /notifications/order-delivered
- POST /notifications/return-approved

### Cross-Sell (3 endpoints)
- GET /cross-sells
- POST /cross-sells
- GET /cross-sells/eligible

## Verification

✅ `pnpm typecheck` — 0 errors
✅ All 19 modules wired in `PublicApiModule`
✅ All routes registered in `PUBLIC_OPERATIONS`
✅ All scopes added to `TENANT_API_SCOPES`
✅ snake_case wire format + class-validator on all DTOs
✅ Entity mappers (domain → DTO) for all resources
✅ Thin controllers — zero business logic, pure delegation

## Next Steps

1. **Documentation** — Update API reference (ADR, API specs, migration guide)
2. **SDK Generation** — Orval: OpenAPI → TypeScript SDK
3. **Webhook Events** — Event catalog documentation
4. **Error Codes** — Per-endpoint error reference
