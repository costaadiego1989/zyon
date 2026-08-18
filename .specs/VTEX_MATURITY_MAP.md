# VTEX Maturity Analysis — Athom Today vs MACH

Data: 2026-08-18  
Scope: Current API surface vs VTEX-like commerce infrastructure  
Depth: Practical (MVP gaps only, no deep architectural research)

---

## 1. Your API Today

### Surface
- **60 controllers** (endpoints)
- **269 use-cases** (application logic units)
- **84 Prisma models** (domain entities)
- **11 packages** (modular libraries)

### What You Manage
```
Merchant (tenant root)
├── Auth (buyer + merchant login, WebAuthn)
├── Checkout (sessions, events, offers, shipping)
├── Payments (Stripe, Asaas, Crypto)
├── Commerce (Shopify, Magento, Nuvemshop, Tray, VTEX, WooCommerce)
├── Catalog (products, variants, prices, stock)
├── Orders (completed orders, returns)
├── Negotiations (discounts, cost ledger)
├── Support (tickets, messages)
├── Billing (subscriptions)
├── Audit (event log)
├── Teams (users, invites)
└── Storefront (cart, domains, analytics)
```

### What You DON'T Have (vs VTEX)

| VTEX Pillar | You Have? | Gap | Impact |
|---|---|---|---|
| **Catalog Management** | Partial | No bulk import, no content sync, no SEO | Marketing can't scale product updates |
| **OMS (Order Mgmt System)** | Minimal | No multi-warehouse, no fulfillment routing, no RMA at scale | Can't handle enterprise logistics |
| **Marketplace** | No | No seller management, no commission calc, no seller auth | Can't become seller+marketplace hybrid |
| **Subscriptions** | No | No recurring billing, no pause/resume, no plan tiers | Recurring revenue blocked |
| **Intelligent Search** | No | No faceting, no behavioral signals, no ML ranking | Search doesn't scale to 10k+ SKUs |
| **CMS** | No | No headless content, no asset management | Marketing creates in external tools |
| **B2B/Procurement** | No | No customer tiers, no volume pricing, no RFQ, no approval flows | B2B growth blocked |
| **Master Data** | Partial | Limited hierarchy, no multi-language, no regional config | Global expansion hard |
| **Analytics** | Minimal | No cohort analysis, no predictive, no real-time dashboards | No ops intelligence |
| **Webhooks at Scale** | Basic | No retry policy, no dead-letter queue, limited delivery guarantee | Integrations fragile |

---

## 2. Maturity: Where You Stand

### Current State (MVP ✓)
```
┌─────────────────┐
│  ATHOM TODAY    │
├─────────────────┤
│ ✓ Core checkout │
│ ✓ Multi-payment │
│ ✓ Multi-commerce│ (adapters: Shopify, Magento, VTEX, etc)
│ ✓ Buyer account │
│ ✓ Negotiation   │
│ ✓ Shipping calc │
└─────────────────┘
        ↓
   Single merchant
   Single storefront per merchant
   Transaction-based
```

### Where VTEX Is (Enterprise)
```
┌──────────────────────┐
│     VTEX MACH        │
├──────────────────────┤
│ ✓ Multi-warehouse    │
│ ✓ Marketplace ops    │
│ ✓ B2B commerce       │
│ ✓ Subscription       │
│ ✓ AI-driven search   │
│ ✓ Headless CMS       │
│ ✓ +900 API endpoints │
├──────────────────────┤
│ Enterprise IA        │
│ (you add: agents)    │
└──────────────────────┘
```

### Gap To Close (Next 12 months for mid-market)
```
Priority 1 (80% of revenue potential):
  ✓ Better OMS (multi-warehouse routing)
  ✓ Subscriptions + recurring billing
  ✓ Advanced search (facets, ranking)

Priority 2 (20%):
  ✓ Basic B2B (customer tiers, volume pricing)
  ✓ CMS + asset management
  ✓ Marketplace (seller onboarding)

Priority 3 (down the road):
  ✓ Advanced Master Data
  ✓ Predictive analytics
  ✓ Regional config
```

---

## 3. API Design: You're on Track

### Good Decisions
- **Multi-tenant by design** ✓ (scoped by `merchant_id`)
- **Clean Architecture** ✓ (domain → application → infrastructure)
- **Commerce adapters** ✓ (abstraction layer to Shopify, Magento, VTEX, etc)
- **Events + Outbox** ✓ (eventual consistency built in)
- **Modular packages** ✓ (rules-engine, shipping-engine, etc can be reused)
- **API-first** ✓ (no admin UI lock-in, everything via REST)

### Missing VTEX Patterns
| Pattern | VTEX Does | You Should Add |
|---|---|---|
| **Async Search Indexing** | ES/Algolia real-time | Add search queue + async index |
| **Order Events** | 50+ event types per order | Expand checkout/order events |
| **Commerce Webhooks** | Standardized retry + dead-letter | Upgrade webhook reliability |
| **Master Data Hierarchy** | Category → Family → Group | Add data hierarchy model |
| **Rate Limiting by Tenant** | Per-customer rate curve | Add tenant-scoped limits |
| **Request Tracing** | X-Trace-ID + correlation | Add OpenTelemetry |
| **Soft Deletes + Audit Trail** | Every write is audited | You have audit, expand to all entities |

---

## 4. Path to VTEX Parity (Not Replacement)

### What You SHOULD Build (MVP → Growth)

