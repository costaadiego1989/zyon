# Shopify Integration Audit

Audit Date: July 14, 2026

Corebase: apps/api/src/modules/commerce, packages/commerce-adapters/src/shopify

---

## Compliance Status

| Requirement | Status | Details |
|---|---|---|
| API Versioning (required format) | PARTIAL | Using `2026-04` hardcoded; no validation of format. Shopify requires semantic versioning `YYYY-MM`. |
| Access Token Header | COMPLIANT | Using `X-Shopify-Access-Token` correctly in `adminHeaders()`. |
| HTTP Status Handling | PARTIAL | Detects 429; retries with exponential backoff. Missing `Retry-After` header parsing. |
| Rate Limiting (leaky bucket) | PARTIAL | Retries 429; max 3 attempts with backoff. No circuit breaker or bulkhead isolation. |
| GraphQL vs REST | COMPLIANT | Uses GraphQL for catalog/orders (recommended). REST for draft orders (legacy but functional). |
| Webhook Verification | MISSING | NO INCOMING WEBHOOK HANDLER. No HMAC-SHA256 verification. No webhook subscription management. |
| OAuth Flow | MISSING | NO OAuth implementation. Only accept pre-provisioned access tokens (service account model). |
| Pagination | PARTIAL | Implements cursor-based pagination (`endCursor`/`hasNextPage`). Missing 25k item limit warning. |
| API Deprecation | CRITICAL GAP | REST Admin API marked legacy Oct 1, 2024; new apps must use GraphQL only from Apr 1, 2025. |
| Inventory Handling | PARTIAL | Reads `inventoryQuantity` + `inventoryPolicy` during catalog sync. No mutation support. |
| Metafields | NOT IMPLEMENTED | No metafield read/write support. |
| Product Variants | COMPLIANT | Correctly queries `variants(first: 100)` and maps SKU, price, inventory per variant. |

---

## CRITICAL Gaps

### 1. REST Admin API Sunset Risk

**Issue:** Code uses REST endpoints for draft order creation (`/draft_orders.json`) and discount price rules (`/price_rules.json`). Shopify deprecated REST Admin API on Oct 1, 2024. Starting **Apr 1, 2025**, all new public apps must use GraphQL only.

**Impact:** If AACP is registered as a public app or migrates to Shopify App Store, REST calls will fail post-April 2025.

**Location:**
- `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.ts:293` (`/draft_orders.json`)
- `packages/commerce-adapters/src/index.ts:73` (`/price_rules.json`)

**Recommendation:** Migrate to GraphQL mutations:
- `draftOrderCreate` mutation for pending orders
- `priceRuleCreate` or (preferred) `discountCodeBasic` for discount codes

**Timeline:** Non-urgent if internal/private app; urgent if public app planned.

### 2. No Incoming Webhook Handler

**Issue:** AACP receives no webhooks from Shopify. All commerce data is pull-only (no event subscriptions). This violates Shopify best practices and misses order/fulfillment/inventory events.

**Impact:** 
- No real-time sync of Shopify order status changes
- No inventory level updates
- No fulfillment tracking
- Potential reconciliation lag

**What's Missing:**
- No `X-Shopify-Hmac-SHA256` verification handler
- No `X-Shopify-Webhook-Id` deduplication (for replay resilience)
- No subscription to topics: `orders/create`, `orders/updated`, `inventory/levels/update`, `fulfillments/create`
- No 5-second timeout handling for webhook delivery acks

**Location:** No controller or route exists. Would belong in a new module (e.g., `apps/api/src/modules/commerce/presentation/http/shopify-webhook.controller.ts`).

**Recommendation:** Implement webhook endpoint with HMAC verification (see Shopify webhook verification spec).

### 3. No OAuth / App Installation Flow

**Issue:** AACP does not support Shopify OAuth or app installation. Credentials are manually configured per merchant (pre-provisioned access tokens only).

**Impact:**
- Cannot integrate with Shopify App Store
- Manual credential provisioning burden on merchant support
- No scope enforcement (all API scopes implicitly trusted)
- Cannot revoke app access via Shopify admin

