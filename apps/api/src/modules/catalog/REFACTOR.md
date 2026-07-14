# REFACTOR.md — Catalog Module

## Summary

The catalog module provides product search and SKU lookup for the widget (storefront) and dashboard. It is an adapter layer over the commerce module's catalog backend. The module is barely used and has minimal structural issues, but coupling is tight and the abstraction is thin (adds little value).

---

## Current State

```
apps/api/src/modules/catalog/
  catalog.module.ts                          # Imports: CheckoutModule, MerchantModule, CommerceModule, IntegrationsModule
  domain/
    ports/
      storefront-catalog.port.ts             # Simple interface: search, findBySku
  application/
    add-storefront-item.use-case.ts          # Adds product to session + publishes event
    search-storefront-products.use-case.ts   # Thin wrapper over port
  infrastructure/
    tenant-storefront-catalog.adapter.ts     # Proxies to CommerceCatalogReader
  presentation/
    http/
      catalog.controller.ts                  # Tenant API: GET /catalog, GET /catalog/:sku
      widget-catalog.controller.ts           # Widget API: GET /embed/catalog/search, POST /embed/catalog/add
```

---

## Findings

### CRITICAL

(none)

---

### HIGH

#### CAT-H1 — AddStorefrontItemUseCase couples to checkout + merchant repositories directly

- **File:** `application/add-storefront-item.use-case.ts`
- **Category:** Coupling / Dependency Inversion
- **Description:** The use-case injects 3 repositories:
  - `CHECKOUT_SESSION_REPOSITORY` (to load and save session + chat turns)
  - `MERCHANT_REPOSITORY` (to read profile + rules)
  - `STOREFRONT_CATALOG_PORT` (to find the product)
  This means catalog depends on checkout and merchant modules. The dependency direction is inverted (catalog should not know about checkout).
- **Impact:** Hard to reuse the catalog without importing checkout/merchant. Circular dependency risk if checkout later depends on catalog.
- **Remediation:** Introduce a `AddItemToCartPort` that the use-case depends on (abstraction). Checkout implements it. Catalog only knows about this port, not the concrete repos.

#### CAT-H2 — `TenantStorefrontCatalogAdapter` is a thin proxy with no logic

- **File:** `infrastructure/tenant-storefront-catalog.adapter.ts`
- **Category:** YAGNI / Layer Value
- **Description:** The adapter proxies directly to `CommerceCatalogReader` and transforms the response via `toSuggestedProducts()`. The transformation is a simple map operation; the adapter adds minimal value.
- **Impact:** Extra layer to maintain; unclear when to change catalog vs. commerce vs. adapter.
- **Remediation:** Either (a) remove the adapter and have use-cases inject `CommerceCatalogReader` directly, or (b) add real value: caching, fallback, enrichment, or locale routing.

#### CAT-H3 — AddStorefrontItemUseCase depends on cross-sell module logic

- **File:** `application/add-storefront-item.use-case.ts` (imports `resolveCrossSellCartItem`)
- **Category:** Coupling
- **Description:** The use-case imports and calls `resolveCrossSellCartItem` from the `cross-sell` module. This is a strong dependency. If the cross-sell logic changes, catalog breaks.
- **Impact:** Tightly coupled modules; hard to test catalog in isolation.
- **Remediation:** Inject a `CrossSellResolver` port into the use-case. The cross-sell module provides the implementation. Catalog depends on an abstraction, not concrete logic.

#### CAT-H4 — CatalogModule imports 4+ modules, creating a potential hub

- **File:** `catalog.module.ts` (imports CheckoutModule, MerchantModule, CommerceModule, IntegrationsModule)
- **Category:** Architecture / Dependency Inversion
- **Description:** The module imports many sibling modules. This increases coupling and makes it a "hub". If any dependency changes, catalog must recompile.
- **Impact:** Tight coupling; harder to test; fragile dependency graph.
- **Remediation:** Catalog should only import its domain + infrastructure. Other modules should export the services they provide via public symbols. Catalog injected those symbols, not the modules.

#### CAT-H5 — AddStorefrontItemUseCase has complex immutable update logic

