# Payment Module — Architecture Refactor Analysis

## 1. Current State

The payment module (5,407 LoC excluding specs) is a multi-bounded-context module that mixes three sub-domains:

1. **Buyer payment intents** — create / confirm / reconcile a single buyer transaction.
2. **Provider platform connections** — merchant onboarding for Stripe Connect & Asaas subaccounts.
3. **SaaS billing** — merchant self-subscription checkout, portal, trial management.

Module surface (`payment.module.ts`, 195 lines) wires 16 controllers/use-cases and 6 infrastructure adapters. The intent flow is the highest-stakes surface; webhook idempotency and crypto settlement correctness are the dominant invariants.

### Layout

```
modules/payment/
  application/         8 use-cases (one is 515-line multi-class file)
  domain/              1 entity, 1 types file, 5 ports
  infrastructure/      19 files — adapters, env, cipher, repositories, providers
  presentation/http/   8 controllers (incl. 2 webhook controllers)
```

### Hot Spots

| File | LoC | Concern |
|---|---:|---|
| `payment-platform.use-cases.ts` | 515 | 10 use-cases bundled in one file |
| `handle-stripe-webhook.use-case.ts` | 351 | Signature, idempotency, dispatch, billing events |
| `create-payment-intent.use-case.ts` | 327 | Domain + commerce + Asaas customer + outbox |
| `prisma-payment-platform.repository.ts` | 279 | 8 repo methods + atomic ledger writes |
| `prisma-payment.repository.ts` | 284 | 10 methods + outbox integration |
| `handle-asaas-webhook.use-case.ts` | 289 | Same template as Stripe webhook |

---

## 2. Issues by Severity

### CRITICAL

#### C1. Webhook handler god-class (Stripe + Asaas)
**Files:** `handle-stripe-webhook.use-case.ts:351`, `handle-asaas-webhook.use-case.ts:289`

Both webhook use-cases conflate:
- signature/token verification
- provider-event idempotency gate
- intent lookup & state-machine dispatch
- commerce order marking
- checkout completion
- platform / billing event dispatch (Stripe only)

**Risk:** a single bug in any path blocks an entire provider. The intent-state-machine logic is duplicated across Stripe + Asaas paths with subtle drift (Stripe uses `pi.amount_received` while Asaas converts `payment.value*100`). Cross-provider invariants are unenforced (e.g., value-mismatch handling exists in both but uses different metrics labels and different failure side-effects).

**Fix:** extract `WebhookIdempotencyService` (provider-agnostic) + `PaymentDispatchService` (intent state-machine) + `BillingEventProjector` (subscription events). The intent state-machine itself (markApproved → record → completeAfterApproval → markCommerceOrderPaid) is identical between Stripe and Asaas; lift it into one service.

#### C2. Asymmetric tenant boundary enforcement
**File:** `prisma-payment.repository.ts:282-285` (`getIntentById`)

The port declares `merchantId` is mandatory for tenant scoping, but the implementation re-fetches by `id` only and re-checks `row.merchantId !== merchantId.trim()` in code. This is a classic read-without-scope SQL pattern that is correct but not atomic — between the row fetch and the comparison, a row update could change merchant_id (theoretically; not currently exposed but the pattern is fragile).

The Asaas webhook (`handle-asaas-webhook.use-case.ts:107`) actually uses `getIntentByExternalReference` which returns `{id, merchantId}` only — a careful design. But `getIntentById` then re-uses this `ref.merchantId` and trusts it as the scope, which is fine *only* because `getIntentByExternalReference` itself is scoped by unique `id`.

**Fix:** use Prisma `where: { id, merchantId }` directly; the post-read `if (row.merchantId !== merchantId.trim()) return null` should be a no-op because the query already filtered.

### HIGH

#### H1. Crypto settlement race window
**File:** `confirm-crypto-payment.use-case.ts:73-100`

