# Integration Audit — Nuvemshop & Tray Commerce

**Scope:** backend implementation status + contract alignment vs official APIs
**Audit date:** 2026-07-14
**Code paths audited:**

- `apps/api/src/modules/commerce/infrastructure/tenant-commerce-adapter.factory.ts`
- `apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts`
- `apps/api/src/modules/commerce/presentation/http/commerce-connection.dto.ts`
- `packages/commerce-adapters/src/index.ts` (adapter registry)
- `apps/dashboard/src/pages/commerce-connections-page.tsx` (UI surface)

**TL;DR:** Both integrations are **frontend stubs with zero backend implementation**.
The backend factory only knows `shopify` and `woocommerce`; the DTO enum rejects
`nuvemshop` and `tray`; no adapter class exists in `@zyon/commerce-adapters`.
The dashboard renders forms that send `provider: "nuvemshop"` / `"tray"` via
`as any`, which the API **silently rejects as "not configured"**. No requests
for these providers can ever succeed end-to-end today.

---

## 1. Backend Implementation Inventory

| Layer | File | Supports Nuvemshop? | Supports Tray? |
|-------|------|---------------------|----------------|
| `ConnectCommerceDto` (validation) | `commerce-connection.dto.ts` | **No** — `@IsIn(["shopify","woocommerce"])` rejects `"nuvemshop"` and `"tray"` | **No** — same restriction |
| `commerce-connections.controller.ts` `toCredentials()` | controller | **No** — `toCredentials()` returns WooCommerce shape for everything non-Shopify | **No** — same code path |
| `CommerceConnectionPort` | `commerce-connection.port.ts` | Generic shape, provider-agnostic — would accept any string | Generic — same |
| Prisma connection repository | `prisma-commerce-connection.repository.ts` | Unknown — repo was not opened, but the field shape from the DTO (consumer_key/consumer_secret) does not match either provider's auth model | Unknown |
| `TenantCommerceAdapterFactory.resolveFromSource()` | factory.ts | **No** — only branches on `shopify` / `woocommerce`. Anything else falls through to `BadRequestException("commerce_adapter_not_configured")` | **No** — same |
| `packages/commerce-adapters/src/index.ts` | adapter registry | **No** — only exports `ShopifyCommerceAdapter` and `WooCommerceCommerceAdapter` | **No** — same |
| `disabled-commerce.adapter.ts` | infrastructure | Returns hard "not configured" errors (used when no credentials); not provider-specific | same |
| Dashboard form | `commerce-connections-page.tsx` | **Yes** — UI exists, sends `provider: "nuvemshop" as any` | **Yes** — sends `provider: "tray" as any` |

**Conclusion:** The dashboard treats these as live integrations; the backend
treats them as out-of-scope. The `as any` casts in the dashboard suppress the
TypeScript error but do not change what the API accepts. End-to-end, a merchant
clicking "Connect Nuvemshop" in the UI gets a `400 Bad Request: invalid provider`.

---

## 2. Nuvemshop (Tiendanube) — Official Contract vs Our Code

Sources:
- https://tiendanube.github.io/api-documentation/intro
- https://tiendanube.github.io/api-documentation/

### Compliance Table