- **File:** `application/add-storefront-item.use-case.ts` (`addCatalogItem`)
- **Category:** Testability / Clarity
- **Description:** The `addCatalogItem` function rebuilds the cart items array with a ternary that either updates an existing item or appends a new one. The logic is correct but dense (5-level nested structure).
- **Impact:** Hard to reason about; easy to miss an edge case (e.g., quantity bounds).
- **Remediation:** Extract to a named class or function: `class CartItemUpdater { addOrUpdateItem(...) }` with clear logic for each case.

---

### MEDIUM

#### CAT-M1 — WidgetCatalogController has manual session validation

- **File:** `presentation/http/widget-catalog.controller.ts` (`add` method)
- **Category:** Error Handling / Consistency
- **Description:** The `add` handler validates session_id and sku exist, then calls `embedGuards.assertSessionBelongsToEmbedMerchant(embed, sessionId)`. The DTO does not validate these fields; validation is split between DTO and controller.
- **Impact:** Mixed validation layers; easy to miss validation in a new endpoint.
- **Remediation:** Define a DTO with `@IsNotEmpty()` decorators; move the merchant-session check to a guard or decorator.

#### CAT-M2 — SearchStorefrontProductsUseCase is a thin wrapper

- **File:** `application/search-storefront-products.use-case.ts`
- **Category:** YAGNI
- **Description:** The use-case does nothing but call `this.catalog.search(...)`. It exists only to be an injectable service.
- **Impact:** Boilerplate; unclear if the wrapper adds value.
- **Remediation:** Either (a) inject the port directly into controllers, or (b) add logic (logging, caching, circuit breaker). For now, acceptable as an explicit use-case if the future adds richness.

#### CAT-M3 — toSuggestedProducts() is called twice (adapter + use-case)

- **File:** `infrastructure/tenant-storefront-catalog.adapter.ts` and `application/add-storefront-item.use-case.ts`
- **Category:** DRY
- **Description:** `toSuggestedProducts()` is defined in the adapter and called there, but add-storefront-item also calls `crossSellProductToSuggested()` which duplicates the logic.
- **Impact:** If the shape changes, two places need updates.
- **Remediation:** Extract a single `toSuggestedProduct()` function (singular) to `domain/catalog.mappers.ts` and reuse in both places.

#### CAT-M4 — CatalogController does not validate limit and cursor

- **File:** `presentation/http/catalog.controller.ts`
- **Category:** Input Validation
- **Description:** `clampLimit()` is a helper that bounds the limit (good), but the commerce backend may reject invalid cursors silently or crash.
- **Impact:** Bad cursors cause 500s instead of 400s.
- **Remediation:** Validate cursor format before passing to commerce backend (or document that the backend returns 400 for invalid cursors).

#### CAT-M5 — Widget catalog search and add responses are different shapes

- **File:** `presentation/http/widget-catalog.controller.ts`
- **Category:** API Consistency
- **Description:** `search` returns `{ merchant_id, query, products }`. `add` returns the entire `experience` + `agent_turn`. The response shapes are inconsistent.
- **Impact:** Frontend must handle two different response types.
- **Remediation:** Standardize responses: `{ experience, products }` for add; `{ products, merchant_id, query }` for search. Or define a shared response envelope.

#### CAT-M6 — CROSS_SELL_SKUS is a hardcoded Set

- **File:** `application/add-storefront-item.use-case.ts`
- **Category:** Hardcoding
- **Description:** The use-case has `CROSS_SELL_SKUS = new Set([...])`. These SKUs are hardcoded; if a product is no longer a cross-sell, the code must change.
- **Impact:** Configuration is buried in code.
- **Remediation:** Move cross-sell SKUs to a configurable `CrossSellConfig` injected from the cross-sell module. Or fetch from a database.

---

### LOW

#### CAT-L1 — Inconsistent null handling for product image/url fields

- **File:** `infrastructure/tenant-storefront-catalog.adapter.ts` (`toSuggestedProducts`)
- **Category:** Consistency
- **Description:** The adapter checks `variant.imageUrl ?? product.imageUrl` but uses the URL as-is. If both are null, a null is assigned to `image_url`.
- **Impact:** Nullable fields may confuse frontend (it expects a string or explicitly null).
- **Remediation:** Explicitly set to `null` if both sources are missing: `image_url: variant.imageUrl ?? product.imageUrl ?? null`.

