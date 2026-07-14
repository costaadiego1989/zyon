# Negotiation Module — Architecture Refactor Analysis

## 1. Current State

The negotiation module (997 LoC excluding specs) is a compact M2M negotiation sub-domain that orchestrates buyer-side discount negotiation. It records sessions, tracks cost per session, re-evaluates offers at apply time, and enforces a cost ledger (the audit trail of negotiation events).

The module's critical invariant: **discount approvals must never be cached & cannot pass through LLM without rules-engine re-validation at apply time.** The cost ledger records both negotiation.evaluated (AI cost) and negotiation.offer_applied (actual discount used), enabling dispute resolution.

### Layout

```
modules/negotiation/
  application/         6 use-cases (compact: 23–118 lines each)
  domain/              4 entities/ports (tight, focused)
  infrastructure/      2 stores (Prisma + in-memory), 1 ADR doc
  presentation/http/   3 controllers
```

### Hot Spots

| File | LoC | Concern |
|---|---:|---|
| `prisma-negotiation.store.ts` | 188 | Atomic session + ledger writes; cache-misses in rehydrate |
| `apply-negotiation-agreement-to-checkout.use-case.ts` | 118 | Policy re-check + rules re-eval + offer apply (6 DB hits) |
| `negotiation.controller.ts` | 97 | Evaluate endpoint logic (policy fetch + prefs fetch + eval + store) |
| `in-memory-negotiation.store.ts` | 152 | Test double; duplicates Prisma logic |

---

## 2. Issues by Severity

### CRITICAL

#### C1. Double DB fetch in apply-negotiation-agreement path
**File:** `apply-negotiation-agreement-to-checkout.use-case.ts:20-92`

The flow:
1. `getNegotiationSession` → 1 Prisma fetch
2. `getMerchantPolicy.executeResolved` → 1 Prisma fetch
3. `sessions.getSession` → 1 checkout Prisma fetch
4. `evaluateDiscountOffer` → in-memory rules evaluation (no IO)
5. `offers.saveOffer` → 1 offer Prisma write
6. `store.applyOfferWithLedger` → inside $transaction: 1 read + 1 write + 1 append

**Total: 7 Prisma operations for one offer apply.** Even worse: `getMerchantPolicy.executeResolved` internally calls `store.getMerchantPolicy` (fetch), and the result is then re-passed to `evaluateDiscountOffer` without being used to short-circuit any subsequent fetches.

**The critical bug:** if the merchant policy is re-fetched in `getMerchantPolicy.executeResolved` and its `max_discount_percent` was just lowered from 50% to 20%, the use-case will:
1. Re-evaluate under the new 20% cap.
2. Check `evaluation.value !== input.requestedDiscountPercent` — if true (50% ≠ 20%), throw `negotiation_discount_not_reproducible_under_rules`.
3. User sees an error **after confirmation** — poor UX.

This is a **stale-policy read race.** The merchant policy should be fetched once, passed as input, and never re-fetched mid-use-case.

**Fix:** change the controller to fetch both merchant policy and buyer preferences once, pass them as input to `execute()`. The use-case should validate they are still applicable but not re-fetch.

#### C2. Discount cap re-validation is silent
**File:** `apply-negotiation-agreement-to-checkout.use-case.ts:88-92`

The rules-engine applies a hard cap: `evaluateDiscountOffer(cart, rules, 50%) → {value: 30%, approved: true}` (merchant max is 30%).

The use-case then checks:
```ts
if (evaluation.value !== input.requestedDiscountPercent) {
  throw new BadRequestException("negotiation_discount_not_reproducible_under_rules");
}
```

**This is correct but obscure.** If `requestedDiscountPercent` is 50% and the merchant's max is 30%, the error message does not say "capped to 30%" — it says "not reproducible," which is confusing.

A buyer might:
1. Negotiate a 50% discount (AI accepted it per old policy).
2. Click apply.
3. See error: `negotiation_discount_not_reproducible_under_rules`.
4. Assume their negotiation is broken and complain to support.