**What's Missing:**
- No authorization code grant flow
- No scope definition/validation
- No installation callback handler
- No app uninstall cleanup (customer data retention)

**Recommendation:** If public app plan exists, implement OAuth. Otherwise, document as internal/private app limitation.

---

## HIGH Priority Gaps

### 1. Missing `Retry-After` Header Parsing

**Issue:** Rate limiter reads HTTP status 429 but does not parse the `Retry-After` header to determine safe backoff delay.

**Location:** `apps/api/src/modules/commerce/infrastructure/commerce-retry.ts:46`

**Current Behavior:** Fixed exponential backoff (200ms base * 2^attempt).

**Shopify Behavior:** May send `Retry-After: 30` in 429 response to signal longer wait time.

**Fix:**
```typescript
function getRetryDelay(error: unknown, baseDelayMs: number): number {
  const status = statusFromError(error);
  if (status === 429) {
    // Parse Retry-After header from the response
    // If present and > baseDelayMs, use it
    // Fallback to exponential backoff if not present
  }
  return baseDelayMs;
}
```

### 2. No Circuit Breaker for Persistent Rate Limits

**Issue:** Retry logic does not detect persistent 429 errors (e.g., shop throttled for 10 minutes). After 3 retries, error propagates immediately on next call instead of fast-failing.

**Impact:** Retry storms under high load; slow error feedback.

**Recommendation:** Add circuit breaker (open after 5 consecutive 429; half-open after 30s).

### 3. API Version Hardcoded; No Deprecation Handling

**Issue:** `2026-04` is hardcoded in two places:
- `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.ts:50` (default)
- `packages/commerce-adapters/src/index.ts:45` (default)

**Missing:**
- Validation that `apiVersion` matches Shopify's YYYY-MM format
- Detection of deprecated API versions (no automatic migration)
- Fallback to latest supported version on 410 Gone
- Warning logs when using deprecated versions

**Fix:**
```typescript
function validateShopifyApiVersion(version: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(version);
}
```

### 4. No Pagination Depth Limit Warning

**Issue:** Shopify limits pagination to 25k items. Code does not warn or enforce this limit.

**Location:** `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.ts:146` (hardcoded `first: 100` per page).

**Recommendation:** Add comment and/or log warning if `nextCursor` is still present after 250+ pages of results.

### 5. Inventory Level Sync Not Writable

**Issue:** `inventoryQuantity` is read during catalog sync but never updated from Shopify or written back.

**Impact:** Inventory drift; AACP cannot reserve or adjust stock on Shopify.

**Recommendation:** If inventory management is in scope, add mutations for `inventoryAdjustQuantities` (GraphQL).

### 6. No Metafield Support

**Issue:** Shopify metafields (custom data) are not read or written. This limits integration depth (e.g., custom pricing, shipping rules via metafields).

**Recommendation:** If needed, add `metafields` query to product/variant schema.

---

## MEDIUM Priority Gaps

### 1. Inadequate Error Message Specificity

**Issue:** Errors like `shopify_draft_order_failed_400` give no actionable context. Shopify error details (e.g., "Invalid SKU") are lost.

**Location:** `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.ts:255-256`

**Fix:** Extract `errors` from GraphQL response and include in error message:
```typescript
if (payload.errors?.length) {
  const details = payload.errors.map(e => e.message).join('; ');
  throw new Error(`${errorCode}_graphql_failed: ${details}`);
}
```

### 2. No Test Coverage for Rate Limiting

**Issue:** No unit/integration tests for 429 retry behavior or exponential backoff jitter.

**Location:** `apps/api/src/modules/commerce/infrastructure/commerce-retry.spec.ts` (2 tests, none for 429).

**Recommendation:** Add test for:
- Mock 429 response; verify retry + backoff
- Mock 429 → then success; verify eventual success
- Mock 429 three times then failure; verify final error thrown

### 3. Storefront Access Token Not Validated

**Issue:** `storefrontAccessToken` is optional but used in `validateCart()` without null guard. Runtime error if missing.

