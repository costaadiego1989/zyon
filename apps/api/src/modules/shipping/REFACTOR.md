# REFACTOR.md — shipping module

## Current State

**Responsibility:** Shipping quote calculation, carrier integration, free-shipping subsidy, method selection.

**Structure:**
- `domain/entities/shipping-quote.entity.ts` — Lifecycle: create (empty) → add results → select carrier → record events.
- `domain/ports/carrier.port.ts` — CarrierPort interface; fetchQuotes(ctx) → ShippingQuoteResult[].
- `domain/policies/free-shipping.policy.ts` — Subsidy logic: if enabled & cart exceeds threshold, cheapest carrier is free.
- `application/use-cases/quote-shipping.use-case.ts` — Multi-carrier fetch, dedup, free-shipping merge, persistence.
- `application/use-cases/select-shipping-method.use-case.ts` — Carrier selection & checkout session persistence.
- `infrastructure/adapters/flat-rate.carrier.ts`, `melhor-envio.carrier.ts` — Carrier implementations.
- `presentation/http/embed-shipping.controller.ts`, `widget-shipping.controller.ts` — Embed (authenticated) vs. widget (dev-only).

**Key Flows:**
1. Quote request → QuoteShippingUseCase → fetch from all carriers (Promise.allSettled) → dedup → apply free-shipping → save with events → return results.
2. Select request → SelectShippingMethodUseCase → find quote → select carrier → persist to checkout session → return snapshot.

**Known Issues:**
- P0 fix: free_shipping_threshold is ONLY from merchant rules, never from request body. But code comment says @deprecated, suggesting history of client bypass.
- P3 fix: quote reuse rebinds session_id to current requesting session. If quote is old and cached, session_id in snapshot changes.
- BUG 1 fix: free-shipping policy returned as separate array (paid + free variants). mergeFreeShipping() dedupes by carrier_key (one per carrier). But docs say "append free entries onto paid", which is NOT what mergeFreeShipping does.
- P3: carrier failures are logged but results discarded silently. Widget sees no fallback if a live carrier fails.
- Route collision: both EmbedShippingController & WidgetShippingController registered as "embed/shipping" before fix (P0 fix changed widget to "widget/shipping").

---

## CRITICAL Issues

**C1: free_shipping_threshold bypass history not removed — [DONE]**
- Kept field in interface for backward compat but marked @deprecated.
- Field is now explicitly IGNORED at runtime (always uses merchant rules).
- Comment states: "Kept only for type-level backward compat; will be removed once all callers drop it."

**C2: Quote reuse with session_id mismatch — [DONE]**
- Changed quote-shipping.use-case.ts to validate session_id matches on reuse.
- If quote.session_id ≠ input.session_id, quote is stale; fall through to create fresh.
- No longer rebinds session_id; immutable per quote.

**C3: free-shipping merge logic does NOT match docs — [DONE]**
- Changed applyFreeShippingPolicy() to return ONLY the free variant (cheapest carrier at R$0).
- mergeFreeShipping() now correctly merges the single free entry over the paid set.
- Contract now matches implementation: exactly ONE recommended free option.

**C4: Carrier failure silent discard; widget gets incomplete results — [LOGGED ONLY]**
- Current behavior: Promise.allSettled() catches rejections; failures are logged but discarded.
- Partial results are returned (flat-rate + any successful live carriers).
- Acceptable for now; widget gets best-effort results.

---

## HIGH Priority

**H1: MelhorEnvio adapter hardcodes token & base URL from env — [DONE]**
- Added validation in shipping.module.ts provider factory for MelhorEnvioCarrierAdapter.
- Logs warning if MELHOR_ENVIO_TOKEN is missing; adapter still works (returns []).
- Fallback to flat-rate ensures widget is not blocked.