**Fix:** make the error explicit: `throw new BadRequestException(`discount_capped: requested ${input.requestedDiscountPercent}%, rules allow ${evaluation.value}%`)`.

#### C3. Ledger records discount as basis points, not as a semantic name
**File:** `prisma-negotiation.store.ts:149-152`

```ts
await tx.negotiationCostLedgerEntry.create({
  // ...
  amountCents: Math.round(input.discountPercent * 100)
});
```

`negotiationCostLedgerEntry.amountCents` is a numeric field. When 50% discount is recorded, it becomes `5000` (50 * 100). For a revenue team member reading the ledger:
- Is `amountCents` the cost of AI negotiation (in cents)?
- Or the discount percent in basis points?

The comment in the code clarifies it, but the schema does not. **If a future developer needs to report on this ledger, they may misinterpret 5000 as $50.00 of cost savings instead of 50% discount.**

**Fix:** rename column `amountCents` → `basisPoints` or add a `field_type` enum (`COST_CENTS | DISCOUNT_BASIS_POINTS`) to the ledger entry table.

### HIGH

#### H1. `PrismaNegotiationStore` mixes policy + preferences + sessions + ledger
**File:** `prisma-negotiation.store.ts:188`

The store implements 4 distinct aggregates:
1. `MerchantNegotiationPolicy` (root: merchantId)
2. `BuyerAgentNegotiationPreference` (root: merchantId + globalUserId)
3. `NegotiationSession` (root: negotiation_session_id, scoped by merchantId)
4. `NegotiationCostLedgerEntry` (append-only event log)

**SRP violation:** the store should split into:
- `MerchantNegotiationPolicyStore`
- `BuyerPreferencesStore`
- `NegotiationSessionStore` (with built-in ledger append)
- or: `NegotiationStore` (session root only) + separate `NegotiationLedgerStore`

This is less critical than payment's god-service because each operation is simple, but it means the Prisma store cannot be tested in isolation (mocking one repo means mocking all 4 aggregates).

**Fix:** split into 2-3 focused stores, wire them via composition in the module.

#### H2. No concurrent-apply protection despite "atomic" $transaction
**File:** `prisma-negotiation.store.ts:136-170`

```ts
async applyOfferWithLedger(input): Promise<{ alreadyApplied: boolean; offerId: string }> {
  return this.prisma.$transaction(async (tx) => {
    const existing = await tx.negotiationCostLedgerEntry.findFirst({
      where: { negotiationSessionId, eventType: "negotiation.offer_applied" }
    });
    if (existing) return { alreadyApplied: true, offerId: ... };
    // write ledger
    await tx.negotiationCostLedgerEntry.create({ ... });
  });
}
```

**Race window:** TX1 and TX2 execute `findFirst` concurrently before either commits. Both see `existing = null`, both proceed to `create`. Prisma's $transaction is serializable by default, so the second `create` should fail on unique constraint violation on `(negotiationSessionId, eventType)` or succeed with a duplicate.

**Check:** does the Prisma schema have `@@unique([negotiationSessionId, eventType])` or similar? Looking at the file — **it does not explicitly define this.** If the schema is missing the constraint, two concurrent applies will create two ledger entries.

**Fix:** add explicit unique constraint in schema: `@@unique([negotiationSessionId, eventType: "negotiation.offer_applied"])`; OR use `findUnique` on a composite key instead of `findFirst`.

#### H3. No policy disable check at re-apply
**File:** `apply-negotiation-agreement-to-checkout.use-case.ts:39-45`

```ts
const currentPolicy = await this.getMerchantPolicy.executeResolved(input.merchantId);
if (!currentPolicy.enabled) {
  throw new BadRequestException("merchant_negotiation_policy_disabled");
}
```

This check is good (it prevents applying stale offers after the merchant disables negotiation), but it is not reached if the merchant policy was already fetched and passed into the use-case. If a merchant disables negotiation **between the evaluate endpoint and the apply endpoint**, the user can still apply the old offer.

