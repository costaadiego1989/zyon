---
name: aacp-api-migration-plan
description: Step-by-step REST L2 migration with breaking change detection, validation gates, and per-module rollout strategy
metadata:
  type: project
  date: 2026-08-18
---

# AACP API Migration to REST L2 — Detailed Execution Plan

## Phases & Gates

### Phase 0: Validation & Infrastructure (Week 1)
**Goal**: Map all breaking changes, create test doubles, establish CI gates before touching production code.

#### Step 0.1: Dependency & Consumer Scan
- [ ] Grep all imports: `public-api/`, controllers, services to understand existing coupling
- [ ] Map which consumers will break: widget_v2 (`/embed/...`), storefront (`/storefront/...`), dashboard (`/api/...`), tests
- [ ] Run existing e2e tests to establish baseline (all must pass)
- [ ] Document every endpoint currently used by widget_v2 + storefront + dashboard

#### Step 0.2: Breaking Changes Registry
Create `.specs/api-migration/BREAKING_CHANGES.md`:
```markdown
| Old Endpoint | New Endpoint | Consumer | Risk | Mitigation |
|---|---|---|---|---|
| POST /checkout/start-checkout | POST /v1/checkouts | widget_v2, storefront | HIGH | Dual route (deprecate old) |
| POST /embed/cart | PATCH /v1/checkouts/{id}/cart | widget_v2 | HIGH | Adapter layer in widget |
| GET /storefront/config | GET /v1/merchants/{mid}/config | storefront | MEDIUM | Proxy via facade |
| ... | ... | ... | ... | ... |
```

#### Step 0.3: Create Parallel Layer
```
apps/api/src/
├── modules/           ← UNCHANGED (production, never touch)
├── public-api/        ← NEW (thin presentation layer)
│   ├── v1/           ← NEW endpoints, no business logic change
│   └── shared/       ← DTO, mappers, response envelopes
└── legacy-compat/    ← NEW (routes that proxy to v1/ with adapter)
    └── embed/        ← wraps v1/ for widget_v2 during transition
```

#### Step 0.4: Establish CI Gates
- [ ] Add `validate-api-contract.mjs` script to check:
  - All public endpoints have response DTOs (no raw entities)
  - All DTOs are in `public-api/shared/dto/`
  - Response envelope always present
  - No controller imports from another controller (only from use-cases)
- [ ] Add to pre-commit hook: contract validation must pass
- [ ] Add to CI: breaking change detection (compare OpenAPI specs)

#### Step 0.5: Integration Test Blueprint
Create test templates for each module:
```
apps/api/src/public-api/v1/__tests__/
├── checkouts.e2e.spec.ts      (POST, GET, PATCH, nested resources)
├── orders.e2e.spec.ts
├── products.e2e.spec.ts
└── ...
```
Each template:
- Tests new v1/ endpoint
- Verifies response envelope shape
- Verifies old endpoint still works (backward compat mode)
- Tests migration adapter (old → new)

---

### Phase 1: Core Foundation (Week 2-3)
**Goal**: Establish patterns on 3 low-risk resources. Zero breaking changes to widget/storefront yet.

#### Module: `checkouts` (highest complexity, highest value)

**Step 1.1: Analyze Current State**
- [ ] Read [apps/api/src/modules/checkout/](checkout/) completely
- [ ] List all controllers: `start-store-conversation.controller.ts`, `track-checkout-event.controller.ts`, etc.
- [ ] List all DTOs used: implicit response shapes
- [ ] Map all external callers: widget, storefront, dashboard, tests
- [ ] Run checkout tests: `cd apps/api && pnpm test -- checkout`

**Step 1.2: Define Response DTOs**
```typescript
// public-api/shared/dto/response-envelope.dto.ts
export interface ApiResponse<T> {
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
    version: "v1";
  };
  pagination?: { cursor?: string; has_more: boolean };
  _links?: { self: string; next?: string };
}

// public-api/v1/checkouts/checkouts.dto.ts
export interface CreateCheckoutRequest {
  merchant_id: string;
  cart: CartItem[];
  customer_email: string;
  // ...
}

export interface CheckoutResponse {
  id: string;
  session_id: string;
  status: "pending" | "abandoned" | "completed";
  cart: CartItemResponse[];
  conversation_id: string;
  created_at: string;
  // NO internal fields (timestamps, internal flags)
}

export interface CheckoutListResponse {
  items: CheckoutResponse[];
  meta: { total: number };
}
```