| Concern | Nuvemshop spec | Our backend | Gap |
|---------|---------------|-------------|-----|
| **Auth model** | OAuth 2.0 — merchant installs app, app receives `access_token` | **None** — no OAuth flow, no token storage for Nuvemshop | **Critical** — no way to obtain or store a token |
| **Required headers** | `Authorization: Bearer <token>`, `User-Agent: AppName (contact-email)`, `Content-Type: application/json` on writes | N/A — no adapter exists | **Critical** — none implemented |
| **Base URL** | `https://api.tiendanube.com/2025-03/{store_id}` (or `api.nuvemshop.com.br`) | N/A | **Critical** — no URL builder |
| **Path style** | Versioned: `/{version}/{store_id}/products`, `/{version}/{store_id}/orders`, `/{version}/{store_id}/webhooks` | N/A | **Critical** — no request builder |
| **Rate limit** | Leaky bucket — 40 burst / 2 req/sec steady. Per (store, app) pair. Headers: `x-rate-limit-*`. `429` on excess. Next/Evolution plans get ×10 multiplier. | `commerce-retry.ts` generic backoff, no per-provider rate planner | **High** — will hammer the API without a 2 rps limiter; risk of being banned |
| **Product endpoints** | `GET /products`, `POST /products`, `PUT /products/{id}`, `DELETE /products/{id}` — full CRUD | N/A — no adapter | **Critical** |
| **Order endpoints** | `GET /orders`, `POST /orders`, `PUT /orders/{id}`, `PUT /orders/{id}/cancel`, `PUT /orders/{id}/fulfill`, `GET /orders/{id}/transactions` | N/A — no adapter | **Critical** |
| **Webhooks** | `POST /webhooks` to register. Events: `order/created`, `order/paid`, `order/fulfilled`, `order/cancelled`, `product/created`, `product/updated`, `product/deleted`, `app/uninstalled`, etc. | N/A — no webhook registration, no inbound handler for Nuvemshop events | **Critical** |
| **Error format** | JSON `{"error": "..."}` or `{"src": ["..."]}` validation map. Codes: 400 / 401 / 402 / 404 / 415 / 422 / 429 / 5xx | Generic `BadRequestException` only | **High** — no provider-aware error decoding |
| **Pagination** | `?page=N&per_page=M` (max 200). Headers: `x-total-count`, `Link` (next/prev/first/last) | N/A | **High** — will break large catalogs |
| **store_id location** | Path segment, not header | N/A | — |

### Critical Risk: Required `User-Agent`

Nuvemshop **rejects requests with `400` if `User-Agent` is missing or generic**.
Our `HttpClientService` and the Shopify/Woo adapters do not currently inject a
provider-specific `User-Agent`. Any future Nuvemshop adapter must override the
default `User-Agent` per request — this is a per-provider concern, not a generic
HTTP concern.

### Critical Risk: OAuth Bootstrap Flow

Nuvemshop's OAuth flow is:

```
GET https://{store}.tiendanube.com/apps/{app_id}/authorize
  → 302 redirect to {callback_url}?code=...
  → POST https://api.tiendanube.com/authorize with code + client_id + client_secret
  → { access_token, user_id, scopes }
```

We have **no OAuth callback endpoint, no token-exchange service, no partner-app
registration flow** for any provider. This is not Nuvemshop-specific — it is a
gap for all non-Shopify/Woo providers. For Shopify we cheat with a pre-issued
Admin API access token (server-to-server); that shortcut does not work for
Nuvemshop (which uses real OAuth for every app).

---

## 3. Tray Commerce — Official Contract vs Our Code

Source: https://developers.tray.com.br/

### Compliance Table