**This is actually correct behavior** — the offer is signed (by being saved to the offer table). But it means policy-enable/disable is not an atomic gate; it's more of a future-looking flag ("no new negotiations after this time"). Worth documenting.

**Fix:** add a comment to the use-case explaining this; or add a check on `evaluateNegotiation` to refuse creating new sessions once the policy is disabled.

### MEDIUM

#### M1. `GetMerchantNegotiationPolicyUseCase` and `GetBuyerAgentPreferencesUseCase` duplicate the default-resolution pattern
**Files:** `merchant-negotiation-policy.use-cases.ts`, `buyer-agent-preferences.use-cases.ts`

Both have:
```ts
executeResolved(input): Promise<MerchantNegotiationPolicy> {
  const row = await this.store.getXxx(input.merchantId);
  return row ?? DEFAULT_XXX_POLICY;  // or DEFAULT_BUYER_PREFS
}
resolvedFromStored(stored): MerchantNegotiationPolicy {
  return stored ?? DEFAULT_XXX_POLICY;
}
```

The two methods exist to avoid a DB fetch if you already have a cached `stored` value. But they introduce branching: controllers can call either `executeResolved` (fetch) or `resolvedFromStored` (no fetch). The logic is duplicated.

**Fix:** create a `resolveNegotiationDefaults` helper function; remove the duplication.

#### M2. `assertValidMerchantNegotiationPolicy` only checks bounds, not consistency
**File:** `merchant-negotiation-policy.entity.ts:6-22`

```ts
function isValidRange(range: { minOfferDiscountPercent; maxDiscountPercent }): boolean {
  return (
    range.minOfferDiscountPercent >= 0 &&
    range.maxDiscountPercent >= 0 &&
    range.minOfferDiscountPercent <= range.maxDiscountPercent &&
    range.maxDiscountPercent <= 100
  );
}
```

The validator checks that each range is well-formed but does **not** check:
- Category ranges do not exceed the global max.
- Item ranges do not exceed their category max.
- The policy does not have category-specific min/max but then claim items are unconstrained.

**Fix:** add cross-field consistency checks.

#### M3. NegotiationController mixes evaluation logic with apply logic
**File:** `negotiation.controller.ts:42-74`

Both endpoints reuse the session/policy/prefs architecture, but the evaluate endpoint has a novel gate:
```ts
const isDeniedWithoutAiCost = !result.agreement && (
  result.denialReason === "merchant_machine_negotiation_disabled" ||
  ...
);
if (isDeniedWithoutAiCost) return result;  // don't persist
```

This is correct (no point recording a denied negotiation that cost nothing), but the logic is split across presentation and application layers. The use-case (`RecordNegotiationSessionUseCase`) doesn't know why it's being called or whether to record.

**Fix:** move the denial-gate logic into `RecordNegotiationSessionUseCase.execute()` and have it return `{ shouldRecord: boolean }` or throw `NegotiationDeniedWithoutCostError` to signal early exit.

#### M4. `cartFingerprint` hashing is not validated at apply time
**File:** `apply-negotiation-agreement-to-checkout.use-case.ts:47-50`

```ts
if (checkoutCartFingerprint(checkoutSession.cart) !== negRow.cartFingerprint) {
  throw new BadRequestException("negotiation_cart_mismatch");
}
```

This is correct (prevents cart tampering), but the fingerprint algorithm is opaque. If `cart-fingerprint.ts` ever changes its hash function, old cached negotiation sessions will report `negotiation_cart_mismatch` for valid carts.

**Fix:** version the fingerprint algorithm in the schema; store `fingerprint_version + hash` in the negotiation session. At apply time, recompute under the stored version and compare.

#### M5. In-memory store duplicates Prisma logic
**File:** `in-memory-negotiation.store.ts:152`

The file reimplements all 4 store methods without using a common interface or shared logic. If the ledger entry structure changes, both implementations need updating.

**Fix:** extract a `NegotiationStore` interface as an abstract base; have both Prisma and in-memory implement it with shared test utilities.