The flow is:
1. `recordCryptoTransfer` → INSERT (returns false if collision).
2. `evmCryptoVerifier.verifyTransfer` → external RPC.
3. `markApproved` + `saveIntent`.
4. **Catch:** if (2) or (3) throws, `deleteCryptoTransfer` releases the reservation.

Race: between step 3 commit and step 4 in the catch block — but those are sequential. The real race is **two concurrent confirmations of the same txHash** arriving before step 1 commits on either. This is correctly blocked by the unique constraint on `(chain, txHash)` — confirmed safe.

**However:** the `verifyTransfer` call (RPC, 1-10s) holds the reservation. If the worker process is killed mid-RPC, the reservation is never released (no compensation outside the `try` block). The `deleteCryptoTransfer` on catch only runs on thrown errors. **Killed mid-RPC = permanent block** of that txHash for that intent.

**Fix:** add a background reaper for reservations older than N seconds without a corresponding approved intent; alternatively, mark reservations with a TTL column and rely on partial unique indexes (`WHERE approved = false`).

#### H2. `payment-platform.use-cases.ts` is 10 classes in one file (515 lines)
**File:** `payment-platform.use-cases.ts`

Files contain:
- `GetPaymentConnectionsUseCase` (8 lines)
- `CreateStripeConnectOnboardingLinkUseCase`
- `SyncStripeConnectUseCase`
- `CreateAsaasSubaccountUseCase`
- `GetAsaasOnboardingLinkUseCase`
- `SyncAsaasSubaccountUseCase`
- `GetBillingSubscriptionUseCase`
- `CreateBillingCheckoutUseCase`
- `CreateBillingPortalUseCase`
- `HandleStripePlatformEventUseCase`
- 4 module-level helpers

**SOLID:** severe SRP violation at file level. These are 3 distinct sub-domains (merchant onboarding, billing, platform events) — should be 3 files.

**Fix:** split into `stripe-connect.use-cases.ts`, `asaas-onboarding.use-cases.ts`, `billing.use-cases.ts`, `stripe-platform-events.use-case.ts`. Move helpers to `payment-platform.helpers.ts`.

#### H3. `CreatePaymentIntentUseCase` orchestrates 5 sub-systems
**File:** `create-payment-intent.use-case.ts:327`

Responsibilities:
1. Session/merchant validation
2. **Commerce order sync** (delegates to commerce module via `validateCommerceCart` + `syncPendingCommerceOrder`)
3. **Asaas customer creation** (calls provider directly)
4. **Provider payment creation** (Stripe/Asaas/crypto routing)
5. **Outbox event emission**

The commerce order sync is a hard pre-condition for Asaas flows but optional for Stripe/crypto — this conditional path is buried in `ensurePendingCommerceOrder` and depends on two `@Optional()` dependencies.

**Risk:** dead code paths in test environments where commerce module is absent. The `@Optional()` pattern combined with runtime checks (`if (!this.validateCommerceCart) throw ...`) creates an environment-dependent use-case that is hard to reason about.

**Fix:** extract `CommercePaymentReadinessService` (validates + syncs). Make the commerce dependency a required port at composition time, with an in-memory no-op adapter for non-commerce contexts (or split Stripe-only and Asaas-only intents into distinct use-cases).

#### H4. `payment-secret-cipher` uses fixed SALT and scryptSync
**File:** `payment-secret-cipher.ts`

```ts
const SALT = "aacp-payment-connection";
const DEV_KEY = "aacp-dev-payment-connection-key";
// ...
return scryptSync(material, SALT, 32);
```

`SALT` is a hard-coded literal. `scryptSync` is fine for key derivation but the fixed SALT means all encrypted secrets share the same key-derivation context. If `AACP_PAYMENT_ENC_KEY` is ever leaked + a ciphertext is leaked, **all tenants' stored API keys are at risk simultaneously**.

Also: the dev fallback uses a static `DEV_KEY` in non-production — if a dev DB is promoted to prod by mistake, every secret decrypts with the same key for everyone.

