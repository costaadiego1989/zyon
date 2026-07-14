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

**C1: Unauthenticated scope acceptance in live mode**
- `issue-embed-session.use-case.ts:55`: Transactional scopes (payment:intents:*, offers:apply, coupons:apply) require `allowedOrigin` in live mode, but if attacker omits allowedOrigin and environment is test, token is issued. At widget side, attacker can forge origin header (still unbound). Fix: mandate origin for transactional scopes regardless of environment.

**C2: Body parsing → 500 without structured error**
- `embed-checkout.controller.ts` & `embed-sessions.controller.ts` do not pre-validate @Body. NestJS default body parser throws unhandled errors for malformed JSON. Fix: add global or controller-level exception filter mapping parse errors to 400 Bad Request.

**C3: Stale/reused quote session_id leak**
- `shipping/application/quote-shipping.use-case.ts:56`: Quote reuse rebinds session_id to current session, but if quote is old and merchant caches it, the session_id in snapshot may belong to a past session. Widget now uses an old session_id to select shipping. Fix: do not rebind session_id on quote reuse; store immutable with the quote.

---

## HIGH Priority

**H1: Scope inheritance + reflect anti-pattern**
- Scope is checked via `Reflector.getAllAndOverride()` in `embed-auth.guard.ts:99`. If a parent controller sets a scope, child routes inherit it unpredictably. Fix: collapse scope enforcement into single per-route guard or centralized policy evaluator.

**H2: EmbedCheckoutGuardHelper injected as singleton**
- `embed-checkout.controller.ts` exports `EmbedCheckoutGuardHelper` as injectable. It has a single CheckoutRepository injected. If repository is slow or transient error occurs, all embed endpoints are affected. Fix: move assertion logic into CheckoutRepository contract or use a factory per request.

**H3: Origin header missing → no validation**
- `embed-auth.guard.ts:32-37`: If request has no origin header and no referer, `requestOrigin()` returns undefined. Guard then skips origin check if `claims.allowedOrigin` is falsy. Attacker can omit origin and bypass binding. Fix: fail closed if transactional scope + no origin header provided.

**H4: Implicit NoOp on unset allowedOrigin**
- `embed-auth.guard.ts:90-95`: If token has no allowedOrigin, entire `enforceOrigin()` is skipped. Issuer never set origin, so widget is unbound. But token may contain transactional scopes. Fix: enforce pre-issuance that transactional scopes mandate origin.

---

## MEDIUM Priority

**M1: No rate limiting per token or merchant**
- Token issuance has no rate limit. A compromised API key can issue thousands of tokens in milliseconds, flooding cache or DB. Fix: implement per-merchant/per-issuer rate limit (e.g., 100 tokens/minute) in `EmbedSessionIssuerGuard` or dedicated limiter.

**M2: Decorator + Guard scope checking is fragmented**
- `@RequireEmbedScope` is separate from guard. If developer forgets the decorator, scope is never checked. Fix: make scope required at controller level; raise if missing.

**M3: Token expiry hardcoded to [60, 86400] seconds**
- `issue-embed-session.use-case.ts:49`: TTL clamped to 1–24 hours. If a use-case needs 30-second tokens for one-time checkout, it cannot. Fix: allow configurable per-endpoint min/max TTL or use route metadata.

**M4: No audit log for token issuance**
- Token issuance is not logged. If a token is leaked, there is no record of which issuer created it or when. Fix: emit domain event or audit trail for all token issuances.

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