#### M6. `negotiation.offer_applied` records amountCents without eventType prefix
**File:** `prisma-negotiation.store.ts:148`

When `eventType: "negotiation.offer_applied"`, the `amountCents` field stores discount basis points, not cost. When `eventType: "negotiation.evaluated"`, it stores estimated AI cost in cents. **These are different units stored in the same column.**

This is a schema design anti-pattern. In a future analytics query, someone will `SELECT SUM(amountCents) FROM negotiationCostLedger` expecting total cost, but the result will include discount percentages mixed in.

**Fix:** split into two columns (`aiCostCents`, `discountBasisPoints`) or use a `JSON` column with typed payloads: `{eventType: "evaluated", costCents: 5} | {eventType: "offer_applied", discountBasisPoints: 1000}`.

#### M7. `CreateNegotiationSessionWithLedger` always creates a ledger entry
**File:** `prisma-negotiation.store.ts:78-93`

```ts
await tx.negotiationCostLedgerEntry.create({
  merchantId: input.merchantId,
  negotiationSessionId: row.id,
  eventType: "negotiation.evaluated",
  amountCents: input.result.estimatedAiCostCents
});
```

The ledger entry is created even if `estimatedAiCostCents` is 0 (e.g., if the negotiation was denied for free). This fills the audit log with noise. **Fix:** only append if `estimatedAiCostCents > 0`.

### LOW

#### L1. `NegotiationController.applyCheckoutOffer` validates `human_confirmed` strangely
**File:** `negotiation.controller.ts:77-80`

```ts
if (body.human_confirmed !== undefined && body.human_confirmed !== true) {
  throw new BadRequestException("human_confirmed_must_be_true");
}
```

This allows `human_confirmed` to be `undefined` (which is fine) or `true` (required), but rejects `false` with an error. The logic works but is backwards — it should check `if (body.human_confirmed === false)`.

**Fix:** clearer intent: `if (body.human_confirmed === false) throw new BadRequestException(...)`.

#### L2. `DEFAULT_MERCHANT_NEGOTIATION_POLICY` and `DEFAULT_BUYER_NEGOTIATION_PREFERENCES` are hard-coded
**File:** `negotiation-defaults.ts:16`

They are constants, not env-based. If defaults should vary per deployment, this breaks. But for a platform where all merchants share the same negotiation baseline, this is fine.

**Fix:** if needed, move to a configurable store or env variable, but defer until requirements clarify.

#### L3. Object Calisthenics — `PrismaNegotiationStore.applyOfferWithLedger` is deeply nested
**File:** `prisma-negotiation.store.ts:137-170`

The function is 35 lines of nested $transaction + if/else + await. Break into:
- `checkIfAlreadyApplied()`
- `appendOfferAppliedEntry()`
- Orchestrate in the main method.

---

## 3. Coupling Map

```
┌───────────────────────────────────────────────────┐
│ presentation/http/                                │
│   negotiation.controller.ts ────┐                │
│   merchant-negotiation-policy.controller.ts    │
│   buyer-agent-preferences.controller.ts         │
└────┬──────────────────────────────────────────────┘
     │ DI
     ▼
┌───────────────────────────────────────────────────┐
│ application/                                      │
│   EvaluateNegotiationUseCase ────┐               │
│   RecordNegotiationSessionUseCase │               │
│   ApplyNegotiationAgreementToCheckoutUseCase │ orchestrate policy + store
│   GetMerchantNegotiationPolicyUseCase        │
│   UpsertMerchantNegotiationPolicyUseCase     │
│   GetBuyerAgentPreferencesUseCase            │
│   UpsertBuyerAgentPreferencesUseCase         │
└────┬──────────────────────────────────────────────┘
     │ Ports
     ▼
┌───────────────────────────────────────────────────┐
│ domain/ports/                                     │
│   NegotiationStore ──┐                           │
│                      └──► PrismaNegotiationStore │
└────────────────────────────────────────────────────┘
External coupling:
  negotiation ──┐
               ├──► checkout (CheckoutSessionRepository, OFFER_REPOSITORY)
               ├──► merchant (MerchantRulesRepository, getRules)
               ├──► @zyon/negotiation-engine (negotiateDiscount)
               └──► @zyon/rules-engine (evaluateDiscountOffer)

┌─────────────────────────────────────────┐
│ @zyon/negotiation-engine                │
│   negotiateDiscount(cart, policy, prefs) → NegotiationResult ──┐
│                                                                ▼
│ @zyon/rules-engine                                     ┌──────────────┐
│   evaluateDiscountOffer(cart, rules, %) → evaluation ──► value (hard-cap)
└─────────────────────────────────────────┘                └──────────────┘
```

