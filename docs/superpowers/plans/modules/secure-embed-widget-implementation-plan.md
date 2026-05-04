# Secure Embed Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widget no browser só com `embed-session-token`; endpoints públicos autenticam pelo token; corpo HTTP não pode falsificar `merchant_id` ou sessão (SEW-REQ-001 a SEW-REQ-008).

**Architecture:** Domínio puro para payload, assinatura e validação de expiração; port `EmbedTokenSignerPort` na aplicação; infra HMAC-SHA256 com segredo de ambiente; controladores Nest para `POST /embed-sessions` (protegido) e rotas `POST /embed/*` (públicas com token no header `X-AACP-Embed-Token` ou `Authorization: Bearer emb_...`).

**Tech Stack:** NestJS, `node:crypto` (HMAC), TypeScript, `node:test` na API, Vitest opcional no widget.

---

## Cobertura de requisitos

| REQ | Coberto por |
|-----|-------------|
| SEW-REQ-001 | SEW-T005 (widget não envia keys sensíveis), revisão lint |
| SEW-REQ-002, 008 | SEW-T004, SEW-T006 |
| SEW-REQ-003, 004 | SEW-T002, SEW-T006 |
| SEW-REQ-005 | SEW-T004 (start resolve carrinho no servidor quando commerce port existir; stub inicial com session existente) |
| SEW-REQ-006, 007 | SEW-T004 (track/chat/offers/payment stubs que delegam use cases checkout) |

---

### Task SEW-T002: Domínio e serviço de token de embed

**Files:**
- Create: `apps/api/src/modules/embed/domain/embed-token.payload.ts`
- Create: `apps/api/src/modules/embed/domain/embed-token.service.ts`
- Create: `apps/api/src/modules/embed/domain/embed-token.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (registar módulo embed quando criado)

- [ ] **Step 1: Write failing domain tests**

Criar `embed-token.service.spec.ts`:

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService, type EmbedTokenSecret } from "./embed-token.service.js";

const secret: EmbedTokenSecret = { value: Buffer.from("test-secret-32-bytes-minimum!!") };

describe("EmbedTokenService", () => {
  let svc: EmbedTokenService;
  beforeEach(() => {
    svc = new EmbedTokenService(secret);
  });

  it("signs payload and verify returns same claims", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = svc.sign({
      merchantId: "m1",
      sessionId: "s1",
      issuedAtUnix: now,
      expiresAtUnix: now + 300,
      nonce: "n1",
      commerceCartRef: "cart_shopify_1"
    });
    const v = svc.verify(token);
    assert.equal(v.merchantId, "m1");
    assert.equal(v.sessionId, "s1");
  });

  it("rejects expired token", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = svc.sign({
      merchantId: "m1",
      sessionId: "s1",
      issuedAtUnix: now - 600,
      expiresAtUnix: now - 1,
      nonce: "n1"
    });
    assert.throws(() => svc.verify(token), /embed_token_expired/);
  });

  it("rejects tampered token", () => {
    const now = Math.floor(Date.now() / 1000);
    let token = svc.sign({
      merchantId: "m1",
      sessionId: "s1",
      issuedAtUnix: now,
      expiresAtUnix: now + 300,
      nonce: "n1"
    });
    token = token.slice(0, -4) + "XXXX";
    assert.throws(() => svc.verify(token), /embed_token_invalid/);
  });
});
```

Run: `pnpm --filter @aacp/api exec node --import tsx --test apps/api/src/modules/embed/domain/embed-token.service.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 2: Implement `EmbedTokenService`**

`embed-token.service.ts` (formato sugerido: `base64url(payload).base64url(hmac)`):

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export type EmbedTokenSecret = { value: Buffer };

export type EmbedTokenClaims = {
  merchantId: string;
  sessionId: string;
  issuedAtUnix: number;
  expiresAtUnix: number;
  nonce: string;
  commerceCartRef?: string;
};

export class EmbedTokenService {
  constructor(private readonly secret: EmbedTokenSecret) {}

  sign(claims: EmbedTokenClaims): string {
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.secret.value).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  verify(token: string): EmbedTokenClaims {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) throw new Error("embed_token_invalid");
    const expected = createHmac("sha256", this.secret.value).update(payloadB64).digest();
    const actual = Buffer.from(sigB64, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error("embed_token_invalid");
    }
    const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as EmbedTokenClaims;
    const now = Math.floor(Date.now() / 1000);
    if (now > claims.expiresAtUnix) throw new Error("embed_token_expired");
    return claims;
  }
}
```

Run: mesmo comando de teste.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/embed/domain/
git commit -m "feat(embed): add signed embed token domain service"
```

---

### Task SEW-T003: Endpoint protegido para emitir token

**Files:**
- Create: `apps/api/src/modules/embed/application/issue-embed-session.use-case.ts`
- Create: `apps/api/src/modules/embed/application/issue-embed-session.use-case.spec.ts`
- Create: `apps/api/src/modules/embed/presentation/http/embed-sessions.controller.ts`
- Create: `apps/api/src/modules/embed/presentation/http/embed-sessions.controller.spec.ts`
- Create: `apps/api/src/modules/embed/embed.module.ts`

- [ ] **Step 1: Controller test**

`embed-sessions.controller.spec.ts`: provar que `merchantId` para assinar vem de `req.user.merchantId`, não do body.

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmbedSessionsController } from "./embed-sessions.controller.js";
import { IssueEmbedSessionUseCase } from "../../application/issue-embed-session.use-case.js";
import { EmbedTokenService, type EmbedTokenSecret } from "../../domain/embed-token.service.js";

describe("EmbedSessionsController", () => {
  it("scopes token to JWT merchant id", async () => {
    const svc = new EmbedTokenService({ value: Buffer.from("test-secret-32-bytes-minimum!!") });
    let receivedMerchant = "";
    const uc = new IssueEmbedSessionUseCase(svc, {
      async issue(input) {
        receivedMerchant = input.merchantId;
        return { embed_session_token: "tok", expires_at_unix: input.expiresAtUnix };
      }
    });
    const c = new EmbedSessionsController(uc);
    const body = await c.issue(
      { user: { merchantId: "m_jwt", userId: "u", email: "", role: "owner" } },
      { session_id: "s_body", merchant_id: "m_evil", ttl_seconds: 60 }
    );
    assert.equal(receivedMerchant, "m_jwt");
    assert.ok(body.embed_session_token);
  });
});
```

- [ ] **Step 2: Implement use case + controller**

`IssueEmbedSessionUseCase` recebe `{ merchantId, sessionId, ttlSeconds, commerceCartRef? }`, chama `EmbedTokenService.sign`, devolve `{ embed_session_token, expires_at_unix }`.

Run: `pnpm --filter @aacp/api test -- --test-name-pattern=EmbedSessions`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(embed): protected embed session issue endpoint"
```

---

### Task SEW-T004: Endpoints públicos tokenizados (start/track/chat/apply/payment)

**Files:**
- Create: `apps/api/src/modules/embed/presentation/http/embed-public.guard.ts` (extrai e verifica token)
- Create: `apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts`
- Create: `apps/api/src/modules/embed/presentation/http/embed-checkout.controller.spec.ts`
- Modify: `apps/api/src/modules/checkout/...` — injetar delegação sem duplicar regras (embed chama `StartCheckoutUseCase` com `merchant_id` dos claims)

- [ ] **Step 1: Test — body merchant ignorado**

Provar que com token válido para `m_A`, mesmo que body traga `merchant_id: "m_B"`, o handler usa `m_A`.

- [ ] **Step 2: Implement guard Nest** que popula `@EmbedClaims()` decorator com resultado de `EmbedTokenService.verify`.

- [ ] **Step 3: Wire POST** `/embed/start`, `/embed/track`, `/embed/chat`, `/embed/offers/apply`, `/embed/payment/start` para os use cases existentes de checkout (mesmos contratos `@aacp/shared-types` onde aplicável).

Run: `pnpm --filter @aacp/api test -- --test-name-pattern=EmbedCheckout`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(embed): token-only public checkout routes"
```

---

### Task SEW-T005: Widget só token + eventos seguros

**Files:**
- Modify: `apps/widget/src/main.tsx` — props Web Component apenas `embed-session-token` + `api-base-url`.
- Create: `apps/widget/src/embed-api.client.test.ts` (Vitest se configurado; senão planejar `pnpm --filter widget test`).

- [ ] **Step 1:** Test Vitest que lista headers enviados e garante ausência de chaves proibidas (`margin`, `cost`, `rules`, `cvv`, `card`).

- [ ] **Step 2:** Implementar cliente HTTP mínimo que envia `X-AACP-Embed-Token`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(widget): token-only bootstrap for embed checkout"
```

---

### Task SEW-T006: Cenários de segurança

**Files:**
- Create: `apps/api/src/modules/embed/presentation/http/embed-security.scenarios.spec.ts`

- [ ] **Step 1: Bateria `it`** — token expirado → 401; token mal formado → 401; cross-merchant (token válido sessão não pertence merchant do path se path tiver merchant — preferir sempre claims-only); replay (mesmo token duas vezes permitido apenas se semanticamente idempotente — documentar).

Matriz mínima:

```typescript
["expired_embed_token_returns_401",
 "missing_embed_token_returns_401",
 "tampered_embed_token_returns_401",
 "ignored_body_merchant_id_when_present"].forEach((name) => { /* cada it */ });
```

- [ ] **Step 2: Run** `pnpm --filter @aacp/api test -- embed-security`

- [ ] **Step 3: Commit**

```bash
git commit -m "test(embed): security scenario battery for public routes"
```

---

### Task SEW-T007: E2E embed stub

**Files:**
- Create: `apps/api/src/modules/embed/presentation/http/embed.e2e-spec.ts` (padrão similar a `checkout` e2e existentes)

- [ ] **Step 1:** Fluxo: login merchant → `POST /embed-sessions` → `POST /embed/start` com token → `POST /embed/track` com evento sintético.

- [ ] **Step 2:** Assert respostas não contêm objetos whole de regras comerciais.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(embed): stub e2e for token checkout flow"
```

---

## Cobertura de testes por camada

| Camada | Ficheiros |
|--------|-----------|
| Domain | `embed-token.service.spec.ts` |
| Application | `issue-embed-session.use-case.spec.ts` |
| HTTP | `embed-sessions.controller.spec.ts`, `embed-checkout.controller.spec.ts`, `embed-security.scenarios.spec.ts` |
| E2E | `embed.e2e-spec.ts` |
| Widget | `embed-api.client.test.ts` |
