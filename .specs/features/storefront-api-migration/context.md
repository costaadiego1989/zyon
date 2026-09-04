# Storefront API Migration — Context & Decisions

## Gray Areas Discussed

### GA-1: Buyer auth — include in public API v1 or keep internal?

**Question**: Buyer registration, OTP, profile endpoints (`/buyer/*`) — should they be in public API v1 or stay internal?

**Context**:
- Currently internal, called from storefront (`BuyerHub.tsx`, `BuyerRegistrationForm.tsx`)
- These are B2C flows (buyer self-service), not B2B merchant API
- Public API v1 is merchant-focused (`/v1/orders`, `/v1/checkouts`)

**Decision**: **KEEP INTERNAL**
- Reasoning: Buyer auth is not a merchant concern — it's part of the storefront/widget experience
- The storefront will proxy these calls (Next.js API route) until/unless we expose buyer API in a future v2
- This keeps v1 focused on merchant/commerce concerns only

**Action**: Document in REQ-SM-08 that buyer auth stays internal. No v1 endpoint needed.

---

### GA-2: Cart vs. Checkout — same endpoint or different?

**Question**: Storefront has `/storefront/cart/{id}` — should this map to `GET /v1/checkouts/{id}` or do we need a separate `/v1/carts` endpoint?

**Context**:
- Internal: cart is session-stored, separate from checkout
- v1 API: checkout contains cart items, shipping, totals

**Decision**: **USE `/v1/checkouts/{id}` FOR CART STATE**
- Reasoning: In v1 API, the cart is the checkout session's items + shipping. No separate cart concept.
- Storefront treats checkout and cart as the same entity (one object with items, totals, shipping)
- Simpler mental model: checkout = active purchase session

**Action**: Phase 2, task 2.5 maps `/storefront/cart/{id}` → `GET /v1/checkouts/{id}`.

---

### GA-3: Feature flag or hard cutover?

**Question**: During migration, do we run both old and new paths in parallel, or hard-cutover per endpoint?

**Context**:
- Parallel: safer rollback, but 2x API calls initially
- Hard-cutover: cleaner, but if v1 is broken, storefront breaks

**Decision**: **FEATURE FLAG DURING PHASE 1 & 2, HARD-CUTOVER PHASE 3**
- Phase 1 (catalog): Feature flag `NEXT_PUBLIC_USE_V1_API` — if false, use internal routes
- Phase 2 (checkout): Same flag — storefront can rollback in seconds
- Phase 3 (SEO): Remove flag, hard-cutover (SSR build-time only, no runtime toggle needed)

**Action**: Add flag to `apps/storefront/.env.example`. Code uses: `if (env.USE_V1_API) { v1Client } else { legacyClient }`.

---

### GA-4: Stories/content — migrate or keep internal?

**Question**: `/storefront/{slug}/stories` is rich media/CMS content — should storefront fetch from v1 or keep internal?

**Context**:
- Internal endpoint serves editorial content (hero images, carousels, testimonials)
- Not in public API v1 (v1 is commerce-focused)
- Storefront-specific, not a merchant concern

**Decision**: **KEEP INTERNAL**
- Reasoning: Stories are storefront-specific content, not a merchant API concern
- No equivalent in v1 (and no customer asks for it in merchant API)
- If merchants want custom content, they can build it on their own CMS and pass it to storefront via data attributes

**Action**: Document in Phase 3 as "no v1 migration needed". StoriesRow.tsx stays on internal endpoint.

---

### GA-5: Support WebSocket — REST+WS split or full internal?

**Question**: `/support` is WebSocket for real-time chat. Keep as-is (internal), or add REST endpoints to v1?

**Context**:
- Storefront calls `/support/chat` (REST) and connects to WS
- Real-time support is storefront-specific (not merchant API)
- v1 API doesn't have WebSocket support yet

**Decision**: **KEEP INTERNAL (WebSocket + REST)**
- Reasoning: Real-time support is a UI feature, not a merchant concern
- v1 API can add webhooks for support events later, but live chat requires WebSocket (infrastructure decision)
- Storefront can continue to use internal `/support` endpoint

**Action**: Support stays off migration list. SupportPanel.tsx keeps using internal endpoint.

---

### GA-6: Sitemap generation — use v1 or internal `/storefront/index`?

**Question**: Sitemap endpoint (`/storefront/index`) — does it need a v1 equivalent or stay internal?

**Context**:
- Sitemap is SEO infrastructure (lists all products → XML for search engines)
- Could map to `GET /v1/products` but needs special format
- Build-time only, not a runtime concern

**Decision**: **USE `/v1/products` WITH PAGINATION LOOP**
- Reasoning: Simpler — reuse product endpoint, loop through pagination
- If custom sitemap logic is needed later, can add `/v1/sitemap` endpoint
- For now: `app/sitemap.ts` loops `GET /v1/products?limit=100` → XML

**Action**: Phase 3, task 3.1. Build-time endpoint call, no runtime perf impact.

---

## Final Decisions Summary

| Question | Decision |
|----------|----------|
| Buyer auth in v1? | No, stay internal |
| Cart vs checkout? | Same endpoint (`/v1/checkouts/{id}`) |
| Feature flag or hard-cutover? | Flag for phases 1–2, hard-cutover phase 3 |
| Stories migrate? | No, keep internal |
| Support migrate? | No, keep internal (WebSocket) |
| Sitemap migrate? | Yes, use `/v1/products` loop |

All gray areas resolved. Ready to move to **design phase**.
