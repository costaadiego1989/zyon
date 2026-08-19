# Public API v1 — Implementation Status

> Source of truth for REST v1 headless API surface.
> Last updated: 2026-08-18
> **Status: COMPLETE — 23 modules, 100+ endpoints**

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
- Barrel: `apps/api/src/modules/public-api/public-api.module.ts` (23 modules)
- Routes registered in: `apps/api/src/shared/http/api-documentation.ts` → `PUBLIC_OPERATIONS`
- Auth: `TenantCredentialGuard` + `TenantAccessGuard` + `@RequireTenantAccess`
- Envelope: `@UseInterceptors(ResponseEnvelopeInterceptor)` → `{ data, meta, pagination? }`
- Pagination: `CursorPaginationHelper` (cursor = base64 JSON)
- Idempotency: `@Idempotent()` on mutations
- Wire format: snake_case (DTOs transform to/from camelCase domain)

## ✅ Complete Implementation

### 1. Checkouts (8 endpoints)
- POST /checkouts
- GET /checkouts/:id
- POST /checkouts/:id/events
- POST /checkouts/:id/messages
- POST /checkouts/:id/shipping/evaluate
- POST /checkouts/:id/offers
- POST /checkouts/:id/complete
- PATCH /checkouts/:id/cart

### 2. Orders (5 endpoints)
- GET /orders
- GET /orders/:id
- POST /orders/:id/cancel
- GET /orders/:id/tracking
- PATCH /orders/:id/tracking

### 3. Products (5 endpoints)
- GET /products
- GET /products/:id
- POST /products
- PATCH /products/:id
- DELETE /products/:id

### 4. Categories (5 endpoints)
- GET /categories
- POST /categories
- GET /categories/:id
- PATCH /categories/:id
- DELETE /categories/:id

### 5. Webhooks (6 endpoints)
- GET /webhooks
- POST /webhooks
- GET /webhooks/:id
- PUT /webhooks/:id
- DELETE /webhooks/:id
- POST /webhooks/:id/test

### 6. Coupons (4 endpoints)
- GET /coupons
- POST /coupons
- PATCH /coupons/:id
- POST /coupons/:id/validate

### 7. Analytics (6 endpoints)
- GET /analytics/dashboard
- GET /analytics/products
- GET /analytics/products/:id
- GET /analytics/offers/roi
- GET /analytics/payments
- GET /analytics/customers

### 8. Customers (3 endpoints)
- GET /customers
- GET /customers/:id
- GET /customers/:id/orders

### 9. Experiments (9 endpoints)
- GET /experiments
- POST /experiments
- GET /experiments/:id
- PATCH /experiments/:id
- POST /experiments/:id/start
- POST /experiments/:id/stop
- POST /experiments/:id/archive
- GET /experiments/:id/results
- POST /experiments/:id/promote

### 10. Settings (8 endpoints)
- GET /settings/checkout
- PUT /settings/checkout
- GET /settings/agent-rules
- PUT /settings/agent-rules
- GET /settings/store
- PUT /settings/store
- GET /settings/seo
- PUT /settings/seo

### 11. Payments (3 endpoints)
- POST /payments/intents
- GET /payments/intents/:id
- POST /payments/intents/:id/confirm

### 12. Team (5 endpoints)
- GET /team/members
- POST /team/invitations
- POST /team/invitations/:id/accept
- PATCH /team/members/:id/role
- DELETE /team/members/:id

### 13. Returns (2 endpoints)
- GET /returns
- POST /returns

### 14. Domains (3 endpoints)
- GET /domains
- POST /domains
- POST /domains/:id/verify

### 15. Support (2 endpoints)
- GET /support/settings
- GET /support/tickets

### 16. Shipping (1 endpoint)
- POST /shipping/quotes

### 17. Fulfillment (2 endpoints)
- POST /fulfillment/shipments
- GET /fulfillment/shipments

### 18. Notifications (4 endpoints)
- POST /notifications/order-confirmation
- POST /notifications/order-shipped
- POST /notifications/order-delivered
- POST /notifications/return-approved

### 19. Cross-Sell (3 endpoints)
- GET /cross-sells
- POST /cross-sells
- GET /cross-sells/eligible

### 20. Installations (5 endpoints)
- GET /installations
- POST /installations
- GET /installations/:id
- PATCH /installations/:id
- DELETE /installations/:id

### 21. Audit (1 endpoint)
- GET /audit-events

### 22. Billing (5 endpoints) — *human-only*
- GET /billing/plans
- GET /billing/subscription
- POST /billing/subscription/change
- GET /billing/usage
- GET /billing/invoices

### 23. Commerce (6 endpoints)
- GET /commerce/connections
- POST /commerce/connections
- GET /commerce/connections/:id
- PATCH /commerce/connections/:id
- DELETE /commerce/connections/:id
- POST /commerce/connections/:id/sync

**Supported platforms:** WooCommerce, Magento, VTEX

## Scopes Added

```typescript
TENANT_API_SCOPES = [
  "checkout:read", "checkout:write",
  "configuration:read", "configuration:write",
  "orders:read", "orders:write",
  "customers:read",
  "catalog:read",
  "embed:sessions:create",
  "tracking:read", "tracking:write",
  "commerce:read", "commerce:write",
  "payments:read",
  "support:read", "support:write",
  "webhooks:read", "webhooks:write",
  "audit:read",
  "analytics:read",
  "coupons:read", "coupons:write",
  "experiments:read", "experiments:write",
  "team:read", "team:write",
  "returns:read", "returns:write",
  "installations:read", "installations:write",
  "billing:read", "billing:write",
  "integrations:read", "integrations:write",
]
```

## Verification

✅ `pnpm typecheck` — 0 errors
✅ All 23 modules wired in `PublicApiModule`
✅ All routes registered in `PUBLIC_OPERATIONS`
✅ All scopes added to `TENANT_API_SCOPES`
✅ snake_case wire format + class-validator on all DTOs
✅ Entity mappers (domain → DTO) for all resources
✅ Thin controllers — zero business logic, pure delegation

## Boundaries

**Public API v1 (headless, merchant-facing):**
- Anything in `apps/api/src/modules/public-api/`
- Authenticates via API key (service) or session cookie (human)
- Tenant-scoped via `merchant_id`

**Internal/Frontend (not part of v1):**
- `auth` — registration/login (public routes)
- `checkout` — internal orchestration
- `embed` — widget session tokens
- `storefront` — chat conversations
- `buyer-account` — buyer registrations (for widget)
- `self-checkout` — internal flow
- `merchant` — merchant profile
- `__test__` — test fixtures

## Next Steps

1. **Documentation** — Update API reference (ADR, API specs, migration guide)
2. **SDK Generation** — Orval: OpenAPI → TypeScript SDK
3. **Webhook Events** — Event catalog documentation
4. **Error Codes** — Per-endpoint error reference
5. **Integration Tests** — E2E for all 23 modules