#### CAT-L2 — ProductUrl may be undefined for some products

- **File:** `infrastructure/tenant-storefront-catalog.adapter.ts` (`toSuggestedProducts`)
- **Category:** Robustness
- **Description:** Some products may not have a `productUrl`. The code does not check; undefined is assigned.
- **Impact:** Frontend may crash if it assumes productUrl exists.
- **Remediation:** Document the field as optional in `SuggestedProduct` or always provide a fallback (e.g., homepage URL).

#### CAT-L3 — Description is truncated to 100 chars with no indicator

- **File:** `application/add-storefront-item.use-case.ts` (`addCatalogItem`)
- **Category:** UX
- **Description:** `description?.slice(0, 100)` truncates silently. The truncation point may cut off mid-word.
- **Remediation:** Use a smart truncation library (ellipsis on word boundary) or document the 100-char limit.

#### CAT-L4 — CatalogController hardcodes limit bounds

- **File:** `presentation/http/catalog.controller.ts` (`clampLimit`)
- **Category:** Configuration
- **Description:** `Math.max(1, Math.min(parsed, 100))` bounds are hardcoded.
- **Remediation:** Move to a config constant or injected config object.

---

## Coupling Map

```
catalog
  ← checkout (CheckoutSessionRepository, buildExperienceFromSession)
  ← merchant (MerchantRepository)
  ← commerce (CommerceCatalogReader)
  ← cross-sell (resolveCrossSellCartItem)
  ← integrations (TenantAccessModule, TenantAccessGuard)
  ← shared-types (SuggestedProduct, CartItem)
  → no outbound ✓
```

**Issue:** Catalog depends on checkout, merchant, and cross-sell modules, creating a hub. Checkout should NOT depend on catalog (no circular), but the current direction is inverted.

---

## Proposed Changes

1. **Introduce AddItemToCartPort** — checkout implements, catalog depends on abstraction
2. **Introduce CrossSellResolverPort** — cross-sell implements, catalog depends on abstraction
3. **Reduce module imports** — only import what catalog truly needs (commerce, shared-types)
4. **Extract toSuggestedProduct mapper** to `domain/catalog.mappers.ts`
5. **Extract CartItemUpdater** class for immutable cart logic
6. **Move CROSS_SELL_SKUS** to config or port
7. **Validate widget API requests** (session, sku, merchant check in guard or decorator)
8. **Standardize response shapes** across search and add endpoints
9. **Add description** of optional fields in API response
10. **Consider removing the adapter** if it adds no value (or add real enrichment: caching, fallback)

---

## SOLID Alignment

- **SRP:** Each use-case has one responsibility. AddStorefrontItem combines cart logic + experience building; acceptable.
- **OCP:** Adding new product sources (not just commerce) requires changing the adapter → introduce a port.
- **LSP:** Adapter implements StorefrontCatalogPort; both implementations should return compatible shapes.
- **ISP:** StorefrontCatalogPort is minimal (good).
- **DIP:** Use-cases inject ports (good). AddStorefrontItem injects concrete repos (bad) → use ports.

---

## Object Calisthenics

- **One level of indentation:** `addCatalogItem` has 3 levels of nesting (ternary for item index, then item creation). Acceptable.
- **No ELSE:** Early returns and ternaries used (good).
- **Short methods:** Use-cases are 10-30 lines (good).
- **Wrap primitives:** Product SKU/name are strings; acceptable.
- **Keep it DRY:** `toSuggestedProducts` duplicated; `CROSS_SELL_SKUS` hardcoded.

---

## Priority Execution Order

1. **[DONE] CAT-H1** — Introduce AddItemToCartPort
2. **[DONE] CAT-H3** — Introduce CrossSellResolverPort
3. **[DONE] CAT-H4** — Reduce module imports (only import what's needed)
4. **[DONE] CAT-M3** — Extract shared mapper `toSuggestedProduct`
5. **[DONE] CAT-H5** — Extract CartItemUpdater class
6. **CAT-M6** — Move CROSS_SELL_SKUS to config
7. **CAT-M1** — Add validation decorators to widget API
8. **CAT-H2** — Evaluate and remove or enrich adapter
9. Remaining items
