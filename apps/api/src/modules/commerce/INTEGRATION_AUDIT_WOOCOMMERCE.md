# WooCommerce REST API Integration Audit

**Date:** 2024-07-14
**Scope:** `packages/commerce-adapters/src/woocommerce/` + `apps/api/src/modules/commerce/`
**Reference:** https://woocommerce.github.io/woocommerce-rest-api-docs/ (WP REST API v3)

---

## Compliance Matrix

| Requirement | WooCommerce Docs | Our Implementation | Status |
|---|---|---|---|
| **Authentication (HTTPS)** | HTTP Basic Auth: `consumer_key:consumer_secret` as username:password | `Authorization: Basic btoa(key:secret)` in `rawRequest()` | PASS |
| **HTTPS enforcement** | Basic Auth only safe over HTTPS; OAuth 1.0a required for HTTP | `normalizeStoreUrl()` rejects non-HTTPS (`woocommerce_https_required`) | PASS |
| **API versioning** | `/wp-json/wc/v3/` prefix | All API calls use `${storeUrl}/wp-json/wc/v3${path}` | PASS |
| **Pagination (page/per_page)** | `?page=N&per_page=N`, response headers `X-WP-Total`, `X-WP-TotalPages` | `searchCatalog` sends `page` + `per_page`, reads `x-wp-totalpages` for cursor | PASS |
| **Pagination (X-WP-Total header)** | `X-WP-Total` gives total item count | NOT read; only `x-wp-totalpages` is used | MINOR GAP |
| **Rate limiting (429)** | WooCommerce returns HTTP 429 when rate limited | `commerce-retry.ts` retries on 429 + 5xx with exponential backoff + jitter | PASS |
| **Rate limiting (Retry-After header)** | Some WP hosts send `Retry-After` header | NOT parsed; backoff uses fixed exponential schedule instead of server hint | MINOR GAP |
| **Webhook signature verification** | `X-WC-Webhook-Signature` = base64 HMAC-SHA256 of payload body | **NOT IMPLEMENTED** — no WooCommerce webhook controller exists | CRITICAL GAP |
| **Webhook topics** | `order.created`, `order.updated`, `order.deleted`, `product.created`, `product.updated`, `product.deleted` | **NOT IMPLEMENTED** — no inbound WooCommerce webhook handler | CRITICAL GAP |
| **Webhook registration via API** | `POST /wp-json/wc/v3/webhooks` with `topic` + `delivery_url` + `secret` | **NOT IMPLEMENTED** — no webhook provisioning in connect flow | CRITICAL GAP |
| **Connection health check** | `GET /wp-json/wc/v3/system_status` returns environment + DB + theme info | Uses `GET /wp-json` (WordPress root) for site name + currency via settings endpoint | PARTIAL |
| **Order CRUD - Read** | `GET /wp-json/wc/v3/orders/:id` | `validateCart` fetches order by ID | PASS |
| **Order CRUD - Update (mark paid)** | `PUT /wp-json/wc/v3/orders/:id` with `set_paid: true` + `status` + `transaction_id` | `markOrderPaid` sends `{status: "processing", transaction_id, set_paid: true}` | PASS |
| **Order CRUD - Create** | `POST /wp-json/wc/v3/orders` with `billing`, `shipping`, `line_items`, `payment_method` | `createPendingOrder` returns existing cart ref (no-op); no new order creation | BY DESIGN |
| **Order cancellation** | `PUT /wp-json/wc/v3/orders/:id` with `status: cancelled` | `cancelOrder` sends `{status: "cancelled"}` | PASS |
| **Product/variation sync** | `GET /products`, `GET /products/:id/variations` | `searchCatalog` fetches products; `mapProduct` fetches variations for variable products | PASS |
| **Product search** | `?search=term&status=publish` | Sends `search` + `status: publish` + `per_page` params | PASS |
| **Product lookup by SKU** | `?sku=value` | `findCatalogProductBySku` uses `?sku=X&status=publish&per_page=1` | PASS |
| **Stock management fields** | `manage_stock`, `stock_quantity`, `stock_status` on products/variations | Reads `stock_quantity` + `stock_status` and maps to `inventoryQuantity` + `availableForSale` | PASS |
| **Stock write-back** | `PUT /products/:id` with `stock_quantity` | **NOT IMPLEMENTED** — read-only stock sync | GAP (acceptable) |
| **Error handling** | Various 4xx/5xx codes | Throws `${errorCode}_failed_${status}`; retry layer classifies 4xx as permanent, 5xx/429 as transient | PASS |
| **Idempotency (markOrderPaid)** | No native idempotency key in WC REST API | `CommercePaidWebhookDedupPort.tryReserve()` provides atomic dedup at use-case level | PASS |
| **Idempotency (createPendingOrder)** | No native idempotency key | No-op implementation (returns existing cart ref); factory deliberately skips retries | PASS |
| **Input validation** | N/A | DTO validates `store_url` (HTTPS URL), `consumer_key`, `consumer_secret` (min 8 chars); factory rejects localhost/IP/local domains | PASS |
| **Credential security** | Never expose keys in URLs when using HTTPS + Basic Auth | Keys sent only in Authorization header, never in query string; credentials encrypted at rest via `commerce-secret-cipher.ts` | PASS |
| **OAuth 1.0a (HTTP fallback)** | Required for non-HTTPS stores | NOT needed — HTTPS is enforced, so Basic Auth suffices | N/A |
| **Coupon / refund endpoints** | Full CRUD available | NOT IMPLEMENTED | OUT OF SCOPE |
| **Customer endpoints** | Full CRUD available | NOT IMPLEMENTED | OUT OF SCOPE |

