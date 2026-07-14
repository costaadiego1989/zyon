# REFACTOR.md — Commerce Module

## Summary

The commerce module manages multi-provider connections (Shopify, WooCommerce),
cart validation, pending order sync, payment marking, catalog search, and
credential encryption at rest. Architecture follows Clean Architecture well:
ports are clearly defined, use-cases are verb-named and focused, idempotency
is enforced via dedicated dedup ports, and secrets use AES-256-GCM encryption.
The main issues are in the adapter factory (god class, no caching) and
encryption key derivation.

---

## Findings

### CRITICAL

#### COM-C1 — Static salt in scrypt key derivation weakens encryption

- **File:** `infrastructure/commerce-secret-cipher.ts`
- **Category:** Security / Crypto
- **Description:** `deriveKey()` uses `scryptSync(material, "aacp-commerce-token", 32)`
  with a hardcoded static salt. The purpose of salt in scrypt is to prevent
  precomputation attacks (rainbow tables). A static salt means all deployments
  sharing the same `AACP_COMMERCE_ENC_KEY` value produce the same derived key,
  and an attacker who obtains one ciphertext + key material can derive the key
  for all records without per-record work.
- **Impact:** If key material leaks, all commerce secrets across all merchants
  are decryptable with zero additional cost. Static salt also means key
  rotation requires re-encrypting all records (no versioned key ID).
- **Remediation:**
  1. Use a per-record random salt (stored alongside ciphertext) OR use the key
     material directly if it has sufficient entropy (64+ bytes of randomness).
  2. Add a `key_version` prefix to ciphertext to support key rotation without
     full re-encryption.
  3. Consider using `node:crypto.hkdf` instead of `scryptSync` for key
     derivation from already-high-entropy material (scrypt is for passwords).

---

### HIGH

#### COM-H1 — `TenantCommerceAdapterFactory` is a god class (SRP violation)

- **File:** `infrastructure/tenant-commerce-adapter.factory.ts`
- **Category:** SOLID (SRP), Object Calisthenics
- **Description:** Single class implements `CommerceCartPort`,
  `CommerceOrderPort`, AND `CommerceCatalogPort`. It contains:
  - Provider resolution logic (`resolve(merchantId)`)
  - Retry policy decisions (which methods to retry, which not)
  - Dev fallback credential logic
  - All cart, order, catalog, and connection operations
  This class has 8+ public methods and mixes infrastructure concerns (adapter
  instantiation, retry wrapping) with routing decisions.
- **Impact:** Hard to test individual behaviors; changes to retry policy affect
  all operations; class grows with every new provider method.
- **Remediation:** Extract:
  1. `CommerceAdapterResolver` — resolves merchantId to a `CommerceProviderPort`
     (handles credentials, fallback, provider selection)
  2. Keep `TenantCommerceAdapterFactory` as a thin delegator that wraps the
     resolved adapter with retry/no-retry policy per operation.
  Alternatively, use a proper Strategy pattern with provider-specific factories.

#### COM-H2 — No adapter instance caching (new adapter per request)

- **File:** `infrastructure/tenant-commerce-adapter.factory.ts`
- **Category:** Performance / KISS
- **Description:** Every call to `validateCart`, `createPendingOrder`,
  `markOrderPaid`, `searchCatalog`, etc. calls `this.resolve(merchantId)` which:
  1. Queries Prisma for credentials
  2. Decrypts the secret
  3. Instantiates a new `ShopifyCommerceAdapter` or `WooCommerceCommerceAdapter`
  For a single checkout session, this happens 3-4 times.
- **Impact:** Unnecessary DB queries, decryption overhead, and object allocation
  per operation. Under load, this multiplies latency.
- **Remediation:** Add a short-lived LRU cache (TTL 30-60s) keyed by merchantId.
  Invalidate on credential update. Or use request-scoped caching via NestJS
  `REQUEST` scope or a `CLS` context.

#### COM-H3 — `MarkCommerceOrderPaidUseCase` has no rollback on provider failure after reserve

