# Billing Asaas Spec

## Goal

Charge merchants for AACP SaaS usage. Billing is separate from buyer payment. Asaas is the first billing provider for merchant subscriptions/invoices.

## Requirements

- BIL-REQ-001: Track merchant plan, subscription status, trial, and usage quota.
- BIL-REQ-002: Consume metering events such as `purchase_history.context_used`.
- BIL-REQ-003: Usage events must be idempotent.
- BIL-REQ-004: Quota gates must block paid/enriched features without breaking basic checkout.
- BIL-REQ-005: Asaas billing webhooks must be idempotent.
- BIL-REQ-006: Billing provider secrets must never be exposed to browser clients.
- BIL-REQ-007: Billing must be merchant-scoped.

## Non-Goals

- Charging buyers.
- Payment intent creation for checkout.
- Commerce order sync.