**Location:** `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.ts:70`

**Fix:** Clear error at adapter init, not at call time:
```typescript
if (!config.storefrontAccessToken?.trim()) {
  throw new Error("shopify_storefront_access_token_required");
}
```

### 4. No Signature Verification for Manual Webhook Testing

**Issue:** If webhooks are added, manual testing (e.g., `curl` to webhook endpoint) will fail HMAC verification.

**Recommendation:** Add dev-only bypass or test webhook signing utility.

---

## LOW Priority Observations

### 1. Cart Reference Format Not Validated

**Issue:** `commerceCartRef` is passed to Storefront API but never validated as a valid Shopify GID format.

**Recommendation:** Add optional validation (non-blocking).

### 2. Draft Order ID Casting

**Issue:** Draft order ID is cast from GraphQL number to string without overflow checks.

**Location:** `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.ts:317`

**Recommendation:** Add type guard or BigInt handling if IDs > 2^53.

### 3. Missing Product Status Filter in Variants Query

**Issue:** `findCatalogProductBySku()` filters products by status but variant query doesn't re-filter product status.

**Current:** Relies on product.status in response.

**Recommendation:** Add explicit status check or query filter.

---

## Implementation Recommendations

### Phase 1: Immediate (Production Risk)
1. Add `Retry-After` header parsing in retry logic
2. Validate `apiVersion` format; add deprecation warnings
3. Improve error messages (include GraphQL/API error details)
4. Ensure `storefrontAccessToken` exists before use

### Phase 2: Medium Term (Feature Completeness)
1. Implement circuit breaker for persistent rate limits
2. Add webhook endpoint + HMAC verification
3. Add pagination depth warning at 25k items
4. Expand test coverage for rate limiting scenarios

### Phase 3: Long Term (API Migration)
1. Migrate REST calls (`/draft_orders.json`, `/price_rules.json`) to GraphQL mutations
2. Implement OAuth + app installation flow (if public app planned)
3. Add inventory write mutations
4. Add metafield read/write support

---

## Files Involved

### Core Adapter
- `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.ts` (615 lines, main API logic)
- `packages/commerce-adapters/src/index.ts` (124 lines, discount code creation)
- `apps/api/src/modules/commerce/infrastructure/tenant-commerce-adapter.factory.ts` (208 lines, factory)
- `apps/api/src/modules/commerce/infrastructure/commerce-retry.ts` (54 lines, retry logic)

### Credentials & Connection Management
- `apps/api/src/modules/commerce/domain/ports/commerce-connection.port.ts` (80 lines, types)
- `apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts` (146 lines, HTTP)
- `apps/api/src/modules/commerce/presentation/http/commerce-connection.dto.ts` (58 lines, DTO)

### Webhook Dedup (Existing, Not Shopify-specific)
- `apps/api/src/modules/commerce/domain/ports/commerce-paid-webhook-dedup.port.ts`
- `apps/api/src/modules/commerce/infrastructure/prisma-commerce-paid-webhook-dedup.repository.ts`

### Tests
- `packages/commerce-adapters/src/shopify/shopify-commerce.adapter.spec.ts` (370+ lines, comprehensive)
- `apps/api/src/modules/commerce/infrastructure/tenant-commerce-adapter.factory.spec.ts` (180+ lines)
- `apps/api/src/modules/commerce/infrastructure/commerce-retry.spec.ts` (50 lines)

---

## Conclusion

**Current State:** AACP integrates with Shopify using a hybrid GraphQL + REST approach with manual credential provisioning. Rate limiting is handled defensively; idempotency is enforced at use-case layer. No webhook or OAuth support.

**Production Readiness:** MEDIUM. Suitable for internal/private integrations. Public app release would require:
- REST → GraphQL migration (deprecation deadline Apr 1, 2025)
- OAuth implementation
- Webhook handler + HMAC verification
- Improved error diagnostics

**Recommendation:** If AACP remains an internal tool, current implementation is acceptable with Phase 1 fixes applied. If public app is planned, prioritize REST-to-GraphQL migration and OAuth implementation.
