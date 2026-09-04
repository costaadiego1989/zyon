# Storefront Migration to Headless API v1

> **Status**: Specified — ready for incremental execution
> **Complexity**: Large — 15+ endpoints to migrate, multi-file, auth change
> **Author**: Diego
> **Date**: 2026-08-19

## Overview

Migrate `apps/storefront` (Next.js) from internal NestJS routes to the Public API v1 (`/v1/`). This dogfoods our own API, proves it works end-to-end, and makes the storefront a **reference implementation** that customers can study when building their own frontends.

## Goals

- **G1**: Storefront consumes only `/v1/` public endpoints (no internal routes)
- **G2**: Zero downtime — incremental migration, one module at a time
- **G3**: Storefront becomes a living SDK example for customers
- **G4**: Same feature parity — nothing breaks during migration

## Non-Goals

- N1: Rewriting storefront UI (visual stays the same)
- N2: Adding new features during migration
- N3: Migrating widget embed logic (widget uses embed tokens — different auth)
- N4: Migrating buyer-account auth (buyer auth is NOT in public API v1)

---

## Current State: Internal Endpoints Consumed

### Inventory of all API calls in `apps/storefront/src/`

| # | File | Internal Route | Method | Auth |
|---|------|---------------|--------|------|
| 1 | `lib/storefront-api.ts` | `/storefront/budget-requests` | POST | none |
| 2 | `app/api/checkout-token/route.ts` | `/embed/sessions` | POST | service (server-side) |
| 3 | `app/sitemap.ts` | `/storefront/index` | GET | none |
| 4 | `app/store/[slug]/page.tsx` | `/storefront/{slug}/config` | GET | none |
| 5 | `app/store/[slug]/page.tsx` | `/storefront/{slug}/stories` | GET | none |
| 6 | `app/store/[slug]/opengraph-image.tsx` | `/storefront/{slug}/config` | GET | none |
| 7 | `components/ProductCarouselBlock.tsx` | `/merchants/{id}/products` | GET | cookie |
| 8 | `components/BuyerHub.tsx` | `/buyer/me/profile` | GET | bearer (buyer token) |
| 9 | `components/BuyerHub.tsx` | `/buyer/me/purchases` | GET | bearer (buyer token) |
| 10 | `components/BuyerHub.tsx` | `/buyer/phone/send` | POST | none |
| 11 | `components/BuyerHub.tsx` | `/buyer/phone/verify` | POST | none |
| 12 | `components/BuyerLoginForm.tsx` | `/storefront/buyer/send-otp` | POST | none |
| 13 | `components/BuyerLoginForm.tsx` | `/storefront/buyer/verify-otp` | POST | none |
| 14 | `components/BuyerRegistrationForm.tsx` | `/buyer/phone/send` | POST | none |
| 15 | `components/BuyerRegistrationForm.tsx` | `/buyer/phone/verify` | POST | none |
| 16 | `components/BuyerRegistrationForm.tsx` | `/buyer/email/send` | POST | none |
| 17 | `components/BuyerRegistrationForm.tsx` | `/buyer/email/verify` | POST | none |
| 18 | `components/BuyerRegistrationForm.tsx` | `/buyer/register` | POST | none |
| 19 | `components/CheckoutWidgetPanel.tsx` | `/storefront/budget-requests` | POST | none |
| 20 | `components/ConversationShell.tsx` | `/storefront/conversations` | POST | embed token |
| 21 | `components/ConversationShell.tsx` | `/storefront/conversations/{id}/messages` | POST | embed token |
| 22 | `components/ConversationShell.tsx` | `/storefront/cart/{id}/items/{variantId}` | DELETE | embed token |
| 23 | `components/StoriesRow.tsx` | `/storefront/{slug}/stories` | GET | none |
| 24 | `components/SupportPanel.tsx` | `/support/chat` | POST | embed token |
| 25 | `components/SupportPanel.tsx` | WebSocket `/support` | WS | embed token |
| 26 | `components/WidgetConfigProvider.tsx` | `/checkout-settings/widget-config` | GET | none |
| 27 | `lib/cart-store.tsx` | `/storefront/cart/{id}` | GET | none |
| 28 | `lib/hooks/useMarketplaceSearch.ts` | `/storefront/marketplace/search` | GET | none |
| 29 | `lib/hooks/useMarketplaceSearch.ts` | `/storefront/marketplace/items` | GET | none |
| 30 | `lib/triggers.ts` | `/checkout/track-event` | POST | none |

---

## Migration Mapping

### Category A: Direct mapping to Public API v1 (ready to migrate)

| Internal Route | Public API v1 Route | Notes |
|---------------|---------------------|-------|
| `/merchants/{id}/products` | `GET /v1/products` | Scoped by API key tenant |
| `/checkout-settings/widget-config` | `GET /v1/settings/checkout` | Same data, different envelope |
| `/storefront/budget-requests` | `POST /v1/checkouts` | Map to checkout creation |
| `/checkout/track-event` | `POST /v1/checkouts/{id}/events` | Requires checkout_id |
| `/embed/sessions` | `POST /v1/embed/sessions` (keep as-is) | Already in PUBLIC_OPERATIONS |

