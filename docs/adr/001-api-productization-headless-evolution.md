# ADR-001: API Productization — Headless Evolution for SMB Market

- **Date**: 2026-08-18
- **Status**: Proposed
- **Deciders**: Diego (Tech Lead), Product Team
- **Tags**: architecture, api-design, productization, headless, rest, dtos, evolution

## Context and Problem Statement

AACP (AI Agentic Checkout Platform) was built as a vertically integrated product. We now want to **commercialize the API as a headless platform** (similar to VTEX, but targeting PMEs/SMBs with agentic checkout intelligence). This requires:

1. The API to be **consumable by third-party developers** (not just our widget/dashboard)
2. Clear **contracts, versioning, and documentation** for external integrators
3. **Predictable, RESTful patterns** across all ~150 endpoints
4. Separation between **internal orchestration** (widget, dashboard) and **public API surface**

Current state: the platform has strong modular DDD boundaries (33 modules, 54 tenant-scoped models, transactional outbox, ports/adapters). But the HTTP layer was designed for internal consumption — inconsistent URL patterns, mixed resource/RPC naming, no formal versioning strategy, DTOs tightly coupled to UI needs.

## Decision Drivers

- **Market positioning**: Headless API for PMEs (VTEX-like but affordable + AI-native)
- **Developer experience**: Third-party devs must self-serve via OpenAPI spec
- **Backward compatibility**: Existing widget/dashboard must keep working during evolution
- **Incremental migration**: Cannot rewrite 150 endpoints at once
- **Multi-channel**: API must serve widget, mobile apps, ERPs, custom storefronts
- **AI-native**: Agentic capabilities (negotiation, cross-sell, checkout intelligence) are the differentiator

## Considered Options

1. **RESTful Level 2 (Richardson Maturity) + OpenAPI-first** — Resource-oriented, proper HTTP verbs, typed contracts, generated SDKs
2. **HATEOAS (Level 3)** — Full hypermedia with link relations driving client state transitions
3. **GraphQL** — Single endpoint, client-driven queries, schema-first
4. **Keep current RPC-style** — No evolution, maintain internal-only patterns

## Decision Outcome

Chosen option: **"RESTful Level 2 + OpenAPI-first"**, because:

- PME market developers expect REST (familiar, tooling-rich, low learning curve)
- HATEOAS adds complexity without proportional value for our use case (see analysis below)
- GraphQL adds operational overhead (N+1 prevention, authorization per field, caching complexity) without matching our resource-centric domain
- OpenAPI-first enables SDK generation (TypeScript, Python, PHP) via Orval/openapi-generator
- Matches VTEX/Shopify patterns that SMB integrators already know

### Why NOT HATEOAS

| Factor | HATEOAS | REST L2 + OpenAPI |
|--------|---------|-------------------|
| Client complexity | Must parse `_links`, build state machines | Read docs, call URL |
| Caching | Hard (dynamic links) | Standard HTTP caching |
| SDK generation | Poor (links are runtime) | Excellent (static contracts) |
| PME dev familiarity | Low | High |
| Discovery | Good for unknown APIs | Good with Scalar/Swagger UI |
| When it shines | Highly dynamic workflows | Well-documented resource APIs |

**Verdict**: HATEOAS is over-engineered for our market. PME devs want `POST /v1/checkouts` not `follow _links.create_checkout`. We CAN add `_links` later as progressive enhancement without breaking L2 consumers.

### Positive Consequences

- External devs can integrate via generated SDKs
- OpenAPI spec becomes single source of truth for contracts
- Versioning strategy enables safe evolution
- Internal apps (widget, dashboard) can use same public API

### Negative Consequences

- Migration effort (~3-6 months to rationalize all endpoints)
- Dual maintenance during transition (legacy + v1 public)
- Must invest in API documentation, developer portal, sandbox

---

## Current State Audit — Failures & Gaps

### 1. URL Pattern Inconsistencies

| Problem | Example | Should Be |
|---------|---------|-----------|
| RPC verbs in URLs | `POST /checkout/start-checkout` | `POST /v1/checkouts` |
| Mixed nesting | `/merchants/:mid/products` vs `/merchant/coupons` | Consistent: `/v1/merchants/{mid}/...` |
| Inconsistent pluralization | `/embed/catalog/search` vs `/embed/coupons/apply` | Always plural nouns |
| Action-oriented routes | `/checkout/offers/apply`, `/checkout/orders/complete` | `POST /v1/checkouts/{id}/offers` (creation = action) |
| Duplicate surfaces | `/storefront/conversations` AND `/embed/chat` | Single public endpoint per resource |
| Unscoped routes | `/agent-rules` (no merchant prefix) | `/v1/merchants/{mid}/agent-rules` |

