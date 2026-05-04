# AI Checkout MVP Spec

## Requirements

- REQ-001: Merchants can read and update commercial, shipping, and brand voice rules.
- REQ-002: A checkout session starts with `merchant_id`, cart, customer hints, `session_id`, and `global_user_id`.
- REQ-003: Repeated buyer hints reuse the same `global_user_id`.
- REQ-004: Checkout events update abandonment score and can trigger the agent.
- REQ-005: Chat uses an LLM when configured and falls back to safe template messages when unavailable.
- REQ-006: The LLM never authorizes discounts, shipping subsidies, inventory promises, or delivery promises.
- REQ-007: Discount and shipping offers are approved only by deterministic rules.
- REQ-008: Shopify adapter creates a discount code or returns a deterministic dev fallback.
- REQ-009: Dashboard displays overview metrics, recent conversations, offers, and rules.
- REQ-010: All session and analytics data are isolated by `merchant_id`.

## Acceptance Criteria

- A local developer can run API, widget, and dashboard.
- A widget session can trigger chat after idle, coupon, or shipping events.
- A shipping objection can produce an approved, blocked, or fallback offer.
- Accepting an offer records `offer_accepted` and returns an apply URL.
- Completing checkout records `order_completed` and updates dashboard metrics.
