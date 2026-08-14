# Commerce Sync Spec

## Goal

Synchronize cart/order/product facts with commerce platforms via headless APIs. Commerce adapters create orders and process payments through platform APIs (WooCommerce REST, Magento REST, VTEX PPP). The widget IS the checkout — no redirect to platform checkout.

## Requirements

- COM-REQ-001: Commerce adapters implement `CommerceAdapter` port interface.
- COM-REQ-002: Cart price/stock validation must happen server-side before payment.
- COM-REQ-003: Browser-supplied cart totals are not authoritative in production embed flow.
- COM-REQ-004: Commerce order can be created as pending before payment.
- COM-REQ-005: Commerce order is marked paid only after payment approved.
- COM-REQ-006: Commerce sync must be merchant-scoped and adapter-based.
- COM-REQ-007: WooCommerce is the first commerce adapter (REST API + Stripe gateway).
- COM-REQ-008: Magento adapter uses REST API + Braintree/Stripe nonce tokenization.
- COM-REQ-009: VTEX adapter implements Payment Provider Protocol (PPP) — Zyon is the payment provider.
- COM-REQ-010: Tray Commerce viability pending evaluation.

## Supported Platforms

| Platform | API Type | Payment Model |
|---|---|---|
| WooCommerce | REST API v3 | Gateway SDK (Stripe PaymentIntent) |
| Magento | REST API v1 | Tokenized nonce (Braintree/Stripe) |
| VTEX | PPP (Payment Provider Protocol) | VTEX sends card data to us |
| Tray Commerce | REST API (TBD) | Transparent checkout token (TBD) |

## Non-Goals

- SaaS billing.
- Inventory reservation beyond provider-supported capabilities.
- Shopify/Nuvemshop integration (excluded — no headless checkout support).