**Step 1.3: Create v1 Layer (Thin)**
```typescript
// public-api/v1/checkouts/checkouts.controller.ts
@Controller('v1/checkouts')
@ApiTags('Checkouts')
export class CheckoutsV1Controller {
  constructor(
    private readonly startCheckoutUseCase: StartCheckoutUseCase,
    private readonly mapper: CheckoutResponseMapper,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create checkout session' })
  @ApiCreatedResponse({ type: ApiResponse })
  async createCheckout(
    @Body() req: CreateCheckoutRequest,
  ): Promise<ApiResponse<CheckoutResponse>> {
    const checkout = await this.startCheckoutUseCase.execute(
      CheckoutRequestMapper.toDomain(req),
    );
    return ApiResponse.ok(this.mapper.toResponse(checkout));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get checkout session' })
  @ApiOkResponse({ type: ApiResponse })
  async getCheckout(
    @Param('id') id: string,
  ): Promise<ApiResponse<CheckoutResponse>> {
    const checkout = await this.getCheckoutUseCase.execute(id);
    return ApiResponse.ok(this.mapper.toResponse(checkout));
  }
}
```

**Step 1.4: Create Mappers (Domain → Response)**
```typescript
// public-api/v1/checkouts/checkouts.mapper.ts
export class CheckoutResponseMapper {
  static toResponse(checkout: CheckoutEntity): CheckoutResponse {
    return {
      id: checkout.id,
      session_id: checkout.sessionId,
      status: checkout.status,
      cart: checkout.cart.map(CartMapper.toResponse),
      conversation_id: checkout.conversationId,
      created_at: checkout.createdAt.toISOString(),
      // ← NO leaky fields
    };
  }
}

export class CheckoutRequestMapper {
  static toDomain(req: CreateCheckoutRequest): CreateCheckoutCommand {
    return {
      merchantId: req.merchant_id,
      cart: req.cart.map(CartMapper.toDomain),
      customerEmail: req.customer_email,
    };
  }
}
```

**Step 1.5: Add OpenAPI Decorators**
```typescript
@Post()
@Stability('stable')                    // custom decorator
@ApiVersion('1.0.0')
@ApiOperation({ summary: 'Create checkout' })
@ApiCreatedResponse({ type: ApiResponse })
@ApiBadRequestResponse({ description: 'Invalid input' })
@ApiConflictResponse({ description: 'Duplicate idempotency key' })
@RateLimit(100, '1m')                   // custom decorator
async createCheckout(...): Promise<...> { ... }
```

**Step 1.6: Integration Tests**
```typescript
// public-api/v1/checkouts/__tests__/checkouts.e2e.spec.ts
describe('POST /v1/checkouts', () => {
  it('should create checkout and return ApiResponse<CheckoutResponse>', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/checkouts')
      .send(validCreateCheckoutRequest)
      .expect(201);

    expect(res.body).toEqual({
      data: expect.objectContaining({
        id: expect.any(String),
        session_id: expect.any(String),
        status: 'pending',
        created_at: expect.any(String),
      }),
      meta: {
        request_id: expect.any(String),
        timestamp: expect.any(String),
        version: 'v1',
      },
    });
  });

  it('should fail with 422 on invalid cart', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/checkouts')
      .send({ merchant_id: 'mid', cart: [] })
      .expect(422);

    expect(res.body.status).toBe(422);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields).toContain('cart');
  });
});

describe('Backward Compat: OLD POST /checkout/start-checkout', () => {
  it('should still work via legacy adapter', async () => {
    const res = await request(app.getHttpServer())
      .post('/checkout/start-checkout')
      .send(oldFormatRequest)
      .expect(200);

    // Old format response still works
    expect(res.body.sessionId).toBeDefined();
  });

  it('should warn in response headers about deprecation', async () => {
    const res = await request(app.getHttpServer())
      .post('/checkout/start-checkout')
      .expect(200);

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBeDefined();
  });
});
```

**Step 1.7: Validation Checkpoint**
- [ ] All new v1 tests pass: `pnpm test -- checkouts.e2e`
- [ ] All old checkout tests still pass (backward compat)
- [ ] OpenAPI spec generates without errors
- [ ] Widget_v2 e2e still passes (still using old routes)
- [ ] Storefront e2e still passes