**Fix:** rotate salts per-secret (store IV + salt alongside ciphertext) OR use envelope encryption (KMS-wrapped DEK). At minimum, fail-loud on dev keys in production.

### MEDIUM

#### M1. Stripe SDK instantiated twice with hard-coded version
**Files:** `confirm-stripe-payment.use-case.ts:38`, `handle-stripe-webhook.use-case.ts:60`

```ts
this.stripe = new Stripe(secretKey ?? "__missing__", { apiVersion: "2026-04-22.dahlia" });
```

The `"__missing__"` sentinel is a placeholder string used when env is unset — Stripe SDK will throw at first API call but **the constructor itself accepts it silently**. This means a misconfigured environment looks healthy until the first request.

The Stripe SDK is also instantiated twice (one in `StripePaymentAdapter`, one in `handle-stripe-webhook.use-case.ts` for signature verification). The API version is hard-coded in 3 places (`stripe-payment.adapter.ts`, `confirm-stripe-payment.use-case.ts`, `handle-stripe-webhook.use-case.ts`).

**Fix:** inject a single `StripeClientFactory` provider, fail-loud on missing key, centralize API version constant.

#### M2. Routing adapter is an if/else switch
**File:** `routing-payment.adapter.ts`

```ts
if (input.method === "crypto") return this.evmCrypto.createPayment(input);
if (input.method === "card" && this.stripe) return this.stripe.createPayment(input);
// fall through to Asaas
```

Every new method or provider modifies this file. The `fetchPaymentStatus` switch (`isStripeId = input.providerPaymentId.startsWith("pi_")`) is a particularly bad smell — it sniffs the id format to infer the provider.

**Fix:** provider registry pattern (`Map<PaymentMethod, PaymentProviderPort>`); each provider self-identifies by id-prefix or claims the method.

#### M3. `normalizeProviderException` is a 9-case switch in create-payment-intent
**File:** `create-payment-intent.use-case.ts:90-110`

The use-case knows every provider's error code by name. Adding a new provider's error taxonomy requires editing this file. **OCP violation.**

**Fix:** each provider adapter exposes its own error normalizer; the use-case catches a generic `PaymentProviderError` and lets it bubble.

#### M4. `majorUnitsFromCents` duplicated in 3 files
**Files:** `reconcile-payment-intents.use-case.ts`, `handle-asaas-webhook.use-case.ts`, `evm-crypto.constants.ts` (slight variation)

**Fix:** shared `currency-format.ts` helper.

#### M5. Webhook token validation is non-constant-time
**File:** `handle-asaas-webhook.use-case.ts:54-58` (`assertWebhookToken`)

```ts
if (got !== expected) throw new UnauthorizedWebhookError();
```

**Risk:** timing oracle. Use `crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))` with equal-length buffers (compare length first; reject early if different length but consume time).

#### M6. `PaymentIntentSnapshot.buyerFacing` is an untyped bag
**File:** `payment-intent.entity.ts:31-50`

The `buyerFacing` field is a 16-key object with no type-level guarantees. The webhook path re-validates its shape via `asCryptoBuyerFacing` (in `confirm-crypto-payment.use-case.ts:24-36`) but the Asaas/Stripe paths write directly without validation.

**Fix:** discriminate union `CryptoBuyerFacingPayload | PixBuyerFacingPayload | CardBuyerFacingPayload`; only the fields relevant to the method are set.

#### M7. `requiredAsaasSecret` returns a raw API key string from the repository
**File:** `payment-platform.use-cases.ts:474-481`

The repository returns the secret as a plain string (after `payment-secret-cipher.decryptPaymentSecret`), and the use-case hands it to the adapter. The API key flows through:
- decrypted in `prisma-payment-platform.repository` (or similar)
- passed by reference through use-case → `AsaasPlatformAdapter.listOnboardingLinks(apiKey)`
- serialized into a fetch header

If the use-case ever logs `result` accidentally (e.g., via a generic `console.log("result:", input)` during debugging), the secret leaks.