| Concern | Tray spec | Our backend | Gap |
|---------|-----------|-------------|-----|
| **Auth model** | OAuth 2.0 (`code` → `access_token` + `refresh_token`). `refresh_token` is long-lived. `access_token` expires. | **None** — no OAuth, no refresh handling | **Critical** |
| **Token transport** | `access_token` is sent **as a query string parameter** (`?access_token=...`), **not** as a header | N/A — adapter does not exist | **Critical** — even if we had a token, our generic `HttpClientService` would put it in the wrong place |
| **Required headers** | None custom; tokens travel in URL. `Content-Type: application/x-www-form-urlencoded` for OAuth `POST /auth` | N/A | **High** — must not set `Authorization: Bearer` |
| **api_address discovery** | Returned by OAuth callback (`api_address` query param) AND by `/auth` response (`api_host`, `store_id`). Format: `https://{store}.com.br/web_api` | N/A | **Critical** — must store `api_address` per merchant, not derive from store URL |
| **OAuth URL** | `{store_domain}/auth.php?response_type=code&consumer_key={ck}&callback={url}` | N/A | **Critical** |
| **Token exchange** | `POST {api_address}/auth` with body `consumer_key`, `consumer_secret`, `code` (form-encoded). Returns access_token + refresh_token + dates | N/A | **Critical** |
| **Token refresh** | `GET {api_address}/auth?refresh_token=...`. Returns new pair when access token expires | N/A | **Critical** |
| **Product endpoints** | `GET /products`, `GET /products/:id`, `POST /products`, `PUT /products/:id`, `DELETE /products/:id`, `DELETE /products/:id/kits` | N/A — no adapter | **Critical** |
| **Order endpoints** | `GET /orders`, `GET /orders/:id`, `GET /orders/:id/complete`, `POST /orders`, `PUT /orders/:id`, `PUT /orders/:id/cancel`, `POST /orders/:id/products`, `DELETE /orders/:id/products/:product_id` | N/A — no adapter | **Critical** |
| **Webhooks** | POST notifications to a registered URL. Form-encoded payload with `scope_name` (`product`, `product_price`, `product_stock`, `variant`, `variant_price`, `variant_stock`, `order`, `customer`, `store_config`), `scope_id`, `act` (`insert`/`update`/`delete`), `seller_id`, `app_code`, `url_notification`. Recommendation: aggregate identical notifications. | N/A — no inbound webhook handler for Tray | **Critical** |
| **Rate limits** | **180 req/min short-term**, **10 000 req/day per store** (50 000 for corporate) | Generic backoff, no per-merchant rate budget | **High** — daily budget must be enforced; without it one burst can exhaust the day |
| **Error codes** | HTTP 401 (token), 404 (URL/ID), 405 (wrong type). App-level codes: 1000 (expired), 1001 (blocked), 1002 (inactive), 1003 (cancelled), 1099 (unknown) | Generic exception only | **High** — code 1000 must trigger refresh, not retry |
| **Cancellation** | `PUT /orders/:id/cancel` — distinct endpoint, not a body field | N/A | — |

### Critical Risk: Tokens in URL

Tray puts `access_token` in the query string. This means:

1. **No `Authorization` header** — must not send one.
2. **Token leaks into access logs / proxy logs / error reports** unless we are
   careful. The `commerce-secret-cipher.ts` / secret-handling layer we already
   have for OAuth-style tokens must redact `access_token` and `refresh_token`
   from query strings before logging.
3. **Every endpoint signature is unique** — no shared `Authorization` helper.
   We need a Tray-specific fetcher that injects the query param.

### Critical Risk: Refresh Token Lifecycle

Tray refresh tokens are **separate, long-lived credentials**. Our current
`MerchantCommerceConnection` schema (inferred from `toResponse` in the
controller) only stores `provider`, `store_url`, `api_version`, timestamps, and
error code. It does not surface token expiry, refresh tokens, or the Tray
`api_address`. We need at minimum:

- `access_token_expires_at` (or `date_expiration_access_token` from `/auth`)
- `refresh_token` (encrypted)
- `api_address` (per-store, returned by OAuth)
- `consumer_key` / `consumer_secret` (the app credentials, needed to refresh)

The Shopify/Woo connection rows do not need any of these, so this is a
**schema extension**, not a migration.

---

## 4. Frontend / Backend Contract Mismatch (immediate fix)

The dashboard already sends payloads the backend cannot accept:

```ts
// commerce-connections-page.tsx — currently submitted as-is
payload = {
  provider: "nuvemshop" as any,        // ❌ fails @IsIn validator
  store_url: nuvemshopStoreId,        // ⚠️ field name is store_id semantically
  consumer_key: nuvemshopToken,       // ⚠️ Nuvemshop uses Bearer token, not OAuth key/secret
  consumer_secret: "",
};

payload = {
  provider: "tray" as any,            // ❌ fails @IsIn validator
  store_url: trayApiAddress,          // ⚠️ actually api_address, not a URL
  consumer_key: trayAccessToken,      // ⚠️ Tray uses token-in-query, not key/secret
  consumer_secret: "",
};
```

