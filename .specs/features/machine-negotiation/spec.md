# Machine Negotiation Spec

## Goal

Enable future machine-to-machine negotiation between a merchant agent and a buyer/user agent while keeping commercial authority deterministic, auditable, and billable.

The merchant configures what can be offered. The buyer configures what their agent wants to negotiate. The negotiation engine computes whether there is an allowed agreement. AI agents may phrase proposals and counter-proposals, but they never create permission outside this deterministic result.

## Scope

### In Scope

- Merchant negotiation policies by global, category, and item scope.
- Merchant minimum offer discount and maximum allowed discount.
- Buyer negotiation preferences with target discount, minimum acceptable discount, budget, and AI cost cap.
- Deterministic agreement calculation for one cart.
- Estimated AI call budget and cost guardrails for machine-to-machine rounds.
- TDD scenarios for global, category, item override, no overlap, disabled negotiation, and cost caps.

### Out Of Scope

- Persisted buyer agents and merchant negotiation policies.
- Public API endpoints.
- Real multi-round LLM conversation loop.
- Charging integration with billing providers.
- Multi-merchant buyer history sharing.

## Requirements

- MN-REQ-001: Item policy overrides category policy, which overrides global policy.
- MN-REQ-002: A merchant policy must include `minOfferDiscountPercent` and `maxDiscountPercent`.
- MN-REQ-003: Buyer agent preferences must include `targetDiscountPercent`, `minimumAcceptableDiscountPercent`, and optional max AI cost.
- MN-REQ-004: Agreement exists only if merchant maximum is greater than or equal to buyer minimum acceptable discount.
- MN-REQ-005: The selected discount must be the smallest merchant concession that satisfies buyer minimum, bounded by merchant minimum and maximum.
- MN-REQ-006: Negotiation must be denied when merchant or buyer machine negotiation is disabled.
- MN-REQ-007: Negotiation must be denied when estimated AI cost exceeds buyer or merchant configured cap.
- MN-REQ-008: The output must include audit details explaining selected scope, selected discount, AI call estimate, and denial reason.
- MN-REQ-009: No LLM output may override this deterministic outcome.

## Buyer Agent Configuration

A buyer/user agent can configure:

- Desired target discount.
- Minimum acceptable discount.
- Maximum negotiation rounds.
- Maximum AI cost per negotiation.
- Preferred categories or item SKUs.
- Whether the agent can auto-accept an agreement.
- Whether human confirmation is required above a purchase value.

## Merchant Agent Configuration

A merchant agent can configure:

- Global discount range.
- Category discount ranges.
- Item/SKU discount ranges.
- Minimum margin requirement remains in merchant/decision rules.
- Whether machine negotiation is enabled.
- Maximum AI cost the merchant is willing to subsidize.
- Maximum rounds before fallback/handoff.

## Billing Model

The system should track:

- `estimated_ai_calls`: usually buyer agent + merchant agent per round.
- `estimated_ai_cost_cents`.
- `billing_strategy`: included quota, merchant-paid, buyer-paid, split, or platform-subsidized.
- `chargeable_event`: negotiation completed, agreement reached, or offer applied.

Recommended first product model:

- Free quota for deterministic/local negotiation simulations.
- Merchant pays for live agent negotiation attempts above quota.
- Optional success fee only when an offer is accepted/applied.
- Buyer agent can have a cost cap to avoid runaway AI usage.
