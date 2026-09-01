# ADR-0002: Cross-Sell Hardening — Real Catalog, Reais Unit, Structured Acceptance

**Date:** 2026-09-01  
**Status:** Approved  
**Context:** Live audit (E3 static, Athom merchant) uncovered 5 deceive-the-merchant
bugs in cross-sell module (Bugs 1-5, detailed below). Two systems coexist:
`CrossSellConfig` (JSON toggles) and `CrossSellPromotion` table (SKU-targeted
promos). Storefront path is conversational NL; widget legacy uses phantom prices.
All discount/price surfaces violated the invariant "LLM never authorizes price" +
"never invent prices / never deceive merchant/buyer."

## Problem

1. **Discount promised, never applied (CRITICAL, buyer-facing).** Card shows `-X%`,
   buyer adds item, cart charges full price. `onAddItem` discards the promoId and
   discount, sending only NL text; LLM can't reconstruct which promo was accepted.

2. **Phantom catalog prices (R$59,90 fallback).** `resolveCrossSellCartItem` /
   `resolveCrossSellProduct` hardcoded 4-SKU demo `CATALOG`; any real SKU → phantom
   price. Feeds widget accept AND chat builder (checkout widget).

3. **Unit mismatch cents/reais.** Promotion trigger `cart_total_above` has no unit
   contract. Helper feeds engine in reais; trigger may be entered/tested in cents.
   Promos mis-trigger at every threshold.

4. **Config field-drop (any-typed boundary).** Dashboard calls typed `any`; server
   deep-merge only spreads known keys. New UI field silently lost (coupon-CRUD
   failure mode).

5. **PUT wrapper asymmetry.** Create = flat; Update = `{patch:{...}}`. Silent
   no-op if future client sends flat.

## Decision

Harden all 5 surfaces via:

### 1. Structured Cross-Sell Acceptance (Bug 1)
- Storefront `onAddItem`: send structured quick-reply with `promoId` + `sku`,
  not NL text. Cart handler receives explicit promo id, loads promotion,
  validates, applies discount **server-side via deterministic rules-engine**
  (never trust client-sent discount). LLM stays out of price entirely.

### 2. Real Catalog Resolver (Bug 2)
- Replace `CATALOG` hardcode with `productRepo` lookup port (mirror storefront
  helper pattern). If SKU unknown, reject rather than invent price. No phantom
  prices anywhere (storefront, widget, chat).

### 3. Reais Unit Contract (Bug 3)
- Pin `trigger.cart_total_above` to **reais** (major units, matching `cart.total`).
  Document in entity + this ADR. Normalize at boundary if any caller sends cents.
  Add test crossing the threshold both ways.

### 4. Config Boundary Typing (Bug 4)
- Type `getCrossSellConfig` / `putCrossSellConfig` with shared `CrossSellConfig`
  type (not `any`). Audit server deep-merge for any missing top-level spreads.
  TypeScript enforces contract.

### 5. PUT Wrapper Flexibility (Bug 5)
- Update endpoint unwraps `body.patch ?? body`. Accept both shapes. Add test.

## Rationale

- **Invariant preservation:** LLM never authorizes price, merchant/buyer never
  deceived, prices always from stored catalog.
- **Reuse:** Coupon-boundary-mapping + food-structured-payload patterns already
  proven. Rules-engine deterministic discount already wired, just extend it.
- **Tenant safety:** `merchant_id` boundary enforced on every promo/config read.
- **Backward compat:** Widget legacy (out of scope UI) still gets real prices via
  Bug 2 fix; promotions CRUD API unchanged, just hardening.

## Implementation

See task breakdown in spec.md (Layer 1 → Layer 5). Storefront-first (E4 browser
test target). Widget legacy paths also fixed (no UI caller, but price data flows
correctly).

## Verification

E3 (deterministic, curl): structured accept payload → discount applied + capped.
E4 (Playwright, Athom): card discount shown ≠ cart discount applied → confirm
server-side recompute.

## Out of Scope

- Dashboard CRUD UI for promotions (design decision deferred; promotions populate
  via seed/API this round).
- Widget legacy accept UI changes (paths benefit from Bug 2 fix automatically).
