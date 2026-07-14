# REFACTOR.md — buyer-purchase-history module

## Current State

**Responsibility:** Buyer purchase history tracking per merchant, buyer identity reconciliation (global_user_id OR merchant_customer_id), agent personalization context.

**Structure:**
- `domain/entities/buyer-purchase-history.entity.ts` — Immutable entity; tracks purchases per buyer-merchant pair. Computes stats (LTV, top SKUs, discount sensitivity).
- `domain/buyer-purchase-history.types.ts` — Type definitions for identity, purchase records, stats, and context.
- `domain/ports/` — Repository & metering port (optional).
- `application/use-cases/` — RecordCompletedPurchaseUseCase (idempotent record), GetBuyerPurchaseContextUseCase (for agent personalization).
- `infrastructure/` — Prisma repositories (buyer identity + purchase history).
- `presentation/http/buyer-purchase-history.controller.ts` — GET /buyer-purchase-history/global-users/:globalUserId/context (merchant-scoped).

**Key Flows:**
1. Order completes → checkout publishes order.completed → BuyerPurchaseHistoryModule subscribes → RecordCompletedPurchaseUseCase → idempotent insert → metering event published.
2. Agent needs buyer context → GetBuyerPurchaseContextUseCase → fetch history → compute stats → return safe context with copy hints → metering event (context_used).

**Known Issues:**
- Entity validates merchant_id boundary but allows reconciliation of two buyer identities (globalUserId + merchantCustomerId can both exist). No explicit merge logic; identity is resolved on each read.
- Metering is @Optional injection. If absent, events are silently not recorded. No indication that metering is missing.
- PurchaseHistoryIdentity is flexible (globalUserId OR merchantCustomerId). But if both are provided, which takes precedence? Contract is ambiguous.
- Controller checks AuthGuard (merchant auth) but does not validate that the requested globalUserId belongs to that merchant. Attacker can request any buyer's history.
- toSafeContext() includes discount_sensitivity computed from purchase history. If buyer makes only 1 purchase, sensitivity is "unknown". Agent copy hint is unhelpful.
- No pagination in purchase history entity itself; all purchases loaded into memory. Large histories (1000+ orders) consume RAM.

---

## CRITICAL Issues

**C1: Identity reconciliation is implicit; no explicit merge**
- `buyer-purchase-history.entity.ts:31–54`: recordPurchase() can consolidate two identities (globalUserId + merchantCustomerId) without explicit user consent. If a buyer registers with email, then later buys with merchant account ID, the two identities are merged into one purchase history. No audit trail. Fix: explicitly separate identities or require merge consent from buyer.

**C2: Controller does not validate buyer belongs to merchant**
- `buyer-purchase-history.controller.ts:11–16`: Endpoint is GET /buyer-purchase-history/global-users/:globalUserId/context. No check that globalUserId is associated with the authenticated merchant. Attacker can request any buyer's history by guessing globalUserId. Fix: validate buyer-merchant association before returning context.

**C3: Metering is @Optional; silent failure if missing**
- `buyer-purchase-history.use-cases.ts:26, 56`: @Optional @Inject(PURCHASE_HISTORY_METERING_PORT). If metering is not wired, events are discarded. No warning. Merchant has no usage visibility. Fix: log warning or fail loudly if metering is required but missing.

**C4: PurchaseHistoryIdentity contract is ambiguous**
- `buyer-purchase-history.types.ts:5–8`: Identity has globalUserId? AND merchantCustomerId?. If both are provided, which is canonical? Entity assumes both refer to same buyer; no validation. Fix: require exactly one (XOR) or clarify precedence (globalUserId > merchantCustomerId).

---

## HIGH Priority

**H1: Entity loads all purchases into memory; no pagination**
- `buyer-purchase-history.entity.ts:57–78`: stats() iterates over all purchases to compute topCategories, topSkus, discountSensitivity. No limit. If buyer has 10,000 orders, entity allocates 10K item arrays. Fix: paginate at repository level; load recent N purchases (e.g., last 100).

**H2: topSkus computed on every stats() call; no caching**
- `buyer-purchase-history.entity.ts:74–76`: recentSkus() re-filters purchases on each call. If buyer has 5,000 orders, repeated calls (e.g., multiple agents querying in parallel) waste CPU. Fix: cache stats; invalidate on recordPurchase().

**H3: Stats derivation does not handle missing/malformed items**
- `buyer-purchase-history.entity.ts:69–77`: Assumes item.categoryId & item.sku exist. If a purchase record has null sku, topSkus breaks. No error handling. Fix: validate item schema; skip malformed entries with warning.

**H4: discountSensitivity is computed from all purchases but buyer may have changed behavior**
- `buyer-purchase-history.entity.ts:141–148`: If buyer made 100 discount purchases in 2020 but 0 in 2024, sensitivity is still "high". Context is stale. Agent may incorrectly offer discount. Fix: compute sensitivity over recent window (e.g., last 12 months).

---

## MEDIUM Priority

**M1: RecordCompletedPurchaseUseCase returns ordersCount but not order_id**
- `buyer-purchase-history.use-cases.ts:44–49`: Response only includes orders_count. Caller cannot know if this is a new order or duplicate. No order ID in response. Fix: return idempotent + order_id to allow caller to audit.

**M2: GetBuyerPurchaseContextUseCase publishes metering on empty history**
- `buyer-purchase-history.use-cases.ts:82`: If history is empty, context is synthesized with zeros. Metering is still published (context_used event). Merchant sees usage spike for lookups that found nothing. Fix: distinguish first-time buyer (publish metering) from unknown buyer (skip metering).

**M3: PrismaBuyerIdentityRepository has no query to resolve globalUserId**
- `infrastructure/prisma-buyer-identity.repository.ts`: Only interface; no implementation shown. If buyer registers with email (globalUserId) then later uses merchant account (merchantCustomerId), no way to link them. Fix: implement findByGlobalUserId() to support identity lookup.

**M4: Purchase items are cloned on every snapshot() call**
- `buyer-purchase-history.entity.ts:150–155`: clonePurchase() deep-copies items array on each snapshot(). Wasteful if called frequently. Fix: use immutable data structures or cache snapshots.

---

## LOW Priority

**L1: roundMoney() uses division; may lose precision**
- `buyer-purchase-history.entity.ts:157–159`: Math.round(value * 100) / 100. If value is 1.005, becomes 1.00 (banker's rounding). Fix: use Decimal library for money.

**L2: topKeys() has tie-break logic but no determinism guarantee**
- `buyer-purchase-history.entity.ts:114–125`: Tie-break uses firstSeen order. If two SKUs have same count & same first position (unlikely but possible), order is undefined. Fix: add secondary sort key (lexicographic).

**L3: No TTL on purchase history records**
- If buyer asks to forget purchase history (GDPR), there is no automated deletion. Records exist forever. Fix: add expiresAt & scheduled cleanup job.

**L4: returning_customer_copy_hint is hardcoded strings**
- `buyer-purchase-history.entity.ts:96–99`: Copy hints are English-only. Hardcoded. No i18n. Fix: source from locale-aware template or agent rules.

---

## Coupling Map

```
buyer-purchase-history module
├─ → auth (AuthGuard for controller access)
└─ → shared/messaging (OutboxRepository for events)

Incoming:
├─ ← checkout (publishes order.completed event)
└─ ← agent (GetBuyerPurchaseContextUseCase)

Outgoing events:
├─ purchase_history.imported_order
└─ purchase_history.context_used
```

Light coupling. Primary dependency is event bus (checkout → history). Metering is optional. Strong outgoing but receiver is undefined (metering service).

---

## Proposed Changes

### Phase 1: Fix identity contract (C4)

**Require XOR identity**
```typescript
// buyer-purchase-history.types.ts
export interface PurchaseHistoryIdentity {
  merchantId: string;
  // Exactly one of the following:
  globalUserId?: string;
  merchantCustomerId?: string;
}

// buyer-purchase-history.entity.ts
static create(input: PurchaseHistoryIdentity): BuyerPurchaseHistoryEntity {
  const hasGlobal = !!input.globalUserId;
  const hasMerchantId = !!input.merchantCustomerId;
  if ((hasGlobal && hasMerchantId) || (!hasGlobal && !hasMerchantId)) {
    throw new Error("exactly_one_identity_required");
  }
  return new BuyerPurchaseHistoryEntity({...});
}
```

### Phase 2: Validate buyer-merchant association (C2)

**Add merchant ownership check**
```typescript
// buyer-purchase-history.controller.ts
@Get('global-users/:globalUserId/context')
async getByGlobalUser(
  @Req() request: { user?: unknown },
  @Param('globalUserId') globalUserId: string
) {
  const user = currentUser(request);
  // NEW: validate buyer is registered with this merchant
  const buyer = await this.buyerRepo.findByGlobalUserId(globalUserId);
  if (!buyer || buyer.merchantId !== user.merchantId) {
    throw new ForbiddenException('buyer_not_associated_with_merchant');
  }
  return this.getContext.execute({
    merchantId: user.merchantId,
    globalUserId
  });
}
```

### Phase 3: Fix metering @Optional handling (C3)

**Warn if missing; make configurable**
```typescript
// buyer-purchase-history.use-cases.ts
@Injectable()
export class RecordCompletedPurchaseUseCase {
  constructor(
    @Inject(BUYER_PURCHASE_HISTORY_REPOSITORY) private readonly repository,
    @Optional() @Inject(PURCHASE_HISTORY_METERING_PORT) private readonly metering?: PurchaseHistoryMeteringPort,
    @Optional() private readonly logger?: Logger
  ) {
    if (!this.metering) {
      this.logger?.warn('[buyer-purchase-history] Metering is not configured; events will not be recorded');
    }
  }

  async execute(input: PurchaseRecord): Promise<...> {
    const result = await this.repository.recordPurchase(input);
    if (!result.idempotent && this.metering) {
      await this.metering.record({...});
    }
    return { recorded: true, idempotent: result.idempotent, ... };
  }
}
```

### Phase 4: Paginate entity loading (H1)

**Load recent purchases only**
```typescript
// buyer-purchase-history.entity.ts
static create(input: PurchaseHistoryIdentity): BuyerPurchaseHistoryEntity {
  return new BuyerPurchaseHistoryEntity({
    merchantId: input.merchantId,
    globalUserId: input.globalUserId,
    merchantCustomerId: input.merchantCustomerId,
    purchases: [], // Start empty
    recentWindow: 12, // months
  });
}

stats(): BuyerMerchantStats {
  // Use only recent purchases (within last 12 months)
  const now = Date.now();
  const windowMs = this.props.recentWindow * 30 * 24 * 60 * 60 * 1000;
  const recent = this.props.purchases.filter(
    (p) => new Date(p.completedAt).getTime() > now - windowMs
  );

  const ordersCount = recent.length;
  ...
}
```

### Phase 5: Cache stats (H2)

**Memoize expensive computations**
```typescript
// buyer-purchase-history.entity.ts
private cachedStats: BuyerMerchantStats | null = null;

stats(): BuyerMerchantStats {
  if (this.cachedStats) return { ...this.cachedStats }; // Return copy

  const ordersCount = this.props.purchases.length;
  const lifetimeValue = roundMoney(...);
  ...

  this.cachedStats = { ordersCount, lifetimeValue, ... };
  return { ...this.cachedStats };
}

recordPurchase(purchase: PurchaseRecord): BuyerPurchaseHistoryEntity {
  ...
  const next = new BuyerPurchaseHistoryEntity({...});
  next.cachedStats = null; // Invalidate cache
  return next;
}
```

### Phase 6: Validate purchase schema (H3)

**Skip malformed items**
```typescript
// buyer-purchase-history.entity.ts
function topKeys(values: string[], limit = 5): string[] {
  const filtered = values.filter((v) => v && typeof v === 'string');
  if (filtered.length === 0) return [];

  const counts = new Map<string, number>();
  for (const value of filtered) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}
```

### Phase 7: Time-window sensitivity (H4)

**Compute discount sensitivity over recent purchases only**
```typescript
// buyer-purchase-history.entity.ts
function discountSensitivity(
  purchases: PurchaseRecord[],
  windowMonths = 12
): BuyerMerchantStats["discountSensitivity"] {
  const now = Date.now();
  const windowMs = windowMonths * 30 * 24 * 60 * 60 * 1000;
  const recent = purchases.filter(
    (p) => new Date(p.completedAt).getTime() > now - windowMs
  );

  if (recent.length < 2) return "unknown";
  const discounted = recent.filter((p) => p.discountAmount > 0).length;
  const ratio = discounted / recent.length;
  ...
}
```

### Phase 8: Include order_id in response (M1)

**Return full idempotency marker**
```typescript
// buyer-purchase-history.use-cases.ts
export interface RecordCompletedPurchaseResponse {
  recorded: true;
  idempotent: boolean;
  order_id: string; // NEW
  orders_count: number;
}

async execute(input: PurchaseRecord): Promise<RecordCompletedPurchaseResponse> {
  const result = await this.repository.recordPurchase(input);
  if (!result.idempotent) {
    await this.metering?.record({...});
  }
  return {
    recorded: true,
    idempotent: result.idempotent,
    order_id: input.orderId,
    orders_count: result.history.stats().ordersCount
  };
}
```

### Phase 9: Distinguish first-time lookup (M2)

**Separate metering for known vs. unknown**
```typescript
// buyer-purchase-history.use-cases.ts
async execute(input: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryContext> {
  const history = await this.repository.getByBuyer(input);
  if (history) {
    const context = history.toSafeContext();
    await this.recordContextUsed(input, context.purchase_history.orders_count, true);
    return context;
  }

  // First time: synthesize empty context
  const context: BuyerPurchaseHistoryContext = {
    ...,
    purchase_history: {
      known_buyer: false,
      orders_count: 0,
      ...
    }
  };

  // Only meter as usage if explicitly enabled for first-time lookups
  const meterFirstTime = process.env.METER_FIRST_TIME_LOOKUPS === 'true';
  if (meterFirstTime) {
    await this.recordContextUsed(input, 0, false);
  }
  return context;
}
```

### Phase 10: Add identity linking endpoint (M3)

**Allow buyer to link identities**
```typescript
// buyer-purchase-history.controller.ts (new endpoint)
@Post('link-identity')
async linkIdentity(
  @Req() request: { user?: unknown },
  @Body() body: { from_identity: PurchaseHistoryIdentity; to_identity: PurchaseHistoryIdentity }
) {
  const user = currentUser(request);
  // Validate both identities are in this merchant
  // Merge purchase histories
  // Update buyer profile
  return { linked: true };
}
```

---

## SOLID Principles

| Principle | Current | Proposed |
|-----------|---------|----------|
| **SRP** | Entity computes stats + caches + validates. | Extract StatsComputer & CacheStrategy. |
| **OCP** | Identity is PurchaseHistoryIdentity; no extension point. | Define strategy pattern for identity resolution. |
| **LSP** | RecordCompletedPurchaseUseCase & GetBuyerPurchaseContextUseCase both depend on repository. | Ensure repository contract is consistent. |
| **ISP** | BuyerPurchaseHistoryRepository has 3 methods. | Consider splitting queries vs. commands. |
| **DIP** | Controller injects GetBuyerPurchaseContextUseCase. | Already using use-case layer ✓. |

---

## Object Calisthenics

| Rule | Current | Proposed |
|------|---------|----------|
| 1: One level of indentation | topKeys() & discountSensitivity() have 3 levels. | Extract helper functions. |
| 2: Don't use `else` | Uses ternary; OK. | — |
| 3: Wrap primitives | ordersCount: number, lifetimeValue: number. | Wrap: `class OrderCount(value: number)`. |
| 4: One dot per line | purchase.completedAt.localeCompare(...) (1 dot). | OK. |
| 5: Don't abbreviate | LTV = lifetimeValue (acceptable). | — |
| 6: Keep collections small | Stats arrays are small (top 5 SKUs, etc.). | ✓ |
| 7: No getters/setters | Entity uses .snapshot(); OK. | ✓ |
| 8: No classes with 2+ responsibilities | Entity does lifecycle + stats. | Extract StatsComputer. |
| 9: No getters for internal state | Not violated. | — |

---

## Summary

**Refactor Strategy:**
1. Fix identity contract: XOR (globalUserId OR merchantCustomerId) (C4).
2. Validate buyer-merchant association at controller (C2).
3. Warn if metering is missing (C3).
4. Paginate purchase loading; use recent window (H1, H4).
5. Cache stats; invalidate on write (H2).
6. Validate purchase schema; skip malformed (H3).
7. Include order_id in response (M1).
8. Distinguish first-time lookups in metering (M2).
9. Add identity linking endpoint (M3).
10. Result: clear identity semantics, efficient stats, secure buyer lookup, flexible metering, full audit trail.

**Estimated Effort:** 3–4 days (includes buyer linking UI).
