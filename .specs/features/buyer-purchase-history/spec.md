# Buyer Purchase History Spec

## Goal

Create a merchant-scoped purchase history module for each buyer/global user. This module gives checkout, agent-rules, and future machine negotiation a compact commercial memory without leaking data across merchants.

## Requirements

- BPH-REQ-001: Store completed purchase facts by `merchant_id`.
- BPH-REQ-002: Link history to `global_user_id` when present, and support merchant-local customer identifiers when global identity is not yet known.
- BPH-REQ-003: Import purchase facts idempotently from completed checkout orders and future commerce webhooks.
- BPH-REQ-004: Keep item-level purchase facts: SKU, product title, category, quantity, unit price, currency, discount applied, and completion date.
- BPH-REQ-005: Maintain buyer-merchant stats: order count, lifetime value, average order value, last order date, top categories, top SKUs, and discount sensitivity.
- BPH-REQ-006: Expose a safe context DTO for agent-rules and checkout conversation.
- BPH-REQ-007: Never expose raw PII, payment details, card data, internal margins, or cross-merchant history to the agent context.
- BPH-REQ-008: Provide deterministic tests for aggregation, idempotency, tenant isolation, and context redaction.
- BPH-REQ-009: Support cost-aware context compression so AI prompts receive summaries instead of long order timelines.
- BPH-REQ-010: Track usage for future billing when purchase history enrichment is used by AI or machine negotiation.

## Non-Goals

- Cross-merchant buyer profiling for merchant decisions.
- Payment reconciliation.
- Refund accounting beyond safe flags and future adjustment events.
- Real-time recommendation ranking.

## Agent Context Shape

```json
{
  "purchase_history": {
    "known_buyer": true,
    "orders_count": 6,
    "lifetime_value": 1240.5,
    "average_order_value": 206.75,
    "last_order_at": "2026-04-20T12:00:00.000Z",
    "top_categories": ["running-shoes", "accessories"],
    "recent_skus": ["shoe-001", "sock-002"],
    "discount_sensitivity": "medium",
    "returning_customer_copy_hint": "Thank the buyer for coming back without mentioning private details."
  }
}
```

The context is deliberately compact. The AI can use it to personalize tone, but checkout and negotiation engines still authorize offers.

## Monetization Notes

- Free tier: basic returning-customer flag and last purchase recency bucket.
- Paid tier: enriched purchase context, category affinity, discount sensitivity, and negotiation memory.
- Cost control: summarize history deterministically before calling the LLM.
- Billing event candidates:
  - `purchase_history.context_used`
  - `purchase_history.imported_order`
  - `negotiation.history_enriched`
