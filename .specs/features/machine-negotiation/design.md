# Machine Negotiation Design

## Core Principle

Machine negotiation has two layers:

1. Deterministic negotiation engine computes the allowed agreement.
2. AI agents phrase proposals inside the allowed agreement.

The deterministic engine is the source of truth. It must be pure, tested, and reusable by API, workers, and future real-time negotiation sessions.

## Package

```text
packages/negotiation-engine/
  src/
    index.ts
    index.spec.ts
  package.json
  tsconfig.json
```

## Algorithm

1. Resolve merchant policy for each cart item:
   - SKU/item override.
   - Category override.
   - Global default.
2. Choose the most restrictive feasible policy for the cart:
   - Lowest merchant `maxDiscountPercent` across matched items.
   - Highest merchant `minOfferDiscountPercent` across matched items.
3. Verify both agents have machine negotiation enabled.
4. Estimate AI calls:
   - `maxRounds * 2`, one merchant-agent call and one buyer-agent call per round.
5. Estimate cost:
   - `estimatedCalls * estimatedCostPerAiCallCents`.
6. Deny if cost exceeds buyer or merchant cap.
7. Compute overlap:
   - Merchant can offer between `[merchantMin, merchantMax]`.
   - Buyer accepts anything at or above `buyerMinimumAcceptableDiscountPercent`.
8. Agreement discount:
   - `max(merchantMin, buyerMinimumAcceptableDiscountPercent)`.
   - Must be `<= merchantMax`.
9. Output audit details.

## Why Smallest Satisfying Discount

The merchant agent should not give away margin just because the buyer target is high. If buyer wants 20%, accepts 8%, and merchant range is 5-12%, the agreement is 8%, not 12% or 20%.

## Future Persistence

Future modules can persist:

- `MerchantNegotiationPolicy`
- `BuyerAgentNegotiationPreferences`
- `NegotiationSession`
- `NegotiationRound`
- `NegotiationCostLedger`
- `NegotiationAgreement`

Every persisted object must include `merchant_id`; buyer-owned configs should also include `global_user_id` but must not be queried across merchants for merchant-specific decisions.

## Future API

Merchant:

- `GET /merchant-negotiation-policy`
- `PUT /merchant-negotiation-policy`

Buyer/user agent:

- `GET /buyer-agent/preferences`
- `PUT /buyer-agent/preferences`

Negotiation:

- `POST /negotiations/evaluate`
- `POST /negotiations/:id/accept`

The first implementation is intentionally a pure package so policy can stabilize before persistence and public API.