### 2. DTO & Contract Issues

| Problem | Impact |
|---------|--------|
| Only 12 explicit DTO files for 150+ endpoints | Responses leak domain model structure |
| No response envelope standard | Clients can't reliably parse pagination, errors, metadata |
| Mixed validation (class-validator + ad-hoc) | Inconsistent error messages |
| No input/output DTO separation | Same object for create/update/response |
| shared-types (1200+ lines) mixes DTOs with internal contracts | Breaking changes cascade |

### 3. Versioning Gaps

| Problem | Impact |
|---------|--------|
| Single `/api/v1/` prefix but no version negotiation | Can't deprecate endpoints safely |
| No changelog or deprecation headers | Clients break silently |
| No stability markers (stable/beta/deprecated) | Integrators can't trust what's safe to use |
| Events schema_version: 1 always | No event evolution strategy |

### 4. Missing Headless Capabilities

| Gap | Required For |
|-----|-------------|
| No rate limiting docs/tiers | API plans (free/pro/enterprise) |
| No API key scoping per surface | Headless vs embed vs full access |
| No webhook delivery guarantees doc | Integrator trust |
| No pagination standard (cursor vs offset) | Large dataset APIs |
| No bulk operations | ERP integrations |
| No async job pattern (except scraping) | Long-running operations |

### 5. Architecture Gaps for Productization

| Gap | Severity | Impact |
|-----|----------|--------|
| No API gateway layer | High | Can't do rate limiting, throttling, analytics per consumer |
| No SDK generation pipeline | High | Manual client maintenance |
| No developer sandbox/test mode | High | Integrators can't test safely |
| No contract testing (consumer-driven) | Medium | Breaking changes undetected |
| No event catalog/registry | Medium | Consumers can't discover webhooks |
| No idempotency on all write endpoints | Medium | Unsafe retries for integrators |
| Embed vs Public surface conflated | Medium | Widget internals exposed as "API" |

---

## Evolution Roadmap

### Phase 1: Foundation (Month 1-2)

**Goal**: Establish public API surface without breaking internals.

```
apps/api/src/
├── modules/            ← existing (internal orchestration)
├── public-api/         ← NEW: public REST surface
│   ├── v1/
│   │   ├── checkouts/
│   │   │   ├── checkouts.controller.ts
│   │   │   ├── checkouts.dto.ts (request + response)
│   │   │   └── checkouts.mapper.ts (domain → response)
│   │   ├── orders/
│   │   ├── products/
│   │   ├── customers/
│   │   ├── payments/
│   │   ├── shipping/
│   │   └── webhooks/
│   └── shared/
│       ├── pagination.dto.ts
│       ├── response-envelope.dto.ts
│       ├── error-codes.ts
│       └── api-version.interceptor.ts
```

**Actions**:
1. Create `public-api/` layer that delegates to existing use-cases
2. Define response envelope: `{ data, meta, links?, errors? }`
3. Define pagination contract: cursor-based (default) + offset (legacy)
4. Establish DTO separation: `CreateXRequest`, `UpdateXRequest`, `XResponse`, `XListResponse`
5. Add OpenAPI decorators with stability markers (`x-stability: stable|beta|deprecated`)
6. Generate first SDK (TypeScript) via Orval

### Phase 2: Resource Rationalization (Month 2-4)

**Goal**: Map all 150 endpoints to proper REST resources.

**Target Resource Model** (public API):

```
/v1/checkouts                           POST (create), GET (list)
/v1/checkouts/{id}                      GET, PATCH
/v1/checkouts/{id}/events               POST (track)
/v1/checkouts/{id}/messages             POST (chat), GET (history)
/v1/checkouts/{id}/offers               GET, POST (apply)
/v1/checkouts/{id}/shipping             POST (evaluate), PUT (select)
/v1/checkouts/{id}/payment              POST (pay)
/v1/checkouts/{id}/complete             POST (finalize)

/v1/orders                              GET (list), POST (create)
/v1/orders/{id}                         GET
/v1/orders/{id}/cancel                  POST
/v1/orders/{id}/tracking                GET, PUT
/v1/orders/{id}/timeline                GET
/v1/orders/{id}/returns                 POST (initiate)

/v1/products                            CRUD
/v1/products/{id}/variants              CRUD
/v1/products/{id}/media                 POST, DELETE

/v1/customers                           GET (list)
/v1/customers/{id}                      GET
/v1/customers/{id}/purchases            GET
/v1/customers/{id}/conversations        GET

/v1/coupons                             CRUD
/v1/coupons/validate                    POST

/v1/cross-sell/promotions               CRUD
/v1/cross-sell/suggestions              POST (get suggestions)

/v1/shipping/quotes                     POST
/v1/shipping/labels                     POST
/v1/shipping/{shipmentId}/tracking      GET

/v1/payments/intents                    POST, GET
/v1/payments/intents/{id}/confirm       POST
/v1/payments/connections                CRUD

/v1/negotiations/evaluate               POST
/v1/negotiations/sessions               GET
/v1/negotiations/policy                 GET, PUT

/v1/settings/checkout                   GET, PUT
/v1/settings/agent-rules                GET, PUT
/v1/settings/store                      GET, PUT
/v1/settings/theme                      GET, PUT

/v1/integrations/connections            CRUD
/v1/integrations/api-keys               CRUD
/v1/integrations/webhooks               CRUD
/v1/integrations/webhooks/{id}/test     POST
/v1/integrations/webhooks/{id}/deliveries  GET

/v1/experiments                         CRUD + lifecycle actions
/v1/analytics/dashboard                 GET
/v1/analytics/funnel                    GET
/v1/analytics/products                  GET

/v1/support/tickets                     CRUD
/v1/support/settings                    GET, PUT

/v1/onboarding                          GET
/v1/onboarding/steps/{step}/complete    POST
```

### Phase 3: Developer Platform (Month 4-6)

**Goal**: Production-ready for external consumption.

1. **API Gateway**: Kong/Tyk for rate limiting, API plans, analytics
2. **Developer Portal**: Scalar-powered docs + sandbox
3. **SDK Pipeline**: CI generates TypeScript + Python + PHP SDKs on spec change
4. **Contract Tests**: Pact or Specmatic for consumer-driven validation
5. **Webhook Catalog**: Event registry with schema, retry policy, example payloads
6. **API Plans**: Free (100 req/min), Pro (1000 req/min), Enterprise (custom)
7. **Deprecation Policy**: 6-month sunset, `Sunset` header, `Deprecation` header per RFC 8594

---

## DTO Evolution Strategy

### Current → Target

```typescript
// CURRENT: Leaky domain model
// Controller returns raw entity or loosely typed object
@Get(':id')
async getOrder(@Param('id') id: string) {
  return this.orderService.findById(id); // ← leaks internal structure
}

// TARGET: Explicit response DTO with mapper
@Get(':id')
@ApiOkResponse({ type: OrderResponse })
async getOrder(@Param('id') id: string): Promise<ApiResponse<OrderResponse>> {
  const order = await this.getOrderUseCase.execute(id);
  return ApiResponse.ok(OrderResponseMapper.toResponse(order));
}
```

### Response Envelope Standard

```typescript
interface ApiResponse<T> {
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
    version: "v1";
  };
  pagination?: {
    cursor?: string;
    has_more: boolean;
    total?: number;        // only for offset mode
  };
  _links?: {              // optional, progressive HATEOAS
    self: string;
    next?: string;
    prev?: string;
  };
}

interface ApiError {
  type: string;           // RFC 7807 URI
  title: string;
  status: number;
  code: string;           // machine-readable
  detail?: string;
  fields?: Record<string, string[]>;
  correlation_id: string;
}
```

### Input DTO Naming Convention

```
Create{Resource}Request    — POST creation
Update{Resource}Request    — PUT/PATCH update
{Resource}Response         — single resource
{Resource}ListResponse     — paginated list
{Resource}SummaryResponse  — lightweight projection
```

---

## Event Contract Evolution

### Current State
- 30+ event types via transactional outbox
- schema_version: 1 (static)
- In-memory event bus (not durable in prod yet)

### Target State
- **Webhook Events**: Subset of domain events exposed as webhook payloads
- **Event Versioning**: `schema_version` incremented on breaking changes; old versions supported for 12 months
- **Event Catalog**: Machine-readable registry of all webhook event types
- **Delivery Guarantees**: At-least-once, ordered per aggregate, retry with exponential backoff

### Public Webhook Event Naming

```
checkout.created
checkout.abandoned
checkout.completed
order.created
order.paid
order.shipped
order.delivered
order.cancelled
payment.succeeded
payment.failed
payment.refunded
shipping.quoted
shipping.label_created
shipping.status_updated
customer.created
customer.updated
negotiation.offer_made
negotiation.offer_accepted
experiment.completed
```

---

## Architecture Boundary Changes

### New Module: `public-api`

```
apps/api/src/public-api/
├── v1/
│   ├── checkouts/          → delegates to checkout module
│   ├── orders/             → delegates to checkout/operations
│   ├── products/           → delegates to catalog module  
│   ├── customers/          → delegates to buyer-account module
│   ├── payments/           → delegates to payment module
│   ├── shipping/           → delegates to shipping module
│   ├── settings/           → delegates to checkout-settings, agent-rules, store-settings
│   ├── integrations/       → delegates to integrations module
│   ├── analytics/          → delegates to checkout dashboard
│   ├── experiments/        → delegates to experiments module
│   └── support/            → delegates to support module
├── shared/
│   ├── decorators/         (ApiStability, ApiVersion, PublicEndpoint)
│   ├── interceptors/       (ResponseEnvelope, Pagination, Deprecation)
│   ├── filters/            (PublicApiExceptionFilter)
│   ├── guards/             (ApiKeyGuard, ScopeGuard, RateLimitGuard)
│   └── dto/                (shared response/pagination types)
└── public-api.module.ts
```

### Dependency Direction

```
public-api/ (presentation layer — thin)
    ↓ imports facades/use-cases from
modules/ (application + domain — unchanged)
    ↓ uses
infrastructure/ (repos, adapters — unchanged)
```

**Key principle**: `public-api/` is a NEW presentation layer on top of existing use-cases. It does NOT duplicate business logic. It only:
1. Maps HTTP → use-case input
2. Maps use-case output → response DTO
3. Adds API-specific concerns (versioning, rate limiting, deprecation)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking existing widget/dashboard | Keep internal routes, deprecate gradually |
| Scope creep | Phase 1 = 10 core resources only (checkout, orders, products, payments, shipping) |
| SDK quality | Contract tests + generated, not hand-written |
| Performance overhead (mapper layer) | Mappers are pure transforms; negligible vs DB I/O |
| Version proliferation | Max 2 active versions; strict sunset policy |
| Security surface increase | API keys with granular scopes; rate limiting from day 1 |

---

## Decision Register (Sub-Decisions)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | REST L2, not HATEOAS | PME market, SDK generation, developer familiarity |
| 2 | Not GraphQL | Resource-centric domain; avoid N+1/auth-per-field complexity |
| 3 | Cursor pagination default | Performant at scale; offset as opt-in for simple UIs |
| 4 | Response envelope always | Consistent parsing, metadata, progressive links |
| 5 | Separate `public-api/` layer | Don't pollute domain modules with API concerns |
| 6 | OpenAPI-first (decorators) | Spec is source of truth; SDKs generated |
| 7 | 6-month deprecation window | Balance evolution speed vs integrator stability |
| 8 | API Gateway external (Kong/Tyk) | Don't build rate limiting/analytics in-house |
| 9 | Webhook events are subset of domain events | Internal events are richer; public events are stable contracts |
| 10 | snake_case for JSON fields in public API | Industry standard (Stripe, VTEX, Shopify) |

---

## Links

- Related: [ADR-002 (TBD): API Versioning Strategy]
- Related: [ADR-003 (TBD): Webhook Delivery & Retry Policy]
- Related: [ADR-004 (TBD): API Gateway Selection]
- Informs: `.specs/VTEX_MATURITY_MAP.md`

---

## Appendix A: Comparison with VTEX API

| Aspect | VTEX | AACP (Target) |
|--------|------|---------------|
| Style | REST L2 | REST L2 |
| Auth | AppKey + AppToken | API Key (scoped) + OAuth2 (future) |
| Versioning | URL path `/api/v1/` | URL path `/v1/` |
| Pagination | Scroll + offset | Cursor (default) + offset |
| Webhooks | Hook subscriptions | Webhook endpoints with retry |
| Rate Limits | Per account | Per API key + plan tier |
| SDK | Auto-generated | Auto-generated (Orval) |
| Sandbox | Environment per workspace | Test mode per API key |
| HATEOAS | No | No (progressive links optional) |
| Response format | Raw resources | Envelope `{ data, meta }` |
| Errors | Custom | RFC 7807 ProblemDetails |
| Idempotency | Partial | Full (all writes) |

## Appendix B: Priority Endpoints for Phase 1

Top 10 resources to productize first (highest external value):

1. `POST /v1/checkouts` — Create AI-powered checkout session
2. `POST /v1/checkouts/{id}/messages` — Chat with AI agent
3. `GET /v1/orders` — List orders
4. `POST /v1/payments/intents` — Create payment
5. `POST /v1/shipping/quotes` — Get shipping options
6. `GET /v1/products` — List catalog
7. `POST /v1/integrations/webhooks` — Subscribe to events
8. `GET /v1/settings/checkout` — Read configuration
9. `PUT /v1/settings/agent-rules` — Configure AI agent
10. `POST /v1/negotiations/evaluate` — Trigger AI negotiation
