# ADR-0032: Store Builder Dashboard UX Pattern & Tenant Isolation

**Status:** Proposed  
**Date:** 2026-08-14  
**Author:** Diego  
**Context:** Current dashboard handles Checkout integrations. Store Builder needs full e-commerce admin features (products, orders, analytics) but must not break existing checkout product.

## Decision

**One unified dashboard.** Feature gates by `plan` (Checkout vs Store Builder). Checkout merchants never see "Store" tabs. Store merchants never see "Integrations" tabs. Shared infrastructure (auth, sidebar, navigation).

### Conditional Sections

| Section | Checkout Plan | Store Plan | Shared |
|---------|---------------|-----------|--------|
| Checkout Settings | ✅ | ❌ | No |
| Commerce Integrations | ✅ | ❌ | No |
| Storefront Builder | ❌ | ✅ | No |
| Store Settings (Brand) | ❌ | ✅ | No |
| Catalog (Products) | ❌ | ✅ | No |
| Orders | ⚠️ Sync only | ✅ Full CRUD | (Different views) |
| Customers | Limited | ✅ Full | (Different views) |
| Billing & Plans | ✅ | ✅ | Shared |
| Integrations (Webhooks) | ✅ | ⚠️ Subset | (Different views) |

### Feature Flag Pattern
- `MERCHANT_PLAN` in `Merchant` model (enum: CHECKOUT_ONLY, STORE_ONLY, BOTH)
- All API endpoints gated: `if (merchant.plan !== STORE_ONLY) throw ForbiddenException(...)`
- Frontend conditional renders per plan

### Tenant Isolation at Dashboard Layer
- All queries include `merchant_id` from JWT
- No cross-merchant data in any response
- Analytics dashboard scoped to merchant's store_id (Store plan) or cart sources (Checkout)

## Implementation

- Extend existing React dashboard (no new frontend)
- New pages: `/dashboard/store`, `/dashboard/catalog`, `/dashboard/products`, `/dashboard/customers`
- Reuse existing pages (orders, billing, integrations) with conditional rendering
- API endpoints: POST /store, PUT /store/{id}, GET /products, POST /products, etc.

## Rollout

Phase 2 (Store Builder MVP).
