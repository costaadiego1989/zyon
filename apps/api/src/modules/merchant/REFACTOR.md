# REFACTOR.md — Merchant Module

## Summary

The merchant module manages merchant profiles, theme configuration, business rules (discounts, shipping, offers), and crypto payment enablement. Architecture follows Clean Architecture patterns, but several issues affect testability, consistency, and operational safety around crypto integration and theme persistence.

---

## Current State

```
apps/api/src/modules/merchant/
  merchant.module.ts
  domain/
    merchant.types.ts               # Profile / Rules / Theme type re-exports
    ports/
      merchant-repository.port.ts   # Main repository port
      merchant-rules.repository.port.ts  # Secondary rules-only port
    services/
      merchant-crypto.validation.ts # Crypto config validation
  application/
    merchant.use-cases.ts           # GetProfile, GetRules, UpdateRules
    get-merchant-theme.use-case.ts  # GetMerchantTheme
    update-merchant-theme.use-case.ts  # UpdateMerchantTheme (inline validators)
    use-cases/
      enable-crypto-payments.use-case.ts  # Crypto enablement
  infrastructure/
    prisma-merchant.repository.ts   # Prisma impl + toRules/toCreate/toUpdate mappers
    in-memory-merchant.repository.ts # Test double
  presentation/
    merchant.controller.ts          # GET/PUT /merchants/me, theme routes
    http/
      crypto-payments.controller.ts  # POST /merchant/crypto-payments/enable
    dto/
      update-merchant-rules.dto.ts  # DTO with class-validator rules
```

---

## Findings

### CRITICAL

#### MERC-C1 — EnableCryptoPaymentsUseCase reads env without fallback validation

- **File:** `application/use-cases/enable-crypto-payments.use-case.ts`
- **Category:** Security / Operations
- **Description:** `execute()` reads `process.env["STELLAR_PLATFORM_SECRET"]` and throws a generic `Error` if missing. There is no startup validation (e.g., in module `OnModuleInit`) that the secret is configured in production. A operator deploying without the env var will only discover it when a merchant tries to enable crypto.
- **Impact:** Production down-time; broken merchant onboarding flow; no graceful degradation or feature flag toggle.
- **Remediation:** Inject a validated `StellarConfig` object at module load (check in `OnModuleInit` that required vars are set). Throw a descriptive startup error, not a lazy runtime error. Add a feature-flag-gated endpoint that returns `{ crypto_enabled: false }` when unconfigured.

#### MERC-C2 — Theme cast to `unknown as object` causes runtime type error

- **File:** `infrastructure/prisma-merchant.repository.ts` (`updateTheme`)
- **Category:** Type Safety / Persistence
- **Description:** `data: { theme: theme as unknown as object }` persists theme as JSON, but the read path in `toRules()` expects `(row.theme ?? undefined) as MerchantTheme | undefined`. If Prisma stores a malformed theme (invalid keys, wrong types), the downstream type assertion succeeds in TypeScript but may fail at runtime when callers access theme properties.
- **Impact:** Silent data corruption; controllers may crash when rendering theme.
- **Remediation:** Use Prisma's JSON schema validation or a strict schema codec (`zod.parse()` on read) before casting. Persist the result of `normalizeMerchantCryptoPayments`-style validation.

---

### HIGH

#### MERC-H1 — UpdateMerchantThemeUseCase has inline validation logic

- **File:** `application/update-merchant-theme.use-case.ts`
- **Category:** SRP / Reusability
- **Description:** The use-case contains regex patterns, URL validation, field length checks, and a helper function `assertTextField` inline. These validators are not reusable by DTOs, tests, or other modules.
- **Remediation:** Extract to `domain/merchant-theme.validators.ts` with named functions:
  - `assertValidHexColor(value): void` throws on invalid hex
  - `assertValidUrl(value): void` throws on non-https
  - `assertValidFontFamily(value): void` throws on length
  - `assertValidTrustBadges(badges): void` throws on count/length
  Use-case imports and calls these validators.

#### MERC-H2 — MerchantController casts request unsafely

- **File:** `presentation/merchant.controller.ts`
- **Category:** Type Safety
- **Description:** All route handlers cast `@Req() request: unknown` then `request as { user?: unknown }`. This is loose and error-prone.
- **Remediation:** Define a typed `AuthenticatedRequest` interface or use a custom param decorator:
  ```typescript
  @CurrentMerchant() merchantId: string
  ```
  Injected by the AuthGuard and verified at compile-time.

#### MERC-H3 — DEFAULT_RULES duplicated in two repos

- **File:** `infrastructure/prisma-merchant.repository.ts` and `infrastructure/in-memory-merchant.repository.ts`
- **Category:** DRY / Maintainability
- **Description:** Both repositories define identical `DEFAULT_RULES` constants. Changing defaults requires updates in two places.
- **Remediation:** Move to `domain/merchant-rules.defaults.ts` and import in both repo implementations.

#### MERC-H4 — toRules/toCreate/toUpdate are Prisma-specific mappers

- **File:** `infrastructure/prisma-merchant.repository.ts`
- **Category:** Encapsulation / Testability
- **Description:** Helper functions handle Prisma JSON casting and custom field mapping (e.g., `quickReplies`, `cryptoPayments` as `Prisma.InputJsonValue`). These are infrastructure-specific but embedded in the repository.
- **Remediation:** Acceptable as-is (infrastructure details), but extract to a separate file `infrastructure/merchant-mappers.ts` for clarity and reusability in tests.

#### MERC-H5 — CryptoPaymentsController URL inconsistent with MerchantController

- **File:** `presentation/http/crypto-payments.controller.ts` vs `presentation/merchant.controller.ts`
- **Category:** API Design / Consistency
- **Description:** Main routes use `POST /merchants/me`, `GET /merchants/me/rules`, but crypto uses `POST /merchant/crypto-payments/enable` (singular). This is confusing for API consumers.
- **Remediation:** Align routing: either move crypto-payments into `MerchantController` as `POST /merchants/me/crypto-payments/enable` or rename controller paths consistently. Prefer the former (single controller for merchant concerns).

---

### MEDIUM

#### MERC-M1 — Theme update merges with defaults unexpectedly

- **File:** `application/update-merchant-theme.use-case.ts` (`execute()`)
- **Category:** Semantics / Surprise
- **Description:** The update spreads `DEFAULT_MERCHANT_THEME`, then the patch, then validates. This means sending `{ accentColor: null }` does NOT clear the accent; it falls back to the default. Users cannot unset fields.
- **Remediation:** Distinguish between "unset" and "update":
  - If `theme.accentColor === null`, clear the override (use default)
  - If `theme.accentColor === undefined`, do nothing
  - If `theme.accentColor === "#FF0000"`, set it
  Or use a separate `reset-theme` endpoint for factory reset.

#### MERC-M2 — Theme nullability inconsistent

- **File:** `domain/merchant.types.ts`, `infrastructure/prisma-merchant.repository.ts`
- **Category:** Type Consistency
- **Description:** `MerchantProfile.theme` is `MerchantTheme | undefined`, but `toRules()` reconstructs it as `(row.theme ?? undefined) as MerchantTheme | undefined` — the `?? undefined` is redundant. Code is unclear whether theme can be null, undefined, or both.
- **Remediation:** Pick one: theme is always defined (with defaults) or always optional. Recommend: theme is always defined in snapshots, but optional on the wire (API accepts omitted fields as "use current").

#### MERC-M3 — Error handling inconsistency

- **File:** `application/merchant.use-cases.ts` vs `application/get-merchant-theme.use-case.ts`
- **Category:** Consistency
- **Description:** `GetMerchantProfileUseCase` throws `NotFoundException` when profile is missing. `GetMerchantThemeUseCase` returns defaults without checking if the profile exists. `GetCheckoutSettingsUseCase` (in checkout module) also returns defaults on miss. Inconsistent semantics.
- **Remediation:** Document the contract: are reads idempotent returns of defaults, or errors? Recommend: reads return defaults (no 404), writes validate the merchant exists first (optional early 404).

