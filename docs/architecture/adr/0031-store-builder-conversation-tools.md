# ADR-0031: Store Builder Conversation State Machine & Tool Architecture

**Status:** Proposed  
**Date:** 2026-08-14  
**Author:** Diego  
**Context:** conversation-engine exists but expects external checkout context. Store Builder needs integrated conversation orchestration with tool-calling for product search, comparison, cart management.

## Decision

Implement **conversation state machine** within Store Builder as part of **Agentic Experience** bounded context.

### States (High-Level)
```
WELCOME → DISCOVERY → (PRODUCT_VIEW | COMPARISON | CART_REVIEW) → CHECKOUT_HANDOFF → ORDER_TRACKING
```

### Agent Tools (Deterministic, Framework-based)

| Tool | Input | Output | Auth | Timeout | Idempotent |
|------|-------|--------|------|---------|------------|
| `searchProducts` | query, filters (price, category), limit | [Product] | buyer_session | 2s | Yes |
| `getProductDetails` | product_id, variant_id? | Product + variants + media + reviews | buyer_session | 1s | Yes |
| `compareProducts` | product_ids[] | comparison table (specs, price, availability) | buyer_session | 2s | Yes |
| `getProductAvailability` | product_id, variant_id | {in_stock, qty, shipping_time} | buyer_session | 1s | Yes |
| `getProductReviews` | product_id, limit | [Review] | buyer_session | 1s | Yes |
| `addItemToCart` | product_id, variant_id, qty, preferences? | {cart_id, item_count, total_price} | buyer_session | 2s | Yes (idempotency_key) |
| `updateCartItem` | cart_id, item_id, qty | {cart_id, updated_item, total_price} | buyer_session | 2s | Yes |
| `removeCartItem` | cart_id, item_id | {cart_id, item_count, total_price} | buyer_session | 1s | Yes |
| `getCart` | cart_id | {items[], totals, promos_applied} | buyer_session | 1s | Yes |
| `quoteShipping` | cart_id, address | {options[], cheapest, fastest} | buyer_session | 3s | Yes |
| `applyCoupon` | cart_id, coupon_code | {discount_amount, new_total} | buyer_session | 1s | No (use idempotency_key) |
| `createCheckoutSession` | cart_id, buyer_email, shipping_method | {checkout_session_id, checkout_url} | buyer_session | 2s | Yes |

### Error Handling
- Tool failure → deterministic fallback message (no LLM retry)
- Stock depletion during cart → "apenas 2 unidades disponíveis, gostaria de continuar?"
- Shipping timeout → suggest chat with human support
- Payment provider error → exact error message (opaque) + support escalation

### Conversation Memory
- **Session-scoped**: cart_id, buyer_id, preferences (budget, shipping speed, categories)
- **Persistent** (if buyer logged in): previous purchases, wishlist, saved addresses
- **No cross-merchant leakage**: session tied to store_id

## Consequences

- Reuses existing checkout module cart logic (no duplication)
- Wraps tools in deterministic layer (LLM never directly modifies cart)
- Rules-engine handles all discounts/subsidies (consistent with current ADRs)
- Phone/session state can exceed 10 min with no issues (persistent store)

## Rollout

Phase 2-3 (Store Builder MVP → Storefront).
