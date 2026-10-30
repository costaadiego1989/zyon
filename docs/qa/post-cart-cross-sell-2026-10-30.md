# Cross-sell after confirmed cart additions

## Read-only production finding

At 2026-10-30 23:13:06Z, deployment `46d1351a-cceb-4d8d-819b-ed1c3dc9eef7`, Athom had cross-sell enabled, complementary strategy and discounts enabled, but `touchpoints.post_cart=false`. Three active rules granted 10% for the standard serum SKU. Genuine bruma/creme/sunscreen variants had available stock. Evidence: local audit `production-crosssell-after-add-46.json`. No production state was changed by this patch.

## Behavior and boundaries

Ordinary NLP adds, native single adds, native catalog batches and the explicit product shortcut converge on the existing cart handler. That handler evaluates configured post-cart recommendations only after a successful add. The batch previously dropped its returned offers; the shortcut also discarded them. Both now preserve the real confirmed result; batch retains only the last successful result, avoiding stale offers from earlier lines. Failed/unknown adds never trigger replay for recommendations.

Recommendation identifiers resolve by exact variant ID/SKU, scoped to merchant, active variant/product and nondeleted product. Duplicate SKU matches are omitted, rather than selecting an arbitrary row. Hydration rechecks the same variant and available physical stock. There is no first-100-products scan or first-variant substitution. Work is bounded to 20 distinct identifier reads and 10 public suggestions maximum. Missing/ambiguous/unverifiable targets are omitted without claiming global absence.

Prices use the existing independent shopping price reader for this exact variant, including authorized automatic product promotions. It has no cart/coupon/stock writer. A zero-benefit rule works with store discounts still enabled: it does not inherit a discount from configuration, emit a coupon or send the legacy crossSellPromoId argument. Existing 10% cross-sell benefits remain unavailable through this legacy add surface until a valid benefit quote is integrated; these offers are omitted, never displayed at an unhonored discount or silently converted to full-price acceptance. Existing quote/admission protections remain intact.

Pending suggestions are not eligibility caches: current rule targets and discounts are refreshed through a repository compare-and-set scoped by id, merchant, session and pending status. The refresh changes only offer fields. If another request resolved the suggestion, the stale offer is omitted; accepted/declined status cannot be revived.

## Prepared genuine QA rule (not executed)

Use the merchant-authenticated canonical `POST /merchant/cross-sell/promotions` and preserve all three existing rules and discount settings. A bounded test rule may target the existing large serum variant, which is distinct from the standard SKU used by the 10% rules:

```json
{
  "name": "QA 20261030 - Serum grande e bruma complementar - sem beneficio",
  "trigger": { "sku_in_cart": ["APL-NUCLEO-696a583b-e0b8-4956-aea7-4f15037de32b-large"] },
  "recommended_skus": ["APL-BRUMA-696a583b-e0b8-4956-aea7-4f15037de32b"],
  "discount_percent": 0,
  "max_discount_percent": 0,
  "starts_at": "2026-10-30T23:00:00.000Z",
  "ends_at": "2026-10-31T02:00:00.000Z"
}
```

Re-read rule time window and current stock before creating it. The observed large serum stock was 24 and bruma stock 18. The base bruma price was 9990 cents; presentation must still use its current independent quote. Enable `touchpoints.post_cart` only through Athom's canonical settings path under the root agent's authorized production work. This document does not activate configuration or create the rule.

Acceptance: explicitly add the large serum once; confirm one add and one complementary bruma offer with correct variant/price. Repeat another successful add and verify re-evaluation, with no bruma auto-add. Explicitly select bruma and verify normal admission/stock checks; after it is in the cart it must stop being suggested. Missing stock, disabled/expired rules, other tenant, failed/unknown writes and quote failures must not yield an actionable offer or repeat the original add. Archive the QA rule through `DELETE /merchant/cross-sell/promotions/:id` after the controlled test. Do not modify the paid order, its cart, original rules, prices or stock to manufacture a result.

## Validation scope

Focused Node tests cover handler/tool to public block, native single/batch and shortcut projection, exact second variant, reserved stock, inactive/foreign/ambiguous products, canonical automatic promotion pricing, read failures, active-rule use case, current rule edits, real Prisma CAS persistence and concurrent acceptance. Production configuration/stock were observed read-only. No WhatsApp send, deploy, seed execution or production acceptance was performed by this patch author.

Final local gate: 239/239 tests passed across 13 suites/files with the network guard enabled; diff check passed. Independent review identified the repository-refresh issue and verified its CAS correction, with no remaining concrete P1/P2 finding in this scope. Full integrated compilation and production verification remain the release owner's gates.