**Fix:** wrap in an `AsaasApiKey` branded type that throws on toString/JSON.stringify; require explicit unwrap.

### LOW

#### L1. `e2e-payment-provider.ts` introduces a test-only port
The file exists to allow e2e tests to bypass real provider onboarding. This is acceptable but should be guarded with a build-time assertion that the prod module root never imports this symbol directly.

#### L2. `payment-secret-cipher` lacks auth-tag version byte
The output format is `iv:tag:ciphertext` (base64). If the algorithm or key-derivation parameters ever change, old ciphertexts become unreadable. Add a version prefix (`v1:iv:tag:ciphertext`).

#### L3. Object Calisthenics — `CreatePaymentIntentUseCase.execute()` is one 110-line function
The single `execute` method is doing too much. Refactor into:
- `validateScope()`
- `ensurePendingCommerceOrder()`
- `setupStripePayment()` / `setupAsaasPayment()` / `setupCryptoPayment()`
- `persistAndDispatch()`

#### L4. `JSON.parse(JSON.stringify(...))` for Prisma JSON columns
**File:** `prisma-negotiation.store.ts` (also payment equivalents)

Deep-clone via JSON is slow for large payloads. Use `structuredClone` (Node 17+) or Prisma's `JsonValue` directly.

#### L5. `PaymentIntentEntity` allows `setBuyerFacingPayload` after `requires_action`
**File:** `payment-intent.entity.ts:124-127`

```ts
if (this.s.status !== "pending" && this.s.status !== "requires_action") throw new Error("illegal_transition");
```

This means a crypto intent can be re-quoted after the buyer saw the original — confusing UX. Should be `pending` only.

---

## 3. Coupling Map

```
┌─────────────────────────────────────────────────────────────────┐
│ presentation/http/                                              │
│   payment.controller.ts ──┐                                     │
│   stripe-payment.controller.ts                                │
│   crypto-payment.controller.ts                                  │
│   payment-platform.controller.ts (2 controllers in 1 file)       │
│   asaas-webhook.controller.ts                                   │
│   stripe-webhook.controller.ts                                  │
└────┬────────────────────────────────────────────────────────────┘
     │ DI
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ application/                                                     │
│   CreatePaymentIntentUseCase ───┐                                │
│   ConfirmCryptoPaymentUseCase   │                                │
│   ConfirmStripePaymentUseCase   │                                │
│   HandleAsaasWebhookUseCase ────┼─► duplicated dispatch logic   │
│   HandleStripeWebhookUseCase ───┘                                │
│   ReconcilePaymentIntentsUseCase                                 │
│   GetPaymentIntentStatusUseCase                                  │
│   payment-platform.use-cases.ts (10 classes)                     │
└────┬────────────────────────────────────────────────────────────┘
     │ Ports
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ domain/ports/                                                    │
│   PaymentProviderPort ──┐                                        │
│   CheckoutPaymentPort   │──► CheckoutModule (recordPaymentStatus)│
│   PaymentRepository     │──► PrismaPaymentRepository            │
│   PaymentPlatformProviderPort (Stripe | Asaas | BillingConfig)   │
│   PaymentPlatformRepository ──► PrismaPaymentPlatformRepository  │
└────┬────────────────────────────────────────────────────────────┘
     │ adapters
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ infrastructure/                                                   │
│   RoutingPaymentAdapter (god)                                    │
│   StripePaymentAdapter ──► Stripe SDK (direct)                   │
│   AsaasPaymentAdapter ──► fetch()                                │
│   EvmCryptoPaymentAdapter ──► MerchantRules, EVM constants        │
│   payment-secret-cipher (AES-256-GCM, fixed salt)                │
│   e2e-payment-provider (test-only)                              │
└─────────────────────────────────────────────────────────────────┘

Cross-module coupling:
  payment → checkout (CheckoutSessionRepository, CheckoutPaymentPort, OUTBOX_REPOSITORY)
  payment → commerce (ValidateCartForPayment, SyncPendingOrder, MarkCommerceOrderPaid)
  payment → merchant (MERCHANT_REPOSITORY, getStripeConnectAccountId, crypto rules)
  payment → integrations (HttpClientService)
  payment → shared (OutboxRepository, MetricsService, persistence, http)
  payment → checkout domain events (createCheckoutEventEnvelope)
```