### Category B: Needs new v1 endpoint or adaptation

| Internal Route | Status | Action Required |
|---------------|--------|-----------------|
| `/storefront/{slug}/config` | No v1 equivalent | Add `GET /v1/settings/store` (already exists — map slug→tenant) |
| `/storefront/{slug}/stories` | No v1 equivalent | Add `GET /v1/content/stories` OR keep internal |
| `/storefront/index` | No v1 equivalent | Add `GET /v1/catalog` or `GET /v1/products` with sitemap params |
| `/storefront/conversations` | Checkout messages | `POST /v1/checkouts/{id}/messages` |
| `/storefront/conversations/{id}/messages` | Checkout messages | Same as above |
| `/storefront/cart/{id}` | No v1 equivalent | Cart is checkout state — `GET /v1/checkouts/{id}` |
| `/storefront/cart/{id}/items/{variantId}` | Cart mutation | `PATCH /v1/checkouts/{id}/cart` |
| `/storefront/marketplace/search` | Catalog | `GET /v1/products?search=` |
| `/storefront/marketplace/items` | Catalog | `GET /v1/products` |
| `/support/chat` | Support | Keep internal (WebSocket, not REST) |

### Category C: NOT migrating (buyer-side auth, not in public API)

| Internal Route | Reason |
|---------------|--------|
| `/buyer/me/profile` | Buyer auth is NOT part of public API (B2C, not B2B) |
| `/buyer/me/purchases` | Same — buyer scope |
| `/buyer/phone/send` | Buyer OTP — internal only |
| `/buyer/phone/verify` | Same |
| `/buyer/email/send` | Same |
| `/buyer/email/verify` | Same |
| `/buyer/register` | Same |
| `/storefront/buyer/send-otp` | Same |
| `/storefront/buyer/verify-otp` | Same |
| WebSocket `/support` | Real-time — stays internal |

---

## Auth Strategy

| Consumer | Current Auth | After Migration |
|----------|-------------|-----------------|
| Server-side (Next.js API routes, SSR) | Direct fetch to internal | **Service API key** (`aacp_live_*`) in `Authorization: Bearer` header |
| Client-side (React components) | Embed token / none | **Embed token** for checkout, **API key via proxy** for catalog |
| Buyer auth flows | Buyer JWT | **Stays internal** (not migrating) |

### API Key Flow (server-side)

```
Next.js API Route / getServerSideProps
  → fetch('https://api.aacp.dev/v1/products', {
      headers: { Authorization: 'Bearer aacp_live_xxx' }
    })
  → Response: { data: [...], meta: {...}, pagination: {...} }
```

### Client-side Proxy Pattern

Client components should NOT expose API keys. Use Next.js API routes as proxy:

```
Client component → fetch('/api/products')
  → Next.js API route → fetch('https://api.aacp.dev/v1/products', { headers: Bearer key })
  → Return data to client
```

---

## Response Format Changes

### Before (internal)

```json
[
  { "id": "prod_1", "name": "Widget", "price": 4990 },
  { "id": "prod_2", "name": "Gadget", "price": 9900 }
]
```

### After (v1 envelope)

```json
{
  "data": [
    { "id": "prod_1", "name": "Widget", "price": 4990 },
    { "id": "prod_2", "name": "Gadget", "price": 9900 }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2026-08-19T10:00:00Z",
    "version": "v1"
  },
  "pagination": {
    "next_cursor": "eyJ...",
    "has_more": true
  }
}
```

### Migration helper

Create a shared utility to unwrap responses:

```typescript
// lib/api-client.ts
export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const res = await fetch(`/api/proxy?path=${encodeURIComponent(path)}&${new URLSearchParams(params)}`);
  const json = await res.json();
  return json.data; // unwrap envelope
}
```

---

## Migration Order (phases)

### Phase 1: Catalog & Settings (lowest risk, read-only)

| # | What | Internal → v1 |
|---|------|--------------|
| 1.1 | Product listing | `/merchants/{id}/products` → `GET /v1/products` |
| 1.2 | Product search | `/storefront/marketplace/search` → `GET /v1/products?search=` |
| 1.3 | Marketplace items | `/storefront/marketplace/items` → `GET /v1/products` |
| 1.4 | Checkout settings | `/checkout-settings/widget-config` → `GET /v1/settings/checkout` |
| 1.5 | Store config | `/storefront/{slug}/config` → `GET /v1/settings/store` |

**Risk**: Low — read-only, no auth changes on server-side
**Verification**: Products load, settings render, no visual difference

### Phase 2: Checkout Flow (core business)