**H2: Weight/dimension defaults are arbitrary — [DONE]**
- Added validation in melhor-envio.carrier.ts: throw BadRequestException("shipping_packages_required_for_quote") if ctx.packages is empty.
- No longer silently defaults; requires caller to provide packages or fails with 400.

**H3: Quote expiry is not enforced on SELECT — [ALREADY DONE]**
- select-shipping-method.use-case.ts:17 already checks quote.isExpired() and throws ConflictException.
- isExpired() uses current time; no stale-cache issue.

**H4: No validation of carrier_key in SELECT request — [ALREADY DONE]**
- select-shipping-method.use-case.ts:20-27 already catches domain errors from quote.selectCarrier().
- Maps to BadRequestException("invalid_shipment_transition") or ConflictException as appropriate.
- Error handling is complete.

---

## MEDIUM Priority

**M1: Quote reuse cache key does not include merchant rules version — [DONE]**
- Added merchant rules hash computation in quote-shipping.use-case.ts.
- rulesHash = computeRulesHash(rules) appended to quoteKey as `:rules:${hash}`.
- Cache now invalidates when merchant toggles allowFreeShipping or changes freeShippingMinCartValue.

**M2: Carrier adapter errors swallowed in Promise.allSettled — [SKIPPED]**
- Current behavior: errors logged, partial results returned (acceptable).
- No need to escalate; widget gets best-effort from successful carriers.
- Low risk for current use case.

**M3: FlatRateCarrier estimates are hardcoded — [SKIPPED]**
- Flat-rate is intentional default fallback.
- Real carrier integration (MelhorEnvio) provides dynamic quotes.
- Hardcoded flat-rate is acceptable.

**M4: No pagination or limit on quote results — [SKIPPED]**
- Widget renders all results; no observed performance issue.
- Can be addressed in future if needed.
- Low priority.

---

## LOW Priority

**L1: Quote dedupe normalizes labels but not carrier_key — [SKIPPED]**
- Carriers are expected to return unique carrier_key values.
- No observed issue with current adapters.
- Can be addressed if real-world carriers return duplicates.

**L2: toCheckoutShippingQuote() loses precision — [SKIPPED]**
- centsToMajorUnits() uses Math.round() which is acceptable for currency.
- No observed precision loss in current data.
- Can be revisited if higher precision is needed.

**L3: Quote event does not include selected carrier — [SKIPPED]**
- recordCreated() emits quote.created without selected_carrier_key.
- Selection is a separate event (shipping.method.selected) emitted after select.
- Current design is acceptable; events are separate concerns.

---

## Coupling Map

```
shipping module
├─ → merchant (MerchantRulesRepository for free-shipping threshold & origin zip)
├─ → checkout (CheckoutSessionRepository to persist selected shipping)
└─ → shared/messaging (OutboxRepository for events)

Incoming:
├─ ← embed (EmbedShippingController)
├─ ← widget (WidgetShippingController)
└─ ← checkout (SelectShippingMethodUseCase is called from checkout session)

Outgoing events:
├─ shipping.quote.created
└─ shipping.method.selected
```

Moderate coupling: depends on merchant rules & checkout session. Outgoing events are lightweight.

---

## Proposed Changes

### Phase 1: Fix contract violations (C1, C3)

**Remove deprecated field**
```typescript
// quote-shipping.use-case.ts
export interface QuoteShippingInput {
  session_id: string;
  merchant_id: string;
  destination_zip: string;
  cart_total: number;
  // REMOVED: free_shipping_threshold (was @deprecated)
  origin_zip?: string;
  packages?: PackageDimensions[];
  items?: { sku: string; quantity: number }[];
}
```

