# Checkout Agentic Config Matrix

This matrix maps the main business-rule knobs of the agentic checkout to the test coverage that protects them.

## Commercial Rules

| Config | Purpose | Runtime owner | Covered by |
| --- | --- | --- | --- |
| `maxDiscountPercent` | Caps AI discount offers | `MerchantRules` | `checkout.ai-safety-scenarios.spec.ts`, `send-chat-message.use-case.spec.ts`, `checkout.ai-live-e2e-spec.ts` |
| `minimumMarginPercent` | Prevents offers that hurt margin | `rules-engine` / `shipping-engine` | `checkout.ai-safety-scenarios.spec.ts`, `apply-offer.use-case.spec.ts` |
| `allowFreeShipping` | Enables or disables free shipping offers | `shipping-engine` | `checkout.ai-safety-scenarios.spec.ts`, `shipping-engine/src/index.spec.ts` |
| `allowShippingDiscount` | Enables partial freight subsidy | `shipping-engine` | `checkout.ai-safety-scenarios.spec.ts`, `shipping-engine/src/index.spec.ts` |
| `allowStackDiscountAndFreeShipping` | Blocks stacking discount + free shipping | `shipping-engine` | `shipping-engine/src/index.spec.ts`, `checkout.ai-live-e2e-spec.ts` |
| `freeShippingMinCartValue` | Threshold for free shipping | `MerchantRules` | `shipping-engine` specs, checkout journey specs |
| `maxShippingSubsidy` | Hard cap for freight subsidy | `shipping-engine` | `checkout.ai-safety-scenarios.spec.ts` |
| `maxPartialShippingDiscount` | Cap for partial freight discount | `shipping-engine` | `shipping-engine` specs |
| `couponBoxEnabled` | Shows or hides coupon-related UX | `CheckoutExperience` / merchant config | `send-chat-message.use-case.spec.ts`, `checkout.ai-live-e2e-spec.ts` |
| `quickReplies` | Stage-specific quick reply copy | `CheckoutExperience` | `send-chat-message.use-case.spec.ts`, `checkout.ai-live-e2e-spec.ts` |
| `blockedRegions` | Blocks freight by region | `shipping-engine` | shipping and AI safety scenarios |
| `offerExpirationMinutes` | Limits offer lifetime | checkout offer flow | `apply-offer.use-case.spec.ts` |

## Operational Rules

| Config | Purpose | Runtime owner | Covered by |
| --- | --- | --- | --- |
| `agentMode` | Silent vs proactive intervention | `checkout-settings` | `checkout-settings.use-cases.spec.ts`, `checkout.ai-live-e2e-spec.ts` |
| `openWidgetOnTrigger` | Opens widget when trigger fires | `checkout-settings` | `checkout-settings.entity.spec.ts` |
| `cooldownSeconds` | Prevents repeated interventions | `checkout-settings` | intervention-ledger tests |
| `maxInterventionsPerSession` | Caps agent interventions per session | `checkout-settings` / ledger | `checkout.intervention-ledger.e2e-spec.ts` |
| `triggerPreferences` | Which events can wake the agent | `checkout-settings` | `track-checkout-event.use-case.spec.ts` |
| `handoffEnabled` | Enables handoff path | `checkout-settings` | `checkout-settings.use-cases.spec.ts` |

## Guardrail Notes

- Commercial authorization lives in `MerchantRules`, not in `checkout-settings`.
- `checkout-settings` must stay free of discount, frete, offer, payment-status and similar commercial keys.
- `couponBoxEnabled` must persist through Prisma-backed merchant and checkout repositories.
- `allowStackDiscountAndFreeShipping=false` must block shipping offers when a cart already has discount.

## Real E2E Coverage

- `checkout.ai-live-e2e-spec.ts` now exercises:
  - payment-stage quick replies
  - coupon box visibility
  - stack-discount guardrail
  - live AI phrasing with real merchant rules

