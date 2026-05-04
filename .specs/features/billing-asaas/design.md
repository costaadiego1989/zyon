# Billing Asaas Design

## Boundary

`billing` owns merchant subscription, plan, quota, invoice/payment status for the SaaS relationship, and feature gates.

## Flow

1. Merchant starts on trial or selected plan.
2. Application modules emit metering events.
3. Billing records usage idempotently.
4. Quota policy determines whether a paid/enriched feature is allowed.
5. Asaas billing adapter creates/updates merchant customer and subscription.
6. Asaas billing webhook updates invoice/subscription status.

## Initial Billable Events

- `purchase_history.context_used`
- `purchase_history.imported_order`
- `negotiation.history_enriched`
- future AI/live-provider calls

## Feature Gates

Billing should block or downgrade paid add-ons such as enriched history context or machine negotiation, but should not make the base checkout unusable.