**Step 1.8: Document Breaking Changes**
Update `.specs/api-migration/BREAKING_CHANGES.md`:
```markdown
## Checkout Module

### Non-Breaking (v1 parallel, old routes remain)
- POST /v1/checkouts ← new
- POST /checkout/start-checkout ← old, deprecated, returns 2026-12-18 sunset

### Response Shape Change (OLD response is POST /checkout/start-checkout, NEW is POST /v1/checkouts)
| Old | New | Impact |
|-----|-----|--------|
| `sessionId` | `session_id` (snake_case) | Widget must map fields |
| Root object | Wrapped in `{ data: {...} }` | Widget must unwrap |
| No `meta` | Includes `meta.request_id` | Widget can ignore |
```

---

#### Module: `orders` (medium complexity, medium value)

**Step 1.9: Repeat for Orders**
- [ ] Analyze current state (same as checkouts)
- [ ] Define DTOs: `OrderResponse`, `OrderListResponse`
- [ ] Create v1 controller, mappers
- [ ] Add tests (old + new)
- [ ] Document breaking changes
- [ ] Validation checkpoint

---

#### Module: `products` (low complexity, high value)

**Step 1.10: Repeat for Products**
- [ ] Analyze current state
- [ ] Define DTOs: `ProductResponse`, `ProductListResponse`, `VariantResponse`
- [ ] Create v1 controller, mappers
- [ ] Add tests
- [ ] Document breaking changes
- [ ] Validation checkpoint

---

**Phase 1 Deliverables**:
- [ ] 3 modules fully migrated to v1 (checkouts, orders, products)
- [ ] Old routes still work with deprecation headers
- [ ] All e2e tests pass (old + new)
- [ ] OpenAPI spec updated with v1 endpoints
- [ ] `.specs/api-migration/BREAKING_CHANGES.md` complete for 3 modules
- [ ] Widget_v2 e2e still green (no changes to widget yet)
- [ ] Storefront e2e still green

---

### Phase 2: Remaining Core Modules (Week 4-5)

**Goal**: Migrate all remaining high-value resources. Prepare breaking change list for widget/storefront.

#### Modules in Priority Order
1. `payments` — critical for checkout flow
2. `shipping` — critical for fulfillment
3. `coupons` — monetization
4. `cross-sell` — revenue driver
5. `settings` (checkout-settings, agent-rules) — configuration
6. `negotiations` — AI core
7. `support` — customer service
8. `integrations` (webhooks, api-keys, connections) — developer platform
9. `analytics` — dashboards
10. `experiments` — A/B testing

**Per Module Checklist**:
- [ ] Current state analysis
- [ ] DTO design + validation
- [ ] v1 controller (thin wrapper)
- [ ] Mappers (domain → response)
- [ ] Integration tests (old + new)
- [ ] Breaking changes documented
- [ ] Old routes deprecated with sunset headers
- [ ] All tests pass (e2e + unit)
- [ ] OpenAPI spec updated

---

### Phase 3: Widget_v2 & Storefront Migration (Week 6-7)

**Goal**: Update consumers to use new v1 endpoints. Breaking changes now applied.

#### Step 3.1: Create Widget Adapter Layer
```
apps/widget/src/lib/
├── api/
│   ├── v1-client/         (generated from OpenAPI)
│   ├── legacy-adapter.ts  (old /embed/... → new /v1/...)
│   └── index.ts           (exports one consistent API)
```

```typescript
// apps/widget/src/lib/api/legacy-adapter.ts
export const checkoutApi = {
  createCheckout: async (req: OldCreateCheckoutRequest) => {
    const v1Response = await fetch('/api/v1/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        merchant_id: req.merchantId,
        cart: req.cart,
        customer_email: req.customerEmail,
      }),
    });
    const { data } = await v1Response.json();
    // Map back to old format for internal consistency
    return {
      sessionId: data.session_id,
      conversationId: data.conversation_id,
      // ...
    };
  },
};
```

#### Step 3.2: Update Widget E2E Tests
- [ ] Replace `/embed/...` calls with `/api/v1/...`
- [ ] Update response parsing (unwrap `data` envelope)
- [ ] Verify all e2e tests pass
- [ ] Run widget tests: `cd apps/widget && pnpm e2e`

#### Step 3.3: Update Storefront
- Repeat for storefront `/storefront/...` → `/v1/...`

#### Step 3.4: Update Dashboard
- Dashboard already uses `/api/...` (which can map to v1)
- Verify all dashboard e2e tests pass

---

### Phase 4: Cleanup & Old Route Removal (Week 8)

**Goal**: Remove deprecated old routes after sunset period expires (or immediately if no external users).