**Fix ApplyFreeShippingPolicy to return ONLY the free variant**
```typescript
// free-shipping.policy.ts
export function applyFreeShippingPolicy(
  results: ShippingQuoteResult[],
  cartTotal: number,
  config: FreeShippingConfig
): ShippingQuoteResult[] {
  if (!config.enabled || cartTotal < config.min_cart_total) return [];
  if (results.length === 0) return [];

  const cheapest = results.reduce((best, r) => {
    if (r.price !== best.price) return r.price < best.price ? r : best;
    if (r.eta_days !== best.eta_days) return r.eta_days < best.eta_days ? r : best;
    return r.label.localeCompare(best.label, "pt-BR") < 0 ? r : best;
  });

  // Return ONLY the free variant of cheapest
  return [{ ...cheapest, price: 0, is_free: true }];
}

// quote-shipping.use-case.ts: mergeFreeShipping already dedupes correctly
// Now free-shipping policy returns 1 item; merge keeps it ✓
```

### Phase 2: Fix session_id leak (C2)

**Do NOT rebind session_id on quote reuse**
```typescript
// quote-shipping.use-case.ts:56–58
const reusable = await this.quotes.findValidByKey(quoteKey, input.merchant_id);
if (reusable) {
  // REMOVED: rebind session_id
  // Instead, validate session_id matches
  const snap = reusable.snapshot();
  if (snap.session_id !== input.session_id) {
    // Quote belongs to a different session; ignore cache
    // Fall through to create new quote
  } else {
    return snap; // Same session; safe to reuse
  }
}
```

### Phase 3: Handle carrier failures gracefully (C4)

**Return partial results with error markers**
```typescript
// shipping-quote-result.ts (new)
export interface ShippingQuoteResult {
  carrier_key: string;
  label: string;
  price: number;
  eta_days: number;
  is_free: boolean;
  error?: string; // "timeout", "auth_failed", etc.
}

// quote-shipping.use-case.ts:76–101
const liveResults: ShippingQuoteResult[] = [];
const fallbackResults: ShippingQuoteResult[] = [];

for (let i = 0; i < allResults.length; i++) {
  const res = allResults[i];
  const carrier = this.carriers[i];
  if (res.status === "fulfilled" && res.value.length > 0) {
    if (carrier.carrierKey === "flat-rate") {
      fallbackResults.push(...res.value);
    } else {
      liveResults.push(...res.value);
    }
  }
  if (res.status === "rejected") {
    // Emit error marker for observability; if no live results, still offer fallback
    const errorMarker: ShippingQuoteResult = {
      carrier_key: carrier.carrierKey,
      label: `${carrier.carrierKey} (unavailable)",
      price: -1,
      eta_days: 999,
      is_free: false,
      error: res.reason instanceof Error ? res.reason.message : 'unknown'
    };
    // Optionally append error marker for display
    console.warn(`[shipping] carrier_failed carrier=${carrier.carrierKey}`, res.reason);
  }
}

const resultsToAdd = dedupeQuoteResults([...liveResults, ...fallbackResults]);
```

### Phase 4: Validate expiry on reuse (H3)

**Always check expiry with NOW**
```typescript
// select-shipping-method.use-case.ts:14–17
const quote = await this.quotes.findBySession(input.session_id, input.merchant_id);
if (!quote) throw new NotFoundException("shipping_quote_not_found");
if (quote.isExpired()) throw new ConflictException("shipping_quote_expired");
```

### Phase 5: Validate inputs (H2, H4)

**Require at least one package or minimum weight**
```typescript
// melhor-envio.carrier.ts:22–26
async fetchQuotes(ctx: ShippingContext): Promise<ShippingQuoteResult[]> {
  if (!this.token || !ctx.destinationZip) return [];

  if (ctx.packages && ctx.packages.length === 0) {
    throw new Error("packages_required_for_quote");
  }

  // ... rest
}

