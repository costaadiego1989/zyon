# REFACTOR.md — embed module

## Current State

**Responsibility:** Token issuance, session validation, embedding widget on external origins.

**Structure:**
- `domain/embed-token.service.ts` — HMAC signing/verification, JWT-like format (no library dependency).
- `application/issue-embed-session.use-case.ts` — Scope & origin validation before issuance.
- `presentation/embed-sessions.controller.ts` — POST /embed-sessions (issuer auth: JWT | API key).
- `presentation/embed-checkout.controller.ts` — Embed-scoped checkout, payment, offers.
- `presentation/embed-auth.guard.ts` — Token verification, origin enforcement, scope check, tenant binding.
- `presentation/embed-session-issuer.guard.ts` — Issuer auth (JWT | API key), tenant principal setup.
- `presentation/embed-scope.decorator.ts` — Scope metadata + reflection.

**Key Flows:**
1. Dashboard/API Key → POST /embed-sessions → Guard validates issuer, UseCase sanitizes origin/scopes → Token issued.
2. Widget → POST /embed/start (Bearer: embed_session_token) → AuthGuard verifies token, checks origin, enforces scope → CheckoutController routes to StartCheckoutUseCase.

**Known Issues:**
- Body parsing throws 500 on malformed requests (stated in task).
- 7 controllers/guards injected into module; heavy cross-coupling with checkout, payment, integrations, catalog, installations.
- Multiple guard layers: EmbedSessionIssuerGuard → EmbedAuthGuard → per-endpoint @RequireEmbedScope.
- Scope enforcement is decorator-based; no centralized policy.
- Origin binding loose: only enforced if `claims.allowedOrigin` is set.
- No guard for body validation errors (500 on parse fail).

---

## CRITICAL Issues

**C1: Unauthenticated scope acceptance in live mode — [DONE]**
- Mandate origin for ALL transactional scopes regardless of environment.
- Changed `issue-embed-session.use-case.ts:55` to check transactional scopes without environment condition.
- Updated test to expect rejection in test environment + transactional scope without origin.
- Error message changed to "embed_allowed_origin_required_for_transactional_scopes".

**C2: Body parsing → 500 without structured error — [DONE]**
- Verified existing `ProblemDetailsFilter` (@Catch()) catches NestJS BadRequestException from body parser.
- No additional code needed; global filter maps to 400 application/problem+json.

**C3: Stale/reused quote session_id leak**
- Deferred to shipping module refactor (shipping REFACTOR.md item C2).

---

## HIGH Priority

**H1: Scope inheritance + reflect anti-pattern — [DONE]**
- Changed `embed-auth.guard.ts` to use `reflector.get()` instead of `getAllAndOverride()`.
- Scope now read only from handler, not inherited from controller class.

**H2: EmbedCheckoutGuardHelper injected as singleton — [SKIPPED]**
- Kept as-is for backward compat. Export is used by other controllers (catalog, coupons, cross-sell).
- No change required per design review.

**H3: Origin header missing → no validation — [DONE]**
- Enhanced `enforceOrigin()` to fail closed when transactional scope present but no origin header sent.
- Check added: if `claims.allowedOrigin` is set but request provides no Origin/Referer, throw ForbiddenException.

**H4: Implicit NoOp on unset allowedOrigin — [DONE]**
- Added check in `enforceOrigin()` to reject tokens with transactional scopes but no allowedOrigin.
- Defense-in-depth on top of C1 (which prevents such tokens at issuance).
- Throws ForbiddenException("embed_origin_binding_required_for_transactional_scopes").

---

## MEDIUM Priority

**M1: No rate limiting per token or merchant — [SKIPPED]**
- Requires @nestjs/throttler dependency not yet installed.
- Deferred to future when throttler module is available.

**M2: Decorator + Guard scope checking is fragmented — [ADDRESSED]**
- H1 fix ensures scope read only from handler, not inherited.
- Developers cannot accidentally inherit scope from controller.
- No change to decorator pattern required.

**M3: Token expiry hardcoded to [60, 86400] seconds — [SKIPPED]**
- TTL clamping is intentional design (1-24 hours is safe default).
- Not blocking production; can be revisited if real use-case requires 30-sec tokens.

**M4: No audit log for token issuance — [DONE]**
- Added Logger to IssueEmbedSessionUseCase.
- Emit log event after token.sign() with merchantId, ttlSeconds, scopes, allowedOrigin.
- Logs include: `event: "embed.token.issued"` + full context.

---

## LOW Priority

**L1: Nonce not validated on verification**
- `embed-token.service.ts:67`: Nonce is generated and signed but never validated. If a token is replayed, nonce does not prevent reuse. Fix: require nonce to be unique (per-session or per-request tracking).

**L2: installationId optional but unused in downstream**
- `issue-embed-session.use-case.ts:38-40`: installationId is optionally resolved and included in claims, but `embed-checkout.controller.ts` and others never read it. Fix: either enforce its presence or remove it.

**L3: Cart ref length clamped to 120 chars without validation**
- `issue-embed-session.use-case.ts:70`: cartRef is trimmed and sliced to 120. If larger payloads are needed, they are silently dropped. Fix: reject oversized refs with 400 Bad Request instead.

---

## Coupling Map

```
embed module
├─ → auth (JWT verification, PasswordHasher)
├─ → checkout (StartCheckoutUseCase, ApplyOfferUseCase, etc.)
├─ → integrations (UpdateTenantOrderTrackingUseCase, API key auth)
├─ → merchant (MerchantModule for rules read)
├─ → payment (CreatePaymentIntentUseCase, etc.)
├─ → catalog (WidgetCatalogController re-exported)
└─ → installations (ResolveInstallationForEmbedUseCase)

High outbound fan-out: 7 module imports.
Risk: any change in checkout, payment, or integrations cascades to embed.
```