The current behaviour when a merchant hits Save:

1. Frontend posts to `POST /commerce/connections` with `provider: "nuvemshop"`.
2. `ConnectCommerceDto.@IsIn(["shopify","woocommerce"])` → `400 Bad Request`
   (validation pipe throws).
3. Merchant sees a generic "could not connect" error.
4. No record is created, no retry is offered.

**Severity:** These UI flows look fully functional but produce silent 400s.
This is worse than not exposing the option at all — it will erode trust in
the entire Commerce Connections page.

---

## 5. Implementation Recommendations

### 5.1 Minimum viable (honest) fix — option A: hide stubs

Until backend exists, **remove `nuvemshop` and `tray` from the provider list**
in the dashboard and from `PROVIDERS` / `PROVIDER_DOCS` / `PROVIDER_HELP` in
`commerce-connections-page.tsx`. This is the lowest-risk fix; preserves the
contract (`@IsIn` stays strict) and stops misleading merchants.

Estimated scope: 1 file, ~10 line deletion. No schema change.

### 5.2 Recommended (full) fix — option B: implement both adapters

Order of work (smallest first), all under `apps/api/src/modules/commerce/`:

#### Step 1 — Schema & DTO
Extend `ConnectCommerceDto` with provider-specific shapes:

```ts
@IsIn(["shopify", "woocommerce", "nuvemshop", "tray"])
provider!: "shopify" | "woocommerce" | "nuvemshop" | "tray";

// Nuvemshop
@ValidateIf(o => o.provider === "nuvemshop")
@IsString() @Matches(/^\d+$/) store_id?: string;   // numeric store_id

@ValidateIf(o => o.provider === "nuvemshop")
@IsString() @MinLength(20) access_token?: string;  // OAuth-issued

// Tray
@ValidateIf(o => o.provider === "tray")
@IsUrl() api_address?: string;                     // https://store.com.br/web_api

@ValidateIf(o => o.provider === "tray")
@IsString() @MinLength(20) access_token?: string;

@ValidateIf(o => o.provider === "tray")
@IsString() @MinLength(20) refresh_token?: string;

@ValidateIf(o => o.provider === "tray")
@IsString() consumer_key?: string;                 // app cred for refresh

@ValidateIf(o => o.provider === "tray")
@IsString() consumer_secret?: string;              // app secret for refresh
```

Extend `MerchantCommerceConnection` to carry per-provider auth fields:

- Nuvemshop: `storeId`, `accessToken`
- Tray: `apiAddress`, `accessToken`, `refreshToken`, `accessTokenExpiresAt`,
  `consumerKey`, `consumerSecret`

Add a Prisma migration. Backward-compatible: existing Shopify/Woo rows are
unaffected.

#### Step 2 — Adapter package
Create `packages/commerce-adapters/src/nuvemshop/nuvemshop-commerce.adapter.ts`
and `.../tray/tray-commerce.adapter.ts`. Both implement the existing
`CommerceProviderPort` interface (`validateCart`, `createPendingOrder`,
`markOrderPaid`, `cancelOrder`, `testConnection`, `searchCatalog`,
`findCatalogProductBySku`).

Key per-provider behaviour:

| Concern | Nuvemshop adapter | Tray adapter |
|---------|------------------|--------------|
| Base URL | `https://api.tiendanube.com/2025-03/{store_id}` (version pinned; **do not** use `api.nuvemshop.com.br` — deprecated) | `{api_address}` (per-merchant, stored on connection) |
| Auth header | `Authorization: Bearer <token>` + **mandatory** `User-Agent: AACP (contact@your-domain)` (else 400) | `?access_token=<token>` query param; **do not** send `Authorization` |
| Content-Type | `application/json` always | `application/json` for orders, `application/x-www-form-urlencoded` only for `/auth` token endpoints |
| Rate limiter | Token bucket: 2 rps sustained, 40 burst. Per (store, app). Must serialise calls per store or burst will exceed | 180 r/min, 10 000/day. Token bucket with daily refill |
| Error mapping | 401 → `commerce_token_revoked` (do not retry); 402 → `commerce_payment_required` (store subscription lapsed, do not retry); 429 → back off per `x-rate-limit-reset`; 422 → surface to use-case as `commerce_validation_error` | HTTP 401 OR app code 1000 → trigger refresh_token flow; 405 → schema bug, surface; otherwise standard retry |
| Cancellation | `PUT /orders/{id}?status=cancelled` (per resource doc) | `PUT /orders/{id}/cancel` |
| Webhook registration | `POST /webhooks` with `url`, `event`. Persist `id` on connection | Out-of-band: registered in Tray admin panel; our webhook receiver must accept form-encoded payloads and validate `app_code` |
| Token refresh | None — Nuvemshop access tokens are long-lived; if revoked, merchant must reinstall app | `GET {api_address}/auth?refresh_token=...`. Schedule refresh 5 min before `accessTokenExpiresAt`. On 401, force refresh synchronously and retry once |

#### Step 3 — Factory routing
Extend `tenant-commerce-adapter.factory.ts` `resolveFromSource()`:

```ts
if (tenant.provider === "nuvemshop") return new NuvemshopCommerceAdapter(tenant, this.http.toFetch());
if (tenant.provider === "tray")      return new TrayCommerceAdapter(tenant, this.http.toFetch());
```

Keep the existing Shopify/Woo branches unchanged. Keep the global-env fallback
scoped to the Shopify demo merchant.

#### Step 4 — Webhook receiver
Add `apps/api/src/modules/commerce/presentation/http/commerce-webhooks.controller.ts`
with routes per provider:

- `POST /commerce/webhooks/nuvemshop/{merchantId}` — JSON body, HMAC-verify if
  configured (Nuvemshop sends `x-linkedstore-id` and `x-topic` headers).
- `POST /commerce/webhooks/tray/{merchantId}` — **form-encoded**, validate
  `app_code`, dedup by `(scope_name, scope_id, act)`, route to `commerceOrder`
  / `commerceCatalog` port.

Both must be tenant-scoped via URL path (the merchant id is part of the URL so
the receiver knows which connection the event belongs to) and idempotent (webhooks
are at-least-once).

#### Step 5 — Dashboard payload correction
Stop casting `as any`. Once the DTO accepts these providers, the casts come out.
The existing UI already collects the right fields (`nuvemshopStoreId`,
`nuvemshopToken`, `trayApiAddress`, `trayAccessToken`); they just need to be
sent with the right JSON keys. Tray's UI currently has no `refresh_token` /
`consumer_key` / `consumer_secret` fields — those come from the OAuth callback,
so the dashboard should NOT collect them by hand. Add a "Connect via Tray" OAuth
button that round-trips through our own callback endpoint.

#### Step 6 — Tests
Mirror the spec coverage of the Shopify adapter:

- `nuvemshop-commerce.adapter.spec.ts` — auth header presence, `User-Agent`
  presence, 429 backoff, 401 mapping, `cancelOrder` path.
- `tray-commerce.adapter.spec.ts` — token-in-query (not header), refresh
  triggered on 401 + app-code 1000, daily budget enforcement, form-encoded
  `/auth` body.
- `tenant-commerce-adapter.factory.spec.ts` — add cases for `nuvemshop` and
  `tray` providers resolving correctly.

---