- **File:** `application/mark-commerce-order-paid.use-case.ts`
- **Category:** Reliability / Data Consistency
- **Description:** The flow is:
  1. `dedup.tryReserve(merchantId, paymentReference)` — claims the slot
  2. `orders.markOrderPaid(...)` — calls external provider (Shopify/WooCommerce)
  3. `dedup.markProcessed(...)` — persists final state + outbox event
  If step 2 fails (network error, provider 5xx), the reserve row exists with
  `commerceOrderId = ""` and subsequent retries return `reserved = false`,
  permanently blocking the payment from being marked.
- **Impact:** A transient Shopify failure permanently blocks the order from
  being marked as paid. Manual intervention required.
- **Remediation:** On provider failure, either:
  (a) Delete/release the reserve row so retries can re-attempt, OR
  (b) Change `tryReserve` to treat rows with empty `commerceOrderId` as
  "in-progress" (allow the same caller to retry), OR
  (c) Add a TTL-based expiry on uncompleted reserves.

#### COM-H4 — `SyncPendingOrderUseCase` has same reserve-without-rollback issue

- **File:** `application/sync-pending-order.use-case.ts`
- **Category:** Reliability / Data Consistency
- **Description:** Similar to COM-H3: the pending order index is written before
  calling the provider's `createPendingOrder`. If the provider call fails, the
  index row blocks future retries.
- **Impact:** A single transient failure permanently blocks order creation for
  that session.
- **Remediation:** Same as COM-H3 — release the index on provider failure or
  implement a TTL-based stale-claim recovery.

---

### MEDIUM

#### COM-M1 — No circuit breaker on commerce provider calls

- **File:** `infrastructure/commerce-retry.ts`, `infrastructure/tenant-commerce-adapter.factory.ts`
- **Category:** Reliability / Resilience
- **Description:** `retryWithBackoff` retries up to 3 times with exponential
  backoff (200ms base). But there is no circuit breaker. If Shopify is down,
  every request still attempts 3 calls before failing.
- **Impact:** Under sustained provider outage, all checkout requests experience
  3x latency before failing. DB-level connection health tracking exists but
  isn't used to short-circuit calls.
- **Remediation:** Use the `CommerceConnection.status` field ("degraded",
  "error") to implement a circuit breaker: if status is "error" and
  `lastTestedAt` is recent, fail fast without calling the provider.

#### COM-M2 — Hardcoded dev fallback credentials read from env vars

- **File:** `infrastructure/tenant-commerce-adapter.factory.ts`
- **Category:** Security / KISS
- **Description:** `globalEnvCredentials()` reads `SHOPIFY_SHOP_DOMAIN`,
  `SHOPIFY_ADMIN_ACCESS_TOKEN`, etc. from `process.env` directly. While
  production-gated and scoped to a single demo merchant, this mixes
  configuration concerns into infrastructure code.
- **Impact:** Env var sprawl; easy to accidentally enable in production if
  `SHOPIFY_DEMO_MERCHANT_ID` is set in a production env file.
- **Remediation:** Move demo fallback to a dedicated `DemoCommerceConfigService`
  injected only in non-production modules. Add explicit validation that throws
  on startup if demo vars are set with `NODE_ENV=production`.

#### COM-M3 — `CommerceConnectionPort` mixes read and write concerns

- **File:** `domain/ports/commerce-connection.port.ts`
- **Category:** Interface Segregation (SOLID/ISP)
- **Description:** Single port defines:
  - `getCredentials(merchantId)` — read decrypted secrets
  - `getConnection(merchantId)` — read connection metadata
  - `saveCredentials(input)` — write/encrypt credentials
  - `updateConnectionHealth(input)` — write health status
  - `deleteConnection(merchantId)` — destructive write
- **Impact:** Any consumer that only needs to read credentials must depend on
  the full write interface. Makes testing heavier.
- **Remediation:** Split into `CommerceCredentialReader` (getCredentials) and
  `CommerceConnectionManager` (save, update, delete, getConnection).

#### COM-M4 — `retryWithBackoff` has no jitter

- **File:** `infrastructure/commerce-retry.ts`
- **Category:** Reliability
- **Description:** Backoff is purely exponential (`200 * 2^attempt`) without
  random jitter. Under concurrent load, retries from multiple requests
  synchronize and hit the provider simultaneously (thundering herd).
