# Commerce Sync Spec

## Goal

Separate commerce integration from payment processing. Commerce adapters validate cart/order/product facts and synchronize order state with Shopify/WooCommerce/etc. Payment providers charge buyers.

## Requirements

- COM-REQ-001: Commerce adapters must not process buyer payments.
- COM-REQ-002: Cart price/stock validation must happen server-side before payment.
- COM-REQ-003: Browser-supplied cart totals are not authoritative in production embed flow.
- COM-REQ-004: Commerce order can be created as pending before payment.
- COM-REQ-005: Commerce order is marked paid only after payment approved.
- COM-REQ-006: Commerce sync must be merchant-scoped and adapter-based.
- COM-REQ-007: Shopify is the first real commerce adapter; WooCommerce is planned.

## Non-Goals

- Payment provider integration.
- SaaS billing.
- Inventory reservation beyond provider-supported capabilities.
