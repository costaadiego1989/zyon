# Payment Asaas Spec

## Goal

Add a payment module that charges the buyer inside the AACP checkout using provider adapters. Asaas is the first provider. Payment is separate from commerce sync and separate from merchant SaaS billing.

## Requirements

- PAY-REQ-001: Create a payment intent for a checkout session.
- PAY-REQ-002: Payment intents must be merchant-scoped and checkout-session-scoped.
- PAY-REQ-003: Payment creation must be idempotent per merchant/session/payment method.
- PAY-REQ-004: The API must not persist raw card number or CVV.
- PAY-REQ-005: Payment provider credentials must never be exposed to the widget.
- PAY-REQ-006: Asaas webhook handling must be idempotent by provider event/payment id.
- PAY-REQ-007: Payment approved must emit a payment fact and complete the checkout order once.
- PAY-REQ-008: Payment failed must emit a payment fact and may trigger conversation, but must not complete the order.
- PAY-REQ-009: Payment status claims remain deterministic; the AI may not invent approval or failure.
- PAY-REQ-010: Future payment providers must implement the same `PaymentProviderPort`.

## Payment Statuses

- `pending`
- `requires_action`
- `approved`
- `failed`
- `cancelled`
- `refunded`

## Non-Goals

- Storing card number or CVV.
- Replacing commerce adapters.
- Charging merchants for SaaS usage. That belongs to billing.