| # | What | Internal → v1 |
|---|------|--------------|
| 2.1 | Create checkout | `/storefront/budget-requests` → `POST /v1/checkouts` |
| 2.2 | Track event | `/checkout/track-event` → `POST /v1/checkouts/{id}/events` |
| 2.3 | Send message | `/storefront/conversations` → `POST /v1/checkouts/{id}/messages` |
| 2.4 | Cart mutation | `/storefront/cart/{id}/items/{variantId}` → `PATCH /v1/checkouts/{id}/cart` |
| 2.5 | Get cart state | `/storefront/cart/{id}` → `GET /v1/checkouts/{id}` |

**Risk**: Medium — mutations, checkout flow must not break
**Verification**: Full checkout journey works, cart updates, messages arrive

### Phase 3: Content & SEO

| # | What | Internal → v1 |
|---|------|--------------|
| 3.1 | Sitemap | `/storefront/index` → `GET /v1/products` (or keep internal) |
| 3.2 | OG image | `/storefront/{slug}/config` → `GET /v1/settings/store` |
| 3.3 | Stories | `/storefront/{slug}/stories` → keep internal (no v1 equivalent) |

**Risk**: Low — SSR/build-time only
**Verification**: Sitemap generates, OG images render

### Phase 4: Support (partial — no WebSocket migration)

| # | What | Internal → v1 |
|---|------|--------------|
| 4.1 | Support chat (REST part) | Keep internal (WebSocket) |
| 4.2 | Support tickets read | Add if needed |

**Risk**: N/A — WebSocket stays internal, REST support already in v1

---

## Implementation Pattern

### Step 1: Create API client layer

```
apps/storefront/src/lib/
  api-client.ts          ← new: centralized v1 client
  api-proxy.ts           ← new: Next.js API route proxy
```

### Step 2: Migrate per-file

For each file in migration order:
1. Replace `fetch(API_BASE + "/internal/route")` with `apiClient.get("/v1/route")`
2. Unwrap envelope (`response.data` instead of raw array)
3. Handle pagination if list endpoint
4. Test component renders correctly

### Step 3: Remove dead code

After all migrations complete:
- Remove `/storefront/*` internal controllers from API (or deprecate)
- Remove direct `API_BASE` usage from storefront components
- Single `api-client.ts` is the only API touchpoint

---

## Requirements

### REQ-SM-01: Centralized API Client
Create `apps/storefront/src/lib/api-client.ts` with:
- Base URL config (env var `NEXT_PUBLIC_AACP_API_URL`)
- Bearer token injection (server-side)
- Envelope unwrapping
- Error handling (RFC 7807 → user-friendly message)
- Pagination helpers

### REQ-SM-02: API Proxy Route
Create `apps/storefront/src/app/api/proxy/route.ts` that:
- Accepts path + params from client components
- Injects API key from server env
- Forwards to v1 API
- Returns unwrapped response to client

### REQ-SM-03: Phase 1 — Catalog Migration
Migrate all product listing and search to `/v1/products`.
Done when: ProductCarouselBlock, useMarketplaceSearch load from v1.

### REQ-SM-04: Phase 1 — Settings Migration
Migrate checkout settings and store config to `/v1/settings/*`.
Done when: WidgetConfigProvider, store page load from v1.

### REQ-SM-05: Phase 2 — Checkout Migration
Migrate checkout creation, events, messages, cart to `/v1/checkouts/*`.
Done when: Full checkout journey works end-to-end via v1 API.

### REQ-SM-06: Phase 3 — SEO Migration
Migrate sitemap and OG image generation to v1 endpoints.
Done when: `pnpm build` succeeds, sitemap validates.

### REQ-SM-07: Backward Compatibility
During migration, both old and new paths must work.
Feature flag `NEXT_PUBLIC_USE_V1_API=true` enables v1 path.
Rollback = set flag to `false`.

### REQ-SM-08: No Buyer Auth Migration
Buyer auth flows (`/buyer/*`) stay on internal routes.
These are B2C flows not exposed in the B2B public API.

---

## Acceptance Criteria

- [ ] All Category A endpoints migrated to v1
- [ ] All Category B endpoints mapped or documented as "stays internal"
- [ ] Zero visual regression in storefront
- [ ] Checkout flow works end-to-end via v1
- [ ] Products/categories load via v1
- [ ] Settings load via v1
- [ ] Feature flag allows rollback
- [ ] No API key exposed to client-side JavaScript
- [ ] Sitemap generates correctly

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| v1 endpoint missing field storefront needs | Medium | Add field to v1 response DTO |
| Rate limiting hits storefront SSR | Low | Use server-side API key (higher tier) |
| Response format breaks component | Medium | Feature flag + backward compat |
| Embed token flow conflicts with API key flow | Low | Keep embed for widget, API key for catalog |

---

## Out of Scope (future)

- Buyer account system in public API
- WebSocket support in public API
- Stories/content CMS in public API
- Real-time notifications in public API