---

## Critical Gaps

### 1. No WooCommerce Inbound Webhook Controller (CRITICAL)

**Problem:** The system has NO endpoint to receive WooCommerce webhook deliveries. There is:
- No `X-WC-Webhook-Signature` verification (HMAC-SHA256 of body with shared secret)
- No controller handling WooCommerce `order.created`, `order.updated`, `product.updated` topics
- No webhook registration during the `connect` flow

**Impact:** Order status changes and product updates in WooCommerce are NOT automatically reflected in AACP. The system relies entirely on polling or manual sync.

**WooCommerce spec:**
- Signature: `X-WC-Webhook-Signature` = `base64(HMAC-SHA256(body, webhook_secret))`
- Headers: `X-WC-Webhook-Topic`, `X-WC-Webhook-Resource`, `X-WC-Webhook-Event`, `X-WC-Webhook-ID`, `X-WC-Webhook-Delivery-ID`, `X-WC-Webhook-Source`
- After 5 consecutive failed deliveries (non-2xx), WooCommerce disables the webhook

**Recommendation:**
1. Create `WooCommerceWebhookController` with raw body access
2. Implement HMAC-SHA256 signature verification
3. Handle `order.updated` (status sync), `order.created` (new order awareness), `product.updated` (catalog freshness)
4. Store webhook secret per merchant in `CommerceConnection`
5. Register webhooks via `POST /wp-json/wc/v3/webhooks` during connect flow

### 2. Connection Test Uses WordPress Root Instead of System Status (PARTIAL)

**Problem:** `testConnection()` calls `GET /wp-json` (public WordPress REST root) to get site name, then fetches currency from `/settings/general/woocommerce_currency`.

**WooCommerce best practice:** Use `GET /wp-json/wc/v3/system_status` which:
- Verifies authenticated API access (not just public endpoint)
- Returns WooCommerce version, database status, active plugins
- Returns store currency, locale, and environment details

**Current behavior is functional** but less robust: the `/wp-json` root is public and doesn't validate API credentials. A store with broken WC API keys would still pass the "connection test" because `/wp-json` doesn't require auth.

**Recommendation:** Replace `publicRequest("/wp-json")` with authenticated `request("/system_status")` to validate credentials during test.

### 3. No Retry-After Header Parsing (MINOR)

**Problem:** `commerce-retry.ts` uses fixed exponential backoff (200ms * 2^attempt) when receiving 429. Some WordPress hosts return a `Retry-After` header with the recommended wait time.

**Impact:** Under heavy rate limiting, the fixed backoff may retry too aggressively or too conservatively.

**Recommendation:** Parse `Retry-After` header from error responses and use it as the minimum delay floor.

---

## Strengths

1. **Correct authentication model** — Basic Auth over HTTPS matches WooCommerce's recommended approach for HTTPS connections
2. **Proper API versioning** — All requests target `/wp-json/wc/v3/` explicitly
3. **Robust retry logic** — Exponential backoff with jitter, 429/5xx retried, 4xx treated as permanent
4. **Idempotent payment marking** — Atomic dedup guard prevents double-marking even without WC-native idempotency support
5. **Security-conscious validation** — Rejects HTTP, localhost, IP addresses, `.local` domains; credentials encrypted at rest
6. **Proper pagination** — Reads `X-WP-TotalPages` header and uses cursor-based page navigation
7. **Stock awareness** — Reads both `stock_quantity` and `stock_status` for accurate availability
8. **Variation handling** — Fetches full variation details for variable products (up to 100 per product)
9. **Input sanitization** — `encodeURIComponent` on path segments, `.trim()` on all user inputs

---

## Recommendations (Priority Order)

| # | Priority | Action | Effort |
|---|---|---|---|
| 1 | P0 | Implement WooCommerce webhook controller with HMAC-SHA256 signature verification | L |
| 2 | P0 | Register webhooks (`order.updated`, `product.updated`) during connect flow | M |
| 3 | P1 | Store per-merchant webhook secret in `CommerceConnection` model | S |
| 4 | P1 | Switch `testConnection()` to use `/system_status` endpoint (validates auth) | S |
| 5 | P2 | Parse `Retry-After` header in retry logic | S |
| 6 | P2 | Expose `X-WP-Total` as total item count in catalog responses | S |
| 7 | P3 | Add webhook health monitoring (delivery failure count, auto-re-register) | M |
| 8 | P3 | Consider write-back for stock decrements on order completion | L |

---

## Files Audited

- `packages/commerce-adapters/src/woocommerce/woocommerce-commerce.adapter.ts`
- `packages/commerce-adapters/src/woocommerce/woocommerce-commerce.adapter.spec.ts`
- `packages/commerce-adapters/src/ports.ts`
- `apps/api/src/modules/commerce/infrastructure/tenant-commerce-adapter.factory.ts`
- `apps/api/src/modules/commerce/infrastructure/commerce-retry.ts`
- `apps/api/src/modules/commerce/application/manage-commerce-connection.use-cases.ts`
- `apps/api/src/modules/commerce/application/mark-commerce-order-paid.use-case.ts`
- `apps/api/src/modules/commerce/domain/ports/commerce-connection.port.ts`
- `apps/api/src/modules/commerce/domain/ports/commerce-paid-webhook-dedup.port.ts`
- `apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts`
- `apps/api/src/modules/commerce/presentation/http/commerce-connection.dto.ts`