// quote-shipping.use-case.ts: catch error & return []
```

**Map domain errors to HTTP status**
```typescript
// select-shipping-method.use-case.ts:19–27
let updated;
try {
  updated = quote.selectCarrier(input.carrier_key);
} catch (error) {
  const msg = error instanceof Error ? error.message : "shipping_select_failed";
  if (msg === "shipping_quote_expired") throw new ConflictException(msg);
  if (msg === "shipping_carrier_not_in_quote") throw new BadRequestException(msg);
  if (msg.includes("invalid")) throw new BadRequestException(msg);
  throw error; // Re-throw unknown errors
}
```

### Phase 6: Include merchant rules version in cache key (M1)

**Hash merchant rules into quote key**
```typescript
// quote-shipping.use-case.ts:44–49
const rules = this.merchantRules
  ? await this.merchantRules.getRules(input.merchant_id)
  : null;
const rulesHash = rules ? hashRules(rules) : "no-rules";
const quoteKey = buildQuoteKey({
  merchantId: input.merchant_id,
  destinationZip: input.destination_zip,
  cartTotalCents,
  items: input.items,
  rulesHash // Cache-bust if rules change
});
```

### Phase 7: Validate MelhorEnvio config on init (H1)

**Add config validation in module**
```typescript
// shipping.module.ts
providers: [
  {
    provide: MelhorEnvioCarrierAdapter,
    useFactory: () => {
      const token = process.env.MELHOR_ENVIO_TOKEN;
      if (!token) throw new Error("MELHOR_ENVIO_TOKEN not configured");
      return new MelhorEnvioCarrierAdapter();
    }
  },
  ...
]
```

---

## SOLID Principles

| Principle | Current | Proposed |
|-----------|---------|----------|
| **SRP** | QuoteShippingUseCase does fetch, dedup, free-shipping, merge, save. | Extract: FetchQuotesService, DedupeService, FreShippingService. |
| **OCP** | Carrier results are ShippingQuoteResult (fixed schema). | Add optional error field; support future extensions. |
| **LSP** | CarrierPort.fetchQuotes() returns [] on error or no results (unclear semantics). | Distinguish: empty results vs. error; throw or return error marker. |
| **ISP** | QuoteShippingUseCase injects MerchantRulesRepository (@Optional). | If optional, provide default; if required, make it required. |
| **DIP** | applyFreeShippingPolicy depends on hardcoded TRANSACTIONAL_SCOPES constant. | Inject policy config or rule engine. |

---

## Object Calisthenics

| Rule | Current | Proposed |
|------|---------|----------|
| 1: One level of indentation | QuoteShippingUseCase has 4+ levels (allSettled loop, carrier check). | Extract helpers: `collectCarrierResults()`, `applySubsidies()`. |
| 2: Don't use `else` | Uses ternary in several places; OK. | — |
| 3: Wrap primitives | price is bare number. | Wrap: `class ShippingPrice { constructor(cents: number) { } }`. |
| 4: One dot per line | quote.snapshot().session_id (2 dots); quote.isExpired() (1 dot). | OK (fluent API). |
| 5: Don't abbreviate | eta_days OK. | — |
| 6: Keep collections small | TRANSACTIONAL_SCOPES is 3 items. | — |
| 7: No getters/setters | Entities use .snapshot(); OK. | ✓ |
| 8: No classes with 2+ responsibilities | QuoteShippingUseCase does fetch + dedup + subsidy + merge. | Extract service layer. |
| 9: No getters for internal state | Not violated. | — |

---

## Summary

**Refactor Strategy:**
1. Remove deprecated free_shipping_threshold field (C1).
2. Fix ApplyFreeShippingPolicy to return only the free variant (C3).
3. Do NOT rebind session_id on quote reuse; validate it instead (C2).
4. Return partial results with error markers on carrier failure (C4).
5. Always check expiry with current time (H3).
6. Validate carrier config on module init (H1).
7. Require packages or fail with 400 Bad Request (H2).
8. Map domain errors to appropriate HTTP status (H4).
9. Include merchant-rules hash in cache key (M1).
10. Result: accurate quote caching, graceful carrier failure, safe session binding, validated inputs.

**Estimated Effort:** 3–5 days (includes carrier testing).