- **Impact:** Retry storms during partial provider recovery.
- **Remediation:** Add `+/- 20%` random jitter to the delay calculation.

#### COM-M5 — Commerce domain events lack correlation/causation chain

- **File:** `domain/events/commerce-domain-event.ts`, `application/*.use-case.ts`
- **Category:** Observability / Tracing
- **Description:** `createCommerceEventEnvelope` generates `correlation_id` and
  `causation_id` as new UUIDs. There is no mechanism to propagate the original
  request's correlation ID through the event chain.
- **Impact:** Cannot trace a payment webhook -> order mark paid -> outbox event
  -> downstream handler as a single logical flow.
- **Remediation:** Accept optional `correlationId` / `causationId` in use-case
  inputs; propagate from the incoming request context.

#### COM-M6 — No validation on `commerceCartRef` format

- **File:** `application/validate-cart-for-payment.use-case.ts`
- **Category:** Input Validation
- **Description:** `ValidateCartForPaymentUseCase` accepts `commerceCartRef` as
  a bare string and passes it directly to the adapter. No format validation,
  length check, or sanitization.
- **Impact:** Potential injection into Shopify/WooCommerce API calls if adapter
  doesn't sanitize. DoS via extremely long strings.
- **Remediation:** Add regex validation for expected cart ref formats
  (Shopify checkout token format, WooCommerce cart key format).

---

### LOW

#### COM-L1 — `DisabledCommerceAdapter` implements partial interface

- **File:** `infrastructure/disabled-commerce.adapter.ts`
- **Category:** SOLID (LSP)
- **Description:** Implements `CommerceCartPort` and `CommerceOrderPort` but not
  `CommerceCatalogPort`. All methods throw `BadRequestException`. This is a
  valid Null Object pattern but the module wiring uses
  `useExisting: TenantCommerceAdapterFactory` for all ports, so
  `DisabledCommerceAdapter` is never actually injected.
- **Impact:** Dead code; confusing for new developers.
- **Remediation:** Either wire it as the actual fallback (replace factory's
  internal throw) or remove it.

#### COM-L2 — `PrismaCommerceConnectionRepository` decodes/encodes secret in application-visible helper

- **File:** `infrastructure/prisma-commerce-connection.repository.ts`
- **Category:** Encapsulation
- **Description:** `decodeSecret` and `encodeSecret` are file-level functions
  that parse a JSON structure from the decrypted ciphertext. This coupling
  between cipher format and credential structure is fine but undocumented.
- **Remediation:** Add JSDoc explaining the secret payload format.

#### COM-L3 — In-memory repositories lack consistency with Prisma behavior

- **File:** `infrastructure/in-memory-*.ts`
- **Category:** Test fidelity
- **Description:** In-memory repos don't enforce unique constraints or
  transactional semantics that Prisma provides. Tests using them may pass
  while the same logic would fail against the real DB.
- **Remediation:** Add invariant assertions (duplicate key checks) to in-memory
  repos, matching the Prisma schema constraints.

#### COM-L4 — Module imports `IntegrationsModule` but only uses its guards

- **File:** `commerce.module.ts`
- **Category:** Coupling
- **Description:** `CommerceModule` imports `IntegrationsModule` to access
  `TenantCredentialGuard` and `TenantAccessGuard`. This creates a hard
  dependency on the full integrations module.
- **Remediation:** Import only `TenantAccessModule` (the focused sub-module
  that exports exactly these guards) instead of the full `IntegrationsModule`.

---

## Priority Execution Order

1. **COM-C1** — Fix static salt / add key versioning for encryption
2. **COM-H3** — Add reserve rollback/TTL for `MarkCommerceOrderPaid`
3. **COM-H4** — Add reserve rollback/TTL for `SyncPendingOrder`
4. **COM-H1** — Extract `CommerceAdapterResolver` from god factory
5. **COM-H2** — Add adapter caching (LRU or request-scoped)
6. **COM-M1** — Circuit breaker using connection health status
7. **COM-M4** — Add jitter to retry backoff
8. **COM-M3** — Split connection port (ISP)
9. **COM-M5** — Correlation ID propagation
10. Remaining MEDIUM/LOW items