#### MERC-M4 — Crypto validation normalizes but does not store input

- **File:** `domain/services/merchant-crypto.validation.ts`
- **Category:** Safety / Explicit
- **Description:** `normalizeMerchantCryptoPayments()` strips unvalidated fields on disable (good), but when disabled returns hardcoded defaults instead of the current disabled state (e.g., preserves previous treasury address if re-enabling). This can be confusing.
- **Remediation:** When crypto is disabled, return a minimal object (`{ enabled: false }`) without preserving stale data. On re-enable, require explicit re-entry of all fields.

---

## Coupling Map

```
merchant ← auth (AuthGuard import in controller)
merchant ← shared-types (MerchantTheme, MerchantRules re-exports)
merchant → no outbound dependencies outside shared-types ✓
```

No cross-module coupling issues. Auth is a legitimate dependency for the controller.

---

## Proposed Changes

1. Extract theme validators to `domain/merchant-theme.validators.ts`
2. Extract DEFAULT_RULES to `domain/merchant-rules.defaults.ts`
3. Move mapper helpers to `infrastructure/merchant-mappers.ts`
4. Validate StellarConfig at module OnModuleInit
5. Unify controller routes: move crypto into `MerchantController`
6. Document theme merge semantics (defaults vs overrides)
7. Use Zod or hand-rolled codec for theme persistence validation
8. Add `@CurrentMerchant()` decorator to remove request casting

---

## SOLID Alignment

- **SRP:** Each use-case has a single verb (Get, Update, Enable). Validators scattered across files violate SRP → extract.
- **OCP:** Adding new theme fields requires editing `UpdateMerchantThemeUseCase` inline → extract validators for extension via composition.
- **LSP:** Repositories implement the same interface; mappers are Prisma-specific internals (acceptable).
- **ISP:** `MerchantRepository` combines profile, theme, rules, and crypto in one port → consider splitting if crypto is consumed differently.
- **DIP:** Use-cases inject repositories via symbols; crypto reads env directly → inject `StellarConfig` instead.

---

## Object Calisthenics

- **One level of indentation:** Most methods stay flat. `UpdateMerchantThemeUseCase.execute()` has 3 nested blocks (for loop over colors); extract loop to a function.
- **No ELSE:** Validators use early returns (good). Crypto validation uses ternary on `input?.trim()` (acceptable).
- **Short methods:** Use-cases are 5-15 lines (good). Validators are 5-30 lines (acceptable).
- **Wrap primitives:** Theme colors, URLs, and treasury addresses are strings; no value types. Acceptable for now (low risk).
- **First-class collections:** `triggerRules`, `blockedRegions`, `quickReplies` are arrays; no collection wrappers. Acceptable.
- **No getters/setters:** Entity has public read-only `props` (via `snapshot()`); acceptable.
- **One dot per line:** Controllers use `currentUser(...).merchantId` (OK); crypto validation chains `input?.treasuryAddress?.trim()` (acceptable for safety).
- **No abbreviations:** Names are verbose (good).
- **Keep it DRY:** DEFAULT_RULES is duplicated; mappers are embedded in repo. Extract both.

---

## Priority Execution Order

1. **MERC-C1** — Add `StellarConfig` injection + OnModuleInit validation
2. **MERC-C2** — Add Zod codec validation on theme read/write
3. **MERC-H5** — Merge crypto routes into MerchantController
4. **MERC-H3** — Extract DEFAULT_RULES constant
5. **MERC-H1** — Extract theme validators
6. **MERC-H2** — Add @CurrentMerchant decorator
7. **MERC-M1** — Document and test theme merge semantics
8. Remaining MEDIUM items