## 6. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| NS-1 | Dashboard sends `provider: "nuvemshop"`; API rejects with 400 | **Confirmed happening today** | High — merchant-facing silent failure | Apply option A (hide) immediately, then implement option B |
| NS-2 | Future Nuvemshop adapter forgets `User-Agent` header | High (easy to miss) | Critical — every request 400s | Adapter-level unit test that intercepts the outbound fetch and asserts headers |
| NS-3 | Nuvemshop rate limit (2 rps) hit during catalog sync | High | High — 429s degrade UX | Per-store serialised request queue, batch reads |
| TR-1 | Tray `access_token` logged in URL by upstream proxies | Medium | High — credential leak | Redact `access_token` / `refresh_token` in `commerce-secret-cipher.ts` before logging; disable access logs at LB level for the OAuth callback |
| TR-2 | Refresh token not rotated, daily quota exhausted by one client | High | High — store offline for the day | Per-merchant token-bucket with daily refill, 429 → fail-closed |
| TR-3 | Tray webhook receiver assumes JSON, gets form-encoded | **Confirmed will happen** — the form is documented as `application/x-www-form-urlencoded` | High — all Tray webhooks silently 400 | Parse `application/x-www-form-urlencoded` first; only fall back to JSON |
| TR-4 | OAuth callback state/CSRF | High if implemented without state param | Critical — auth-code interception | Add `state` param to authorize URL, validate against short-lived store on callback |
| BOTH-1 | Schema migration breaks existing Shopify/Woo connections | Low (additive) | Critical | Make new fields nullable; existing rows untouched |
| BOTH-2 | Tenant-boundary leak: webhook for merchant A routed to merchant B | Medium | Critical — privacy & data integrity | Webhook URL must include `merchantId` in path; verify against `connections.getCredentials(merchantId)` before mutating any state |

---

## 7. Verification Checklist (post-implementation)

Per provider, before declaring done:

- [ ] `POST /commerce/connections` with the provider's body succeeds (200/201)
- [ ] `POST /commerce/connections/test` returns `store_name` + `currency`
- [ ] `POST /commerce/connections/sync` pulls catalog page 1 without 429
- [ ] `findCatalogProductBySku` finds a known product
- [ ] `validateCart` succeeds with a real cart hash
- [ ] `createPendingOrder` returns a provider order id
- [ ] `markOrderPaid` is reflected in the provider admin UI
- [ ] `cancelOrder` cancels in the provider admin UI
- [ ] Webhook → use-case round-trip completes (order created in AACP from a
      Nuvemshop/Tray event)
- [ ] Token-refresh path exercised (force-expire access_token, verify refresh
      succeeds, retry succeeds)
- [ ] 429 backoff observed: kill the rate limiter, hit 3 rps for 5s, verify
      adapter backs off to 2 rps
- [ ] `tenant-commerce-adapter.factory.spec.ts` covers all four providers
- [ ] `cd apps/api && pnpm typecheck` clean
- [ ] `cd apps/api && pnpm test` clean
- [ ] `cd apps/dashboard && pnpm typecheck` clean (no more `as any` on provider)

---

## 8. Summary Scorecard

| Provider | Frontend UI | DTO accepts | Repository stores | Adapter class | Factory routes | Webhook receiver | OAuth flow | Status |
|----------|-------------|-------------|-------------------|---------------|----------------|------------------|------------|--------|
| Shopify | Yes | Yes | Yes | Yes | Yes | Yes (Shopify-specific) | N/A (token-only) | **Production** |
| WooCommerce | Yes | Yes | Yes | Yes | Yes | Yes (HMAC) | N/A (key/secret) | **Production** |
| Nuvemshop | Yes (sends wrong payload) | **No** (`@IsIn` rejects) | Unknown — schema not opened | **Missing** | **No** | **Missing** | **Missing** | **Stub only — frontend lies** |
| Tray Commerce | Yes (sends wrong payload) | **No** (`@IsIn` rejects) | Unknown — schema not opened | **Missing** | **No** | **Missing** | **Missing** | **Stub only — frontend lies** |