**Strongest couplings:**
- `CreatePaymentIntentUseCase` ↔ commerce module (3 deps)
- `HandleStripeWebhookUseCase` ↔ Stripe SDK (direct instantiation)
- Webhook handlers ↔ Outbox + Commerce (cross-module side effects)

**Weakest abstraction:** `PaymentProviderPort` is implemented by 4 different adapters, but only Stripe uses the full surface (createPayment + fetchPaymentStatus + createCustomer). Asaas uses all three. Crypto uses only createPayment. The port surface is wider than any one provider needs (ISP).

---

## 4. Proposed Changes

### Phase 1 — Critical fixes (1-2 days)

1. **Extract webhook dispatch service** (P1):
   - Create `application/services/payment-dispatch.service.ts` containing the intent-state-machine (`markApproved` → `completeAfterApproval` → `markCommerceOrderPaid`) shared between Stripe and Asaas.
   - Refactor both webhook use-cases to delegate to this service after the provider-specific auth + idempotency gate.
   - **Result:** ~100 LoC removed from each webhook use-case; cross-provider invariants become impossible to drift.

2. **Atomic tenant scoping in repositories** (P1):
   - All `getIntentByX` queries: change `where: { id }` → `where: { id, merchantId }`.
   - Remove post-read `if (row.merchantId !== merchantId.trim()) return null` (now a query-level invariant).

3. **Crypto reservation reaper** (P1):
   - Add `payment_crypto_transfer` column `expires_at` (default 5 minutes).
   - Background job releases expired reservations.
   - Or: scope unique constraint with `WHERE intent_status = 'requires_action'` partial index, allowing re-use after intent fails.

### Phase 2 — SOLID refactors (3-5 days)

4. **Split `payment-platform.use-cases.ts`** (P2): one file per sub-domain.
5. **Decompose `CreatePaymentIntentUseCase`** (P2): extract `CommercePaymentReadinessService` and `AsaasCustomerBootstrapService`.
6. **Provider registry** (P2): replace `RoutingPaymentAdapter` if/else with a `Map<PaymentMethod, PaymentProviderPort>` populated at composition time.
7. **Stripe SDK factory** (P2): inject `StripeClientFactory`; remove direct `new Stripe(...)` from use-cases.
8. **Branded secret type** (P2): `AsaasApiKey` branded type that refuses `toString()` unless explicitly unwrapped.

### Phase 3 — DRY + typing (1-2 days)

9. **Shared currency helpers** (`currency-format.ts`): `majorUnitsFromCents`, `centsFromMajorUnits`.
10. **Discriminated `BuyerFacingPayload`**: replace the 16-key bag with a tagged union.
11. **Single error normalization service**: move `normalizeProviderException` from create-payment-intent to `application/services/provider-error.service.ts`; each provider registers its own error→code map.

---

## 5. SOLID Verdict

| Principle | Verdict | Worst Offender |
|---|---|---|
| S (SRP) | ❌ multiple violations | `CreatePaymentIntentUseCase`, webhook handlers, `payment-platform.use-cases.ts` (10 classes) |
| O (OCP) | ❌ every new provider requires edits in 3+ files | `RoutingPaymentAdapter`, `normalizeProviderException` |
| L (LSP) | ✅ providers implement a single port (mostly fine) | `E2eTestPaymentProvider` violates the implicit "no synthetic ids" contract |
| I (ISP) | ❌ `PaymentProviderPort` is wider than any one provider needs | `fetchPaymentStatus` only used by reconcile + Asaas |
| D (DIP) | ❌ Stripe SDK instantiated in use-case | `ConfirmStripePaymentUseCase`, `HandleStripeWebhookUseCase` |