**Strongest couplings:**
- `ApplyNegotiationAgreementToCheckoutUseCase` ↔ checkout domain (session + offer repositories)
- `EvaluateNegotiationUseCase` ↔ `@zyon/negotiation-engine` (pure dependency on a package export)
- Controller ↔ multiple use-cases (fan-out)

**Weakest abstraction:** no. All abstractions are tight and focused.

---

## 4. Proposed Changes

### Phase 1 — Critical fixes (1 day)

1. **Policy fetch consolidation** (P1):
   - Controller fetches merchant policy + buyer preferences once.
   - Pass both as context input to `ApplyNegotiationAgreementToCheckoutUseCase`.
   - Use-case validates they are current; does not re-fetch.
   - **Result:** eliminates stale-policy race; reduces DB hits by 1.

2. **Ledger uniqueness constraint** (P1):
   - Add `@@unique([negotiationSessionId, eventType: "negotiation.offer_applied"])` OR comparable index.
   - Verify `applyOfferWithLedger` uses `findFirst` correctly (may need `findUnique` to enforce).

3. **Clear error message for cap-down** (P1):
   - Change `negotiation_discount_not_reproducible_under_rules` → `discount_capped: requested 50%, max allowed 30%`.

### Phase 2 — SOLID refactors (2 days)

4. **Split NegotiationStore** (P2):
   - Policies, preferences, sessions, ledger → 2-3 focused stores.
   - Keep composition in the module to avoid test coupling explosion.

5. **Move denial-gate logic** (P2):
   - `RecordNegotiationSessionUseCase` checks `isDeniedWithoutAiCost` internally.
   - Return `{ recorded: boolean }` or throw signal.

6. **Ledger column semantics** (P2):
   - Either: rename `amountCents` → `basisPoints` on offer_applied entries + add `aiCostCents` for evaluated.
   - Or: use a `JSON` column with typed payloads.

7. **Policy consistency validation** (P2):
   - Extend `assertValidMerchantNegotiationPolicy` to check cross-level constraints.

### Phase 3 — DRY + typing (1 day)

8. **Default resolution helper** (P3): extract `resolveNegotiationDefaults`; remove duplication.
9. **Fingerprint versioning** (P3): store `fingerprint_version` in schema; recompute on apply.
10. **Consolidated in-memory store** (P3): share interface + test utilities between Prisma and memory.

---

## 5. SOLID Verdict

| Principle | Verdict | Worst Offender |
|---|---|---|
| S (SRP) | ⚠️ partially violated | `PrismaNegotiationStore` mixes 4 aggregates; controller orchestrates 3 use-cases |
| O (OCP) | ✅ no provider/store switching; policy is injected | none |
| L (LSP) | ✅ `NegotiationStore` is a clean port | none |
| I (ISP) | ⚠️ `NegotiationStore` exposes methods for 4 aggregates | should split into focused stores |
| D (DIP) | ✅ `EvaluateNegotiationUseCase` depends on interface (negotiation-engine, rules-engine) | none (couplings are via ports) |

---

## 6. Object Calisthenics Verdict