#### Phase 1: Better OMS (Months 1-3)
```
Goal: Multi-warehouse + fulfillment routing

Add models:
  Warehouse (location, inventory, fulfillment capacity)
  WarehouseInventory (SKU allocation)
  FulfillmentRule (order → warehouse logic)
  ShipmentPlan (multi-carton, multi-warehouse)

Add APIs:
  POST /orders/:id/allocate-warehouse
  GET /inventory/availability (multi-location)
  POST /fulfillment/create-plan

Tests:
  Order splits across 2 warehouses ✓
  Out-of-stock fallback to other warehouse ✓
  Cost calculation (warehouse + distance) ✓
```

#### Phase 2: Subscriptions + Recurring (Months 2-4)
```
Goal: Recurring orders, pause/resume, plan tiers

Add models:
  SubscriptionPlan (frequency, tier, auto-renew logic)
  SubscriptionInstance (buyer's active plan)
  RecurringOrder (generated orders)
  BillingCycle (charge dates, retries)

Add APIs:
  POST /subscriptions/create
  PUT /subscriptions/:id/pause
  PUT /subscriptions/:id/resume
  GET /subscriptions/:id/billing-history

Tests:
  Auto-charge on day N ✓
  Failed charge retry logic ✓
  Pause + resume date logic ✓
```

#### Phase 3: Search Upgrade (Months 3-5)
```
Goal: Facets, ranking, behavioral signals

Current: Basic product search
Upgrade to:
  - Faceted search (category, price range, rating)
  - Behavioral scoring (popularity, conversion rate)
  - Synonym mapping (jean = jeans)
  - A/B testable ranking rules

Add models:
  SearchFacet (category → values)
  SearchRank (A/B test rules)
  ProductBehavior (view count, add-to-cart, conversion)

Add APIs:
  GET /search?q=jeans&facets=category,price
  POST /search/ranking-rules (A/B test)
```

#### Phase 4: Basic Marketplace (Months 4-6)
```
Goal: Seller onboarding + commission

Add models:
  Seller (KYC, payout account)
  SellerInventory (seller's products)
  SellerCommission (rate per category)
  Payout (seller earnings)

Add APIs:
  POST /sellers/apply
  POST /sellers/:id/verify-docs
  POST /sellers/:id/inventory/add
  GET /sellers/:id/earnings
```

### What You Should INTEGRATE (Don't Build)

| System | Why | How |
|---|---|---|
| Search Engine | Algolia / Elasticsearch cost + ops | Add search indexing queue, use Algolia API |
| CMS | Headless CMS (Contentful, Strapi) | Sync via webhooks, fallback to simple JSON |
| Analytics | Segment / Mixpanel | Event batching + HTTP API |
| Email | SendGrid / AWS SES | Template system + provider abstraction |
| Payments | Already doing Stripe + Asaas | Add Klarna, AfterPay (payment provider pattern) |

### What You Should SKIP (For Now)

| Feature | Why | When |
|---|---|---|
| **Multi-region failover** | Not revenue-blocking in MVP | After you hit 10k MRR |
| **Advanced Master Data** | Overkill for mid-market | If enterprise client demands it |
| **Real-time inventory sync** | Webhooks work fine | If latency becomes issue |
| **CDN image optimization** | Cloudinary / Imgix exists | When image load time matters |
| **Advanced B2B (approval flows, RFQ)** | Complex; niche | B2B-specific sales ask |

---

## 5. Does This Make Sense?

### Yes, Build Toward This If...
- You're aiming for **mid-market** ($1M-$10M ARR merchants)
- You want **10-year defensibility** (not just tactic)
- You can **keep it modular** (always multi-tenant)
- Agents (your AI play) actually **reduce merchant pain** (not add features)

### No, Skip If...
- You're staying **SMB-only** (<$500k merchants) — simpler monolith wins
- You need **microservices first** — monolithic modules scale fine
- You can't **keep focus** — feature creep kills MVP

---

## 6. Realistic 18-Month Roadmap

### Q3 2026 (Now)
- Phase 1 start: OMS + multi-warehouse routing
- Keep APIs headless
- Add basic webhook retry policy

### Q4 2026
- Phase 1 done: OMS handles 80% of enterprise order flows
- Phase 2 start: Subscription models + billing
- Telemetry dashboard (ops visibility)

### Q1 2027
- Phase 2 done: Recurring revenue working
- Phase 3 start: Search facets + ranking
- First agent use-case: dynamic pricing recommendation

### Q2 2027
- Phase 3 done: Search at 10k+ SKU scale
- Phase 4 start: Marketplace seller onboarding
- Agent use-case: inventory rebalancing across warehouses

### Q3 2027
- Phase 4 done: Basic marketplace working
- Agents doing real ops (dynamic pricing, stock rebalancing, customer retention)
- **Position: "Commerce infra + AI operations layer"** vs generic e-commerce

---

## 7. The Real Win: Agents on Top

Instead of building all this alone, your differentiation is:

```
VTEX-like infrastructure
         ↓
    (basic, solid)
         ↓
   ATHOM AGENTS
         ↓
  (actually solve problems:
   - price optimization
   - inventory rebalancing
   - churn prediction
   - fulfillment routing
   - dynamic promotions)
```

Enterprise doesn't buy "better Shopify."  
They buy "Shopify + someone smart running it."

Your agents ARE that someone.

---

## 8. SOLID Next Step

1. **Pick Phase 1 (OMS)** — will unblock 60% of enterprise conversations
2. **Design multi-warehouse + fulfillment routing** — use `.specs/features/` for ADR
3. **Implement incrementally** — get basic OMS working, agents guide rest
4. **Keep agents in mind** — every API should expose enough data for agents to act on

---