#### Step 4.1: Remove Legacy Routes
- [ ] Remove old controller methods
- [ ] Remove old routes from app.module
- [ ] Remove deprecation headers
- [ ] Run all tests (must pass)

#### Step 4.2: Remove Legacy Adapters
- [ ] Remove `legacy-compat/` layer
- [ ] Remove widget/storefront adapter code
- [ ] Simplify imports

#### Step 4.3: Clean Up OpenAPI Spec
- [ ] Remove deprecated endpoints
- [ ] Regenerate SDKs with final spec

---

## Risk Mitigation Strategies

### Strategy 1: Feature Flags
```typescript
// For each module migration, use feature flag
@Injectable()
export class CheckoutController {
  constructor(
    private config: ConfigService,
  ) {}

  @Post()
  async createCheckout(...) {
    if (this.config.get('USE_V1_CHECKOUTS')) {
      // Use new v1 path
      return new CheckoutsV1Controller(...).createCheckout(...);
    }
    // Fall back to old path
    return this.oldCreateCheckout(...);
  }
}
```

### Strategy 2: Shadow Testing
```typescript
// Deploy both v1 and old routes
// Log each request to both and compare responses
// Alert if responses diverge
@Injectable()
export class ShadowTestInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      tap((res) => {
        const v1Response = await callV1InParallel(context.getRequest());
        if (!responsesMatch(res, v1Response)) {
          logger.error('Shadow test mismatch', { old: res, v1: v1Response });
        }
      }),
    );
  }
}
```

### Strategy 3: Canary Rollout
```
Week 1: 10% of traffic to v1
Week 2: 25% of traffic to v1
Week 3: 50% of traffic to v1
Week 4: 100% of traffic to v1
```

### Strategy 4: Rollback Procedure
```bash
# If v1 breaks production:
$ git revert <v1-commit>
$ pnpm build && pnpm deploy
# All traffic goes back to old routes
```

---

## Testing Strategy

### Unit Tests (Per Module)
- Test mappers (domain → response)
- Test DTO validation
- Test old route still works

### Integration Tests (E2E)
- Test v1 endpoint in isolation
- Test full checkout flow with v1
- Test backward compat with old routes
- Test deprecation headers

### Consumer Tests (Widget, Storefront)
- Widget e2e with new v1 endpoints
- Storefront e2e with new v1 endpoints
- Dashboard e2e unchanged

### Contract Tests (SDK Generation)
- Generate SDK from OpenAPI spec
- Verify SDK types match response DTOs
- Use SDK in tests (verify contracts)

---

## Documentation Updates

### For Each Module
1. **OpenAPI Spec** — Decorators on controllers
2. **Breaking Changes Tracker** — `.specs/api-migration/BREAKING_CHANGES.md`
3. **Migration Guide** — `.specs/api-migration/MODULE_{name}_GUIDE.md`
   - Before/After examples
   - Common pitfalls
   - Testing checklist

### Developer Portal (Later)
- API reference (auto-generated from OpenAPI)
- Migration guide (copy from specs)
- SDK examples (TypeScript, Python, PHP)
- Webhook catalog + examples

---

## Timeline & Milestones

| Week | Modules | Status | Gate |
|------|---------|--------|------|
| W1 | Validation, tooling, patterns | Planning | All tests pass |
| W2-3 | Checkouts, Orders, Products | Execution | Widget e2e green |
| W4-5 | Payments, Shipping, Coupons, Cross-Sell, Settings, Negotiations, Support, Integrations, Analytics, Experiments | Execution | Storefront e2e green |
| W6-7 | Widget_v2, Storefront consumer updates | Execution | All e2e tests green |
| W8 | Cleanup, old route removal | Completion | Prod stable 1 week |

---

## Success Criteria

- [ ] All 10 modules migrated to v1
- [ ] All old routes still work (backward compat)
- [ ] Widget_v2 e2e tests all green
- [ ] Storefront e2e tests all green
- [ ] Dashboard e2e tests all green
- [ ] API e2e tests all green
- [ ] OpenAPI spec complete + SDK generated
- [ ] Zero breaking changes to consumers during migration
- [ ] Breaking changes doc complete
- [ ] Deploy to production with zero incidents

---

## Rollback Plan

If any phase fails:
1. Revert commits to last successful phase
2. Run all e2e tests to verify green
3. Deploy previous stable version
4. Investigate root cause
5. Create issue + plan retry