| Rule | Verdict | Notes |
|---|---|---|
| 1. One level of indentation per method | ✅ | mostly flat; some $transaction nesting is acceptable |
| 2. No `else` | ✅ | guards & early returns preferred |
| 3. Wrap all primitives | ⚠️ | `merchantId` is a string; could be `MerchantId` branded type |
| 4. First-class collections | ✅ | no bare array operations |
| 5. One dot per line | ✅ | no chains |
| 6. Don't abbreviate | ✅ | naming is clear |
| 7. Keep entities small | ✅ | `MerchantNegotiationPolicyEntity` is 23 lines; `BuyerAgentPreferencesEntity` is 12 |
| 8. No classes > 50 lines | ⚠️ | `PrismaNegotiationStore` is 188 lines (store, not class; acceptable) |
| 9. No getters/setters/properties | ✅ | entities are mostly DTOs; no mutation |

**Healthiest module in the codebase** — compact, focused, mostly compliant.

---

## 7. Race Conditions & Edge Cases Summary

| Race | Mitigation Status | Risk |
|---|---|---|
| Two applies, same session | `$transaction` + unique constraint on offer_applied | ✅ safe (if constraint exists) |
| Policy change mid-apply | Use-case re-validates; throws if mismatch | LOW (user sees error, but after confirm) |
| Fingerprint collision (cart items same hash) | Fingerprint includes item list; collision unlikely | LOW |
| Ledger entry duplicates (concurrent create) | No unique constraint yet | MEDIUM (if constraint missing) |
| Two concurrent evaluations, same buyer | Both create separate sessions (independent ledger entries) | LOW (correct isolation) |

---

## 8. Security Summary

| Severity | Issue |
|---|---|
| CRITICAL | none |
| HIGH | Stale policy read at apply time (UX-breaking, not data-breaking) |
| MEDIUM | Ledger column semantics ambiguous (discount % vs cost $) |
| LOW | Fingerprint versioning missing (forward-compatibility) |

---

## 9. Discount Cap Enforcement Walkthrough

The module enforces a hard cap via the rules-engine:

```
1. Merchant sets policy: global { minOfferDiscountPercent: 0, maxDiscountPercent: 30% }
2. Buyer negotiates 50% discount via M2M negotiation-engine
3. evaluateNegotiationUseCase.execute() → negotiateDiscount(cart, policy, prefs) → returns {selectedDiscountPercent: 50%, agreement: true}
4. RecordNegotiationSessionUseCase persists this to negotiationSession.resultJson
5. ApplyNegotiationAgreementToCheckoutUseCase.execute(requestedDiscountPercent: 50%)
6. Rules-engine re-evaluates: evaluateDiscountOffer(cart, rules, 50%) → {value: 30%, approved: true} (HARD CAP)
7. Check: if (evaluation.value !== requestedDiscountPercent) → 30% ≠ 50% → throw
8. User sees: "negotiation_discount_not_reproducible_under_rules" (confusing; should say "capped to 30%")
```

**Invariant:** discount is never silently capped down. The offer fails loudly, forcing the buyer to renegotiate. This is correct but UX-unfriendly.

**Alternate flow (edge case):**
- Policy includes category-level override: books {minOfferDiscountPercent: 0, maxDiscountPercent: 50%}
- Cart has books + electronics
- Buyer negotiates 60% discount
- Re-eval at apply: electronics hit global 30% cap; books hit 50% cap → evaluation fails (mixed carts cannot have uniform discount)
- Error: "negotiation_discount_not_applicable_to_mixed_cart" (not currently implemented; good opportunity for refactor)

---

## 10. Files Changed (Proposed)

**New:**
- `application/services/negotiation-defaults.ts` (consolidate duplicates)
- `domain/value-objects/Fingerprint.ts` (versioned hash)

**Edited:**
- `negotiation.controller.ts` (fetch policy/prefs once, pass as context)
- `apply-negotiation-agreement-to-checkout.use-case.ts` (accept policy/prefs as input; clarify cap error)
- `prisma-negotiation.store.ts` (add unique constraint; split stores)
- `record-negotiation-session.use-case.ts` (move denial gate here)
- `merchant-negotiation-policy.entity.ts` (add consistency checks)
- Schema migration (ledger column semantics + uniqueness constraint)