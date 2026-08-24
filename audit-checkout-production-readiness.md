# Checkout Module — Production Readiness Audit

**Audit Date:** 2026-08-24  
**Scope:** `apps/api/src/modules/checkout` — HTTP layer, use-cases, domain, repositories  
**Status:** **NOT PRODUCTION READY** — Critical concurrency, safety, and data integrity issues  

---

## Executive Summary

The checkout module has **7 critical findings** that prevent production release:

1. **No concurrency control** on session updates → race conditions on chat & offers
2. **No state machine enforcement** at persistence layer → offer applied after payment
3. **LLM tool output not safety-gated** → injection risks
4. **No HTTP parameter validation** on merchant_id → tenant isolation relies only on repository scoping
5. **Offers racing with payment** → concurrent modification of session state
6. **Incomplete transaction boundaries** → order/event atomicity gaps
7. **Missing idempotency keys** → double-apply on retry

---

## 1. CONCURRENCY & RACE CONDITIONS

### R2P-001: No Concurrency Control on Session Updates
**Severity:** P1  
**Type:** Race Condition / Data Integrity  
**Files:** 
- `application/use-cases/accept-checkout-offer.use-case.ts` (lines 38–40)
- `infrastructure/prisma/prisma-checkout.repository.ts` (saveSession)

**Finding:**
```typescript
// accept-checkout-offer.use-case.ts:38-40
await this.offers.saveAcceptedOffer(acceptedOffer);
await this.sessions.recordEvent(input.merchant_id, input.session_id, "offer_accepted");
const updated = await this.sessions.getSession(...);  // ← Race window
```

- **getSession** → **recordEvent** → **getSession** has no locks
- Two concurrent chat messages (or chat + payment) can modify `session.chatHistory[]` simultaneously
- Prisma `upsert` with no version field → last write wins, losing concurrent updates
- **Example:** 
  - T1: Chat message A reads session v1
  - T2: Chat message B reads session v1  
  - T1: Appends turn to chatHistory, saves v1+1
  - T2: Appends turn to chatHistory, saves v1+1 (overwrites T1's turn)

**Why it matters:**
- Chat history corruption (lost user objections, agent responses)
- Offers applied in wrong sequence
- State inconsistency between cache/DB

**Recommended fix:**
- Add `version: Int` to CheckoutSession schema
- Implement optimistic locking: `WHERE version = expectedVersion`
- Fail fast if version mismatch, return `409 Conflict`
- Retry at HTTP layer with backoff

---

### R2P-002: No State Machine Enforcement at Persistence Layer
**Severity:** P1  
**Type:** State Machine / Business Logic Enforcement  
**Files:**
- `domain/entities/checkout-session.entity.ts` (incomplete state tracking)
- `application/use-cases/apply-offer.use-case.ts` (no payment state check)
- `application/use-cases/complete-order.use-case.ts` (no state transition guard)

**Finding:**
```typescript
// apply-offer.use-case.ts:36
const applied = await this.commerce.apply(offer);
if (!applied.success) return { ...applied };
await this.acceptCheckoutOffer.execute(input);  // ← No check: is session.paymentStatus === PAID?
```

- CheckoutSession has no `status` or `paymentStatus` field
- No guard preventing offer application after `PAYMENT_RECEIVED` event
- Offer can be proposed/accepted **after** payment gateway confirmed payment
- **Race scenario:**
  - Payment webhook arrives → `paymentStatus = RECEIVED` 
  - Chat agent still running → proposes discount
  - Both attempt to modify session concurrently (see R2P-001)

**Why it matters:**
- LLM can propose discount/refund **after funds already captured**
- Violation of critical invariant: "Discounts approved only by rules-engine" (and must be pre-payment)
- Merchant liability for double-refunds, chargebacks

**Recommended fix:**
- Add `status: "INITIATED" | "PAYMENT_IN_PROGRESS" | "PAYMENT_RECEIVED" | "COMPLETED" | "ABANDONED"`
- Guard in `apply-offer.use-case`: `if (session.status !== "INITIATED") throw "InvalidStateTransition"`
- Enforce transition rules at domain layer: only `INITIATED` → `PAYMENT_IN_PROGRESS` → `PAYMENT_RECEIVED` → `COMPLETED`
- Update status atomically with payment confirmation

---

### R2P-006: Offers Racing with Payment
**Severity:** P2  
**Type:** Race Condition / Business Logic  
**Files:**
- `application/use-cases/apply-offer.use-case.ts` (no mutual exclusion with complete-order)
- `application/use-cases/complete-order.use-case.ts` (no session state machine check)

**Finding:**
```typescript
// apply-offer.use-case.ts:32–38
const acceptedOffer = AcceptedOfferEntity.accept(...).snapshot();
await this.offers.saveAcceptedOffer(acceptedOffer);
await this.sessions.recordEvent(input.merchant_id, input.session_id, "offer_accepted");
const updated = await this.sessions.getSession(...);

// complete-order.use-case.ts:33–40
const session = await this.sessions.getSession(...);
if (this.offerRepository) {
  const acceptedOffer = await this.offerRepository.getAcceptedOffer(...);  // ← Race: offer may be accepted after read
  if (!acceptedOffer) throw new BadRequestException(...);
}
```

- Both use-cases call `getSession()` independently
- No serialization point: offer acceptance and payment can race
- Session state diverges between in-flight requests

**Why it matters:**
- Order total mismatch: offer accepted after order total already recomputed
- Accepted offer lost in session state if payment reads session before accept-offer writes

**Recommended fix:**
- Use `TransactionRunner` for both offer-acceptance and order-completion
- Serialize within DB transaction: SELECT session FOR UPDATE
- Validate offer acceptance within same transaction as order creation

---

## 2. SECURITY & TENANT ISOLATION

### R2P-005: No HTTP Parameter Validation on merchant_id
**Severity:** P1  
**Type:** Tenant Isolation / Authorization  
**Files:**
- `presentation/http/checkout.controller.ts` (lines 72–75, 118–149)

**Finding:**
```typescript
@Get("checkout/:merchantId/:sessionId")
session(@Param("merchantId") merchantId: string, @Param("sessionId") sessionId: string) {
  return this.getCheckoutSession.execute(merchantId, sessionId);  // ← No guard
}

@Get("dashboard/overview/:merchantId")
overview(@Param("merchantId") merchantId: string) {
  return this.getDashboardOverview.execute(merchantId);  // ← No guard
}
```

- `@Param("merchantId")` extracted without validation
- No guard verifying: `req.user.merchantId === merchantId` (or auth token allows access)
- **Only** defense is repository-level scoping (see cross-tenant tests FUZZ-001)
- If **any** repository query forgets `WHERE merchantId = input`, data leaks

**Why it matters:**
- Tenant isolation relies on **defense-in-depth**: HTTP guard + repo scoping
- Current code has only repo scoping = **single point of failure**
- Attacker calls `/checkout/competitors-merchant-id/session-id` → gets competitor's session

**Recommended fix:**
```typescript
@Get("checkout/:merchantId/:sessionId")
@UseGuards(AuthGuard, MerchantIdGuard)  // ← Add guard
session(@Param("merchantId") merchantId: string, @Param("sessionId") sessionId: string) {
  return this.getCheckoutSession.execute(merchantId, sessionId);
}
```

Create `MerchantIdGuard`:
```typescript
canActivate(context: ExecutionContext): boolean {
  const { merchantId } = context.switchToHttp().getRequest().params;
  const userMerchantId = context.switchToHttp().getRequest().user?.merchantId;
  if (merchantId !== userMerchantId) throw new ForbiddenException("Tenant boundary violation");
  return true;
}
```

---

### R2P-004: isSafeGeneratedMessage Not Called on LLM Tool Output
**Severity:** P1  
**Type:** LLM Injection / Output Validation  
**Files:**
- `application/use-cases/send-chat-message.use-case.ts` (lines ~145–180)

**Finding:**
```typescript
// send-chat-message.use-case.ts (paraphrased)
let llmReply = await this.executeTools(stage, missingFields, ...);  // ← LLM executes tools

const safetyCheck = isSafeGeneratedMessage(reply.message);
const safeMessage = safetyCheck.safe ? reply.message : "Como posso ajudar com o seu pedido?";
```

- **Tool execution happens BEFORE safety check**
- Tool results (e.g., cross-sell product suggestions, discount reasoning) are not validated before returning
- If LLM returns `suggested_skus: ["<script>alert(1)</script>", ...]`, no sanitization on tool output itself
- **Invariant violated:** "Always validate generated messages with isSafeGeneratedMessage"

**Why it matters:**
- XSS if frontend renders LLM suggestions without escaping
- Prompt injection: tool output can be used to influence subsequent LLM calls
- Violates critical safety invariant

**Recommended fix:**
```typescript
const reply = await this.conversationEngine.reply(...);

// VALIDATE BEFORE USE
const safetyCheck = isSafeGeneratedMessage(reply.message);
if (!safetyCheck.safe) {
  return { message: "Como posso ajudar?", suggested_skus: [] };
}

// VALIDATE TOOL RESULTS
if (reply.suggested_skus?.length) {
  const sanitized = reply.suggested_skus.filter(sku => /^[a-z0-9_-]{1,100}$/i.test(sku));
  reply.suggested_skus = sanitized;
}
```

---

## 3. DATA INTEGRITY & TRANSACTIONS

### R2P-007: Incomplete Transaction Boundaries on Order Completion
**Severity:** P2  
**Type:** Event Sourcing / Atomicity  
**Files:**
- `application/use-cases/complete-order.use-case.ts` (lines 49–80)

**Finding:**
```typescript
async execute(input: CompleteOrderRequest): Promise<CompleteOrderResponse> {
  const session = await this.sessions.getSession(...);
  
  // P1: Validate offer/total
  if (this.offerRepository) { ... }
  
  // ← No transaction start
  const order = CompletedOrderEntity.complete(input).snapshot();
  await repo.saveCompletedOrder(order);          // ← Write 1
  await repo.recordEvent(..., "order.completed"); // ← Write 2 (may fail)
  await this.outbox.appendOutbox(event);         // ← Write 3 (may fail)
  
  if (this.recordExperimentResult) {
    this.recordExperimentResult.execute(...);    // ← Fire-and-forget, not awaited
  }
}
```

- Three separate writes without transaction wrapper
- If **saveCompletedOrder** succeeds but **appendOutbox** fails → order created, no webhook event
- Payment confirmed in external system, but no downstream event to trigger fulfillment

**Why it matters:**
- Order orphaned: exists in DB, but fulfillment system never notified
- Merchant sees unshipped order, no visibility into what happened
- No automatic retry mechanism (if using fire-and-forget for experiments)

**Recommended fix:**
```typescript
if (this.txRunner?.transaction) {
  return this.txRunner.transaction(async (repo) => {
    const { order, idempotent } = await repo.saveCompletedOrder(order);
    if (!idempotent) {
      await repo.recordEvent(merchantId, sessionId, "order.completed");
      await repo.appendOutbox(event);
    }
    return { recorded: true, idempotent, event_type: "order.completed" };
  });
}
```

---

### R2P-003: Missing Idempotency Keys on Accept-Offer
**Severity:** P2  
**Type:** Idempotency / Retry Resilience  
**Files:**
- `application/use-cases/accept-checkout-offer.use-case.ts` (lines 29–38)

**Finding:**
```typescript
const existing = await this.offers.getAcceptedOffer(...);
if (existing) return existing;  // ← Idempotency check, but no key passed to DB write

await this.offers.saveAcceptedOffer(acceptedOffer);  // ← No idempotency_key field
```

- Use-case **detects** duplicates on read, but doesn't **enforce** idempotency at write
- If response lost (network failure) after `saveAcceptedOffer` succeeds:
  - Client retries same request
  - `getAcceptedOffer` finds nothing (time window between write and read)
  - Second `saveAcceptedOffer` succeeds → offer accepted twice

**Why it matters:**
- Double-discounts applied (merchant loss)
- Incorrect revenue reporting

**Recommended fix:**
```typescript
// Use client-provided idempotency key or generate deterministic one
const idempotencyKey = input.idempotency_key || 
  sha256(`${merchantId}:${sessionId}:${offerId}`);

const existing = await this.offers.getAcceptedOfferByKey(idempotencyKey);
if (existing) return existing;

const acceptedOffer = AcceptedOfferEntity.accept(...);
acceptedOffer.idempotencyKey = idempotencyKey;

await this.offers.saveAcceptedOffer(acceptedOffer);  // ← DB constraint: UNIQUE(idempotencyKey)
```

---

## 4. OBSERVABILITY & EVENTS

### Missing: Event Metadata & Correlation IDs
**Severity:** P2  
**Type:** Observability  
**Files:**
- `domain/events/checkout-domain-event.ts` (creates events without request context)
- Domain handlers don't log offer-acceptance or payment transitions

**Finding:**
- Events are created but missing trace context for debugging
- No structured logging on offer lifecycle
- Payment transitions not logged (critical for audits)

**Recommended fix:**
- Inject `CorrelationIdStorage` (already done in some places) consistently
- Log state transitions: "session.status: INITIATED → PAYMENT_IN_PROGRESS"
- Add telemetry on offer-to-payment race window

---

## 5. TESTS & COVERAGE

### Present (Good)
✓ Cross-tenant fuzz tests (1000 cross-tenant reads)  
✓ Unit tests on domain entities  
✓ E2E specs on critical flows  

### Gaps
✗ **No concurrency test**: Two concurrent `sendChatMessage` on same session  
✗ **No race test**: `apply-offer` + `complete-order` simultaneously  
✗ **No state machine test**: Offer applied after payment_received  
✗ **No tenant boundary test on HTTP**: `@Param` extraction without guard  
✗ **No LLM injection test**: Tool output with XSS payload  

---

## 6. DOMAIN INVARIANTS VERIFICATION

From `CLAUDE.md`:

| Invariant | Status | Evidence |
|-----------|--------|----------|
| "LLM never authorizes offers" | ✓ PASS | `checkout-offer.service.ts`: rules-engine is sole authority |
| "Discounts approved only by rules-engine" | ⚠ PARTIAL | Enforced in code, but no DB-level state machine → can accept offer post-payment |
| "Shipping subsidies approved only by shipping-engine" | ✓ PASS | `evaluate-shipping.use-case` gates all shipping offers |
| "evaluateDiscountOffer hard-caps maxDiscountPercent" | ✓ PASS | `clipToNegotiationPolicy` enforces max |
| "Always validate generated messages with isSafeGeneratedMessage" | ✗ FAIL | Tool results not validated (R2P-004) |
| "merchant_id is the tenant boundary" | ⚠ PARTIAL | Scoped at repo layer; no HTTP guard (R2P-005) |

---

## 7. DETAILED FILE INVENTORY

### Controllers
- `presentation/http/checkout.controller.ts` — 15 endpoints, no tenant guard

### Use-Cases
| File | LOC | Status |
|------|-----|--------|
| `accept-checkout-offer.use-case.ts` | 58 | P1 concurrency, P2 idempotency |
| `apply-offer.use-case.ts` | ~150 | P1 no state machine, P2 offer-payment race |
| `complete-order.use-case.ts` | ~250 | P2 incomplete transactions |
| `send-chat-message.use-case.ts` | ~350 | P1 tool output not safety-gated |
| `start-checkout.use-case.ts` | ~250 | Clean; proper initialization |

### Domain Layer
- `domain/entities/checkout-session.entity.ts` — No status field; immutable snapshots (good pattern)
- `domain/services/tenant-boundary.guard.ts` — Good: compile-time + runtime checks (but not used in HTTP)
- `domain/services/offer-factory.ts` — Proper offer generation with rule-scoping

### Infrastructure (Repositories)
- `prisma-checkout.repository.ts` — Uses `upsert`; no versioning or locking
- `in-memory-checkout.repository.ts` — Filters on merchantId (test double, correct pattern)

### Tests
- `presentation/http/checkout.cross-tenant-fuzz.prisma-e2e-spec.ts` — 1000 reads, asserts zero leaks
- `application/services/checkout-offer.service.spec.ts` — Validates discount caps
- `domain/entities/checkout-session.entity.spec.ts` — Snapshot pattern

---

## Remediation Timeline

### **P0 (Block Release)**
- [ ] **Add optimistic locking** on CheckoutSession (version field + WHERE clause)
- [ ] **Add state machine** (status enum) + guards in apply-offer, complete-order
- [ ] **Add @MerchantIdGuard** on all HTTP endpoints with `:merchantId` parameter
- [ ] **Validate LLM tool output** before returning; sanitize suggested_skus

### **P1 (Before Next Deployment)**
- [ ] **Add concurrency test**: Two concurrent sendChatMessage on same session
- [ ] **Add race test**: apply-offer + complete-order simultaneously
- [ ] **Instrument events** with correlation IDs + structured logging on state transitions

### **P2 (Future Hardening)**
- [ ] **Add idempotency keys** to accept-offer (db constraint + client key)
- [ ] **Transaction wrapper** on order completion
- [ ] **Comprehensive observability**: OpenTelemetry spans on checkout lifecycle

---

## Sign-Off

**NOT PRODUCTION READY**

Checkpoint: Fix **all P0 items** before merging to main. Re-run audit after fixes applied.

**Critical path:** 
1. Implement optimistic locking (4 hours)
2. Add state machine + guards (3 hours)
3. Add HTTP tenant guard (2 hours)
4. Validate LLM output (2 hours)
5. New tests (4 hours)
6. Regression testing (2 hours)

**Total: ~17 hours**
