# ADR-0030: Store Builder Internal Product Catalog & SKU Management

**Status:** Proposed (pending RFC approval)  
**Date:** 2026-08-14  
**Author:** Diego  
**Reviewers:** Engineering Team

## Context

The current AACP platform integrates with external commerce platforms (Shopify, WooCommerce, Magento, VTEX, etc.) for product catalog, inventory, and orders. The Zyon Agentic Store Builder (Product 2) requires an internal product database since merchants create their catalog directly in Zyon, not via external platforms.

Decision needed: schema design, multi-tenancy isolation, variant management, stock reservation model, price override rules.

## Decision

Adopt a **simplified internal catalog schema** following AACP's existing patterns:

### Schema Pattern
- **Product** (name, description, SKU prefix, category_id, merchant_id, created_at, updated_at)
- **ProductVariant** (product_id, sku, attributes_json, barcode, created_at, updated_at)
- **ProductMedia** (variant_id, url, type (image|video), alt_text, order, created_at)
- **ProductStock** (variant_id, merchant_warehouse_id, quantity, reserved, created_at, updated_at)
- **ProductPrice** (variant_id, currency, base_price, cost_price, tax_percent, created_at, updated_at)
- **ProductReview** (product_id, buyer_id, rating, title, body, approved, created_at)
- **ProductCategory** (merchant_id, name, slug, parent_id, created_at, updated_at)
- **ProductCollection** (merchant_id, name, description, created_at, updated_at)
- **CollectionProduct** (collection_id, product_id, order)

### Multi-Tenancy Isolation
- All queries scoped by `merchant_id`
- SKU prefixes per merchant (e.g., `MERCHANT_ALIAS_001`)
- No cross-merchant visibility (ACL pattern per ADR-0002)
- Audit log per product change (MerchantAuditEvent)

### Variant Management
- Attributes stored as JSON object (keys: size, color, weight, voltage, etc.)
- No fixed attribute schema — merchants define their own
- SKU = base_product_sku + variant_identifier (e.g., `TEE_001_RED_M`)
- Barcode optional per variant

### Stock Reservation Model
- **ProductStock.reserved** = quantities held by active checkout sessions
- Reservation expires after 30 min if checkout not completed
- BullMQ job for expiry cleanup
- Stock allocation: `quantity - reserved > 0` required for cart addition
- On checkout completion: confirmed → reserved → deducted from quantity

### Price Override Rules
- **ProductPrice** stores base prices
- Merchant can define **PromotionRule** (discount % or fixed amount)
- Rules apply via **rules-engine** (existing pattern) — no duplicate logic
- Price calculated at checkout time via `calculatePrice()` tool (consistent with current checkout)

## Consequences

### Positive
- Leverages existing Prisma schema patterns
- ACL isolation proven (existing checkout module)
- Reuses rules-engine for promotions (no new discount engine)
- SKU flexibility (no fixed structure)
- Audit trail per change (existing MerchantAuditEvent)

### Negative
- Merchants cannot import 100K+ products via bulk upload v1 (async import job future work)
- JSON attributes lack indexing (search-by-attribute queries slow until indexed)
- No audit trail per individual attribute change (only full product updates)
- Variant explosion risk if merchants define 50+ attributes (UX concern)

## Alternatives Considered

1. **Exact replica of commerce platform schemas** (Shopify products model)
   - ❌ Adds 30+ tables, overly complex for MVP
   - ✅ Better alignment with existing commerce integrations

2. **Ultra-simple schema** (Product + Media only, attributes in product.data_json)
   - ✅ Minimal tables
   - ❌ Stock and pricing hard to query/manage
   - ❌ No audit trail

3. **NoSQL for catalog** (MongoDB for product docs)
   - ❌ Breaks existing all-Postgres architecture (ADR-0001)
   - ❌ Cross-service transaction complexity

**Chosen: Simplified SQL schema**, balances complexity vs capability.

## Implementation Notes

- Add 10 new Prisma models
- Create `catalog` module (if not exists) or extend existing one
- Implement `CatalogRepository` (Prisma repo per ADR-0004)
- Use-cases: `add-product`, `update-product-variant`, `reserve-stock`, `list-products-for-merchant`
- Integrate stock reservation with existing `add-to-cart` flow in checkout module
- Add Zod schemas for ProductVariant attributes (validation)

## Rollout

- Implemented in Phase 1 (Foundation)
- E2E tests covering multi-tenant isolation
- Bulk import async job (Phase 2 or later)