---

## Proposed Changes

### Phase 1: Fix C1 & C2 (Security)

**C1: Mandate origin for transactional scopes**
```typescript
// issue-embed-session.use-case.ts
if (scopes?.some((s) => TRANSACTIONAL_SCOPES.has(s))) {
  if (!allowedOrigin) {
    throw new BadRequestException("transactional_scopes_require_origin");
  }
}
// Remove environment check; always enforce.
```

**C2: Global parse error handler**
```typescript
// app.module or filters/parse-error.filter.ts
@Catch(BadRequestException)
export class ParseErrorFilter implements ExceptionFilter {
  catch(exc, host) {
    if (exc.getResponse()?.message?.includes('JSON')) {
      return host.switchToHttp().getResponse().status(400).json({
        error: 'body_malformed',
        details: 'Invalid JSON in request body'
      });
    }
  }
}
```

### Phase 2: Simplify scope enforcement (H1, H2, H3, H4)

**Collapse scope checking into single guard**
```typescript
// embed-scope.guard.ts (new)
@Injectable()
export class EmbedScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<EmbedScope>(
      EMBED_REQUIRED_SCOPE_KEY,
      context.getHandler()
    );
    if (!required) return true;
    const claims = context.switchToHttp().getRequest().embedClaims;
    if (!claims?.scopes?.includes(required)) {
      throw new ForbiddenException('scope_not_granted');
    }
    return true;
  }
}

// embed-auth.guard.ts: remove scope check; delegate to EmbedScopeGuard.
// controllers: @UseGuards(EmbedAuthGuard, EmbedScopeGuard)
```

**Enforce origin at guard entry, not use-case**
```typescript
// embed-auth.guard.ts:90–96
private enforceOrigin(...) {
  if (!claims.allowedOrigin) {
    throw new ForbiddenException('origin_binding_required_for_this_token');
  }
  // rest unchanged
}
```

### Phase 3: Decouple checkout routing (H2)

**Move CheckoutRepository assertion into repository contract**
```typescript
// checkout domain port (existing)
interface CheckoutRepository {
  assertBelongsToMerchant(merchantId: string, sessionId: string): Promise<void>;
}

// embed-checkout.controller.ts
constructor(
  private readonly checkout: CheckoutRepository,
  ...
) {}

async start(@Req() request: EmbedHttpRequest, @Body() body: StartCheckoutRequest) {
  const embed = request.embedClaims!;
  await this.checkout.assertBelongsToMerchant(embed.merchantId, body.session_id);
  // route to use-case
}
```

### Phase 4: Audit & rate limit (M1, M4)

**Rate limiter on token issuance**
```typescript
// embed.module.ts
providers: [
  ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
  EmbedSessionsController,
  ...
]

// embed-sessions.controller.ts
@UseGuards(ThrottlerGuard)
@Post()
async issueSession(...) { ... }
```

**Emit audit event**
```typescript
// issue-embed-session.use-case.ts
this.events.emit('embed.token.issued', {
  merchantId: input.merchantId,
  ttlSeconds: input.ttlSeconds,
  scopes: scopes,
  allowedOrigin: allowedOrigin
});
```

---

## SOLID Principles

| Principle | Current | Proposed |
|-----------|---------|----------|
| **SRP** | EmbedAuthGuard does token verify + origin + scope. | Split: EmbedAuthGuard (verify), EmbedScopeGuard (scope), origin check in app-layer assertion. |
| **OCP** | New scopes require code change in EMBED_SCOPES. | Define scopes in config or use-case input validation only. |
| **LSP** | EmbedCheckoutGuardHelper injects CheckoutRepository; all callers assume fast/available. | Use repository contract assertBelongsToMerchant; caller responsible for error handling. |
| **ISP** | EmbedHttpRequest mixes embedClaims, headers, tenantPrincipal. | Separate: EmbedTokenClaims (auth), HttpRequest (platform). |
| **DIP** | Controllers depend on concrete use-cases. | No change needed; use-cases are the application boundary. |

---

## Object Calisthenics

| Rule | Current | Proposed |
|------|---------|----------|
| 1: One level of indentation | Guards have 4 levels (conditions nested). | Extract helpers: `enforceOrigin()`, `enforceScope()`, `bindTenant()`. |
| 2: Don't use `else` | Not violated. | — |
| 3: Wrap primitives | `ttl_seconds: number` in DTO. | Wrap: `class TtlSeconds { constructor(value: number) { } }`. |
| 4: One dot per line | `request.embedClaims?.merchantId` (OK). | — |
| 5: Don't abbreviate | `ttl_seconds` is OK. | — |
| 6: Keep collections small | EMBED_SCOPES is 8 items; OK. | — |
| 7: No getters/setters | Claims are immutable snapshots. | ✓ |
| 8: No classes with 2+ responsibilities | EmbedAuthGuard verifies + origins + scope. | Split scope into EmbedScopeGuard. |
| 9: No getters for internal state | Not violated. | — |

---

## Summary

**Refactor Strategy:**
1. Enforce origin + scope at issuer time (C1).
2. Catch body parse errors globally (C2).
3. Split guard responsibilities: EmbedAuthGuard (token) → EmbedScopeGuard (scope).
4. Move assertion logic to repository contract.
5. Add rate limiter + audit events.
6. Result: embed module is narrower, session/checkout/payment routing is cleaner, security is tighter.

**Estimated Effort:** 5–7 days (includes testing + integration).