---

## 6. Object Calisthenics Verdict

| Rule | Verdict | Notes |
|---|---|---|
| 1. One level of indentation per method | ⚠️ | Webhook `execute()` methods use deep nested `if/try/catch/await` |
| 2. No `else` | ✅ | mostly compliant; some `else` in dispatch fallback |
| 3. Wrap all primitives | ❌ | `amountCents`, `currency` strings, `merchantId` — no value objects |
| 4. First-class collections | ⚠️ | `requirements: string[]` could be a `Requirements` class |
| 5. One dot per line | ⚠️ | `this.checkout.getSession(...).customer.asaasCustomerId` style in some helpers |
| 6. Don't abbreviate | ✅ | naming is consistent |
| 7. Keep entities small | ❌ | `PaymentIntentEntity` mutates 6+ state-machine transitions |
| 8. No classes > 50 lines | ❌ | `CreatePaymentIntentUseCase` is 327 lines |
| 9. No getters/setters/properties | ⚠️ | `PaymentIntentEntity` exposes `status`, `id` getters; state mutation goes through `markX` methods — acceptable |

**Worst offenders:** `CreatePaymentIntentUseCase` (rule 8), `PaymentIntentEntity` (rule 7).

---

## 7. Race Conditions & Edge Cases Summary

| Race | Mitigation Status | Risk |
|---|---|---|
| Two confirmations, same txHash | Unique constraint `(chain, txHash)` | ✅ safe |
| Webhook + manual confirm simultaneously | `recordProcessedProviderEvent` gate + `markApproved` state-machine throws | ✅ safe |
| Reconciliation concurrent with webhook | Per-event idempotency; reconcile is read-mostly | LOW |
| Crypto reservation orphaned by worker kill | No reaper | HIGH |
| Asaas customer creation race (two parallel intents) | No unique constraint on `(merchantId, cpfCnpj)` in Asaas | MEDIUM — duplicate customers created |
| `applyOfferWithLedger` concurrent apply | Transactional + lookup-then-insert | ✅ safe (verified) |
| `handleAsaasWebhook` externalReference missing | Falls through to `ignored: intent_lookup_requires_external_reference` | ✅ handled |

---

## 8. Security Summary

| Severity | Issue |
|---|---|
| CRITICAL | none (card data is tokenized before persistence; `FORBIDDEN_PAYMENT_INPUT_KEYS` guard in `PaymentIntentEntity.create` blocks raw PAN/cvv storage) |
| HIGH | Fixed SALT in payment-secret-cipher; dev fallback key |
| MEDIUM | Non-constant-time webhook token compare; raw API key flow through use-cases |
| MEDIUM | Single RPC endpoint for EVM (no failover) |
| LOW | Missing auth-tag version byte in cipher output |

---

## 9. Files Changed (Proposed)

**New:**
- `application/services/payment-dispatch.service.ts`
- `application/services/commerce-payment-readiness.service.ts`
- `application/services/provider-error-normalizer.ts`
- `application/use-cases/payment-platform/{stripe-connect,asaas-onboarding,billing,stripe-platform-events}.use-cases.ts`
- `domain/value-objects/{Money,AsaasApiKey,BuyerFacingPayload}.ts`
- `shared/currency-format.ts`

**Edited:**
- `create-payment-intent.use-case.ts` (split into 3 collaborators)
- `handle-asaas-webhook.use-case.ts` / `handle-stripe-webhook.use-case.ts` (extract dispatch)
- `confirm-stripe-payment.use-case.ts` (inject StripeClientFactory)
- `routing-payment.adapter.ts` (replace with provider registry)
- `prisma-payment.repository.ts` (atomic tenant scope)
- `prisma-payment-platform.repository.ts` (cipher version byte)
- `payment-secret-cipher.ts` (per-secret salt + version prefix)
- `payment.module.ts` (re-wire)