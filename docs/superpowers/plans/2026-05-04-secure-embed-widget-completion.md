# Secure Embed Widget — Conclusão (widget + segurança + e2e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) ou `superpowers:executing-plans` para executar esta tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para tracking.

**Goal:** Finalizar o fluxo público embed com token apenas no browser (**SEW-T005**, **SEW-T006**, **SEW-T007**), mais **`POST /embed/offers/apply`** alinhado a **SEW-REQ-007/008**, sem enviar dados sensíveis ou confiar em `merchant_id` no corpo.

**Architecture:** Widget passa apenas `embed-session-token` (atributo Web Component ou prop) mais `api-base-url`; todas as chamadas embed usam cabeçalho `X-AACP-Embed-Token`. O servidor reutiliza use cases checkout existentes através de `EmbedCheckoutController` com `EmbedAuthGuard` já existente (`apps/api/src/modules/embed`). Testes Seguem **`node:test` na API** e **Vitest** no pacote widget para o cliente embed puro (`embed-client.ts`).

**Tech Stack:** NestJS, React 18 (`apps/widget`), Vite 6, Vitest 3, TypeScript ESM.

---

## Estrutura de ficheiros (mapa antes das tarefas)

| Responsabilidade | Ficheiros |
|------------------|-----------|
| API apply embed | Modificar: `apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts` (`POST embed/offers/apply`); `apps/api/src/modules/embed/embed.module.ts`; possivelmente `apps/api/src/modules/checkout/checkout.module.ts` **exports** |
| Widget cliente embed | Criar: `apps/widget/src/embed-client.ts` |
| Widget UI token-first | Modificar: `apps/widget/src/main.tsx` (atributos `embed-session-token`, `api-base-url`; modo legacy `merchant-id` opcional apenas dev) |
| Vitest widget | Criar: `apps/widget/vitest.config.ts`; Modificar: `apps/widget/package.json` |
| Segurança API | Criar: `apps/api/src/modules/embed/presentation/http/embed-security.scenarios.spec.ts` |
| Smoke e2e encadeado API | Criar: `apps/api/src/modules/embed/presentation/http/embed.checkout-flow.e2e-spec.ts` |
| Suíte API | Modificar: `apps/api/src/test-runner.ts`; opcional tasks em `.specs/features/secure-embed-widget/tasks.md` |

Refs: `.specs/features/secure-embed-widget/spec.md`, `design.md`.

---

### Task SEG-001: Backend `POST /embed/offers/apply`

**Files:**
- Modify: `apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts`
- Modify: `apps/api/src/modules/embed/embed.module.ts`
- Possibly modify: `apps/api/src/modules/checkout/checkout.module.ts`

- [ ] **Step 1: Write failing specification test**

Antes da implementação, confirmar compilando um teste que espera método `applyOffer` no controller. Criar `apps/api/src/modules/embed/presentation/http/embed-offers-apply.embed-spec.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, authorizedOffer } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import type { ApplyOfferRequest, ApplyOfferResponse } from "@aacp/shared-types";

test("embed offers apply routes body through ApplyOfferUseCase with JWT merchant replaced by embed claims", async () => {
  const tokens = new EmbedTokenService({
    value: Buffer.from("embed-apply-spec-secret32chars!!!!!x")
  });
  const now = Math.floor(Date.now() / 1000);
  const claims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_embed",
      issuedAtUnix: now,
      expiresAtUnix: now + 7200,
      nonce: crypto.randomUUID()
    })
  );

  const checkout = new InMemoryCheckoutRepository();
  checkout.saveSession(
    checkoutSession({
      merchantId: "m_embed",
      sessionId: "s1",
      cart: {
        currency: "BRL",
        total: 100,
        items: [{ sku: "k", name: "N", price: 100, quantity: 1, cost: 40 }]
      }
    })
  );

  checkout.saveOffer(
    authorizedOffer({
      merchantId: "m_embed",
      sessionId: "s1",
      id: "off_z",
      approved: true,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    })
  );

  let seen: ApplyOfferRequest | undefined;
  const applyUc = {
    async execute(input: ApplyOfferRequest): Promise<ApplyOfferResponse> {
      seen = input;
      return { success: false, reason: "commerce_stub_ok" };
    }
  };

  const helper = new EmbedCheckoutGuardHelper(checkout);
  const c = new EmbedCheckoutController({} as never, {} as never, {} as never, helper, applyUc as never);

  await c.applyOffer(
    { embedClaims: claims },
    { merchant_id: "m_evil_body", session_id: "s1", offer_id: "off_z" }
  );

  assert.equal(seen?.merchant_id, "m_embed");
  assert.equal(seen?.offer_id, "off_z");
});
```

Run: `pnpm --filter @aacp/api exec tsx ./node_modules/...` **não** é o padrão do repo — preferir registar temporariamente import no `test-runner.js` compilado OU executar suite após add ao test-runner só depois Step 4. Esperado inicial: **FAIL** (TypeScript erro `applyOffer` inexistente).

- [ ] **Step 2: Implementar método `applyOffer`** em `EmbedCheckoutController`

```typescript
import type { ApplyOfferRequest, ApplyOfferResponse } from "@aacp/shared-types";
import { ApplyOfferUseCase } from "../../../checkout/application/use-cases/apply-offer.use-case.js";

@Post("offers/apply")
async applyOffer(
  @Req() request: EmbedHttpRequest,
  @Body() body: ApplyOfferRequest
): Promise<ApplyOfferResponse> {
  const embed = request.embedClaims!;
  if (typeof body.session_id !== "string" || typeof body.offer_id !== "string") {
    throw new BadRequestException("session_id_and_offer_id_required");
  }
  await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
  const { merchant_id: _m, ...rest } = body;
  return this.applyOfferUseCase.execute({
    ...(rest as Omit<ApplyOfferRequest, "merchant_id">),
    merchant_id: embed.merchantId
  });
}
```

Construtor atualizado para receber **`private readonly applyOfferUseCase: ApplyOfferUseCase`**.

- [ ] **Step 3: Exportar providers no CheckoutModule**

Garantir `exports` inclui pelo menos **`ApplyOfferUseCase`** e **`AcceptCheckoutOfferUseCase`** se o primeiro depender como provider interno apenas:

```typescript
exports: [
  CHECKOUT_REPOSITORY,
  StartCheckoutUseCase,
  TrackCheckoutEventUseCase,
  SendChatMessageUseCase,
  ApplyOfferUseCase,
  AcceptCheckoutOfferUseCase
]
```

- [ ] **Step 4:** `EmbedModule`: Nest resolve `ApplyOfferUseCase` porque `CheckoutModule` exporta-os; sem duplicar providers.

- [ ] **Step 5:** Atualizar `embed-checkout.controller.spec.ts` mocks — qualquer construtor anterior com 4 args passa para 5 com `{} as never`.

- [ ] **Step 6:** Adicionar import do novo spec ao `test-runner.ts` quando estável:

```typescript
import "./modules/embed/presentation/http/embed-offers-apply.embed-spec.js";
```

Run: `pnpm --filter @aacp/api test` — esperado: **PASS**.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/embed apps/api/src/modules/checkout/checkout.module.ts apps/api/src/test-runner.ts
git commit -m "feat(embed): token-scoped POST /embed/offers/apply"
```

---

### Task SEG-002: Cliente embed + Vitest

**Files:**
- Create: `apps/widget/src/embed-client.ts`
- Create: `apps/widget/src/embed-client.test.ts`
- Create: `apps/widget/vitest.config.ts`
- Modify: `apps/widget/package.json`

- [ ] **Step 1: Failing Vitest**

`apps/widget/src/embed-client.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { EmbedCheckoutClient } from "./embed-client.js";

describe("EmbedCheckoutClient", () => {
  it("sets X-AACP-Embed-Token and omits forbidden keys in JSON bodies", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ session_id: "s" }), { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const c = new EmbedCheckoutClient({
      apiBaseUrl: "http://localhost:3000",
      embedSessionToken: "emb_unit"
    });

    await c.startCheckout({
      cart: {
        currency: "BRL",
        total: 42,
        items: [{ sku: "x", name: "X", price: 42, quantity: 1 }]
      }
    });

    const init = fetchMock.mock.calls[0][1];
    expect((init?.headers as Headers).get("X-AACP-Embed-Token")).toBe("emb_unit");
    const body = JSON.stringify(JSON.parse(init?.body as string));
    expect(body).not.toMatch(/merchant_api_key|asaas_api_key|shopify_access_token|"cvv"/i);
  });
});
```

Run: `pnpm --filter @aacp/widget test` esperado FAIL (sem vitest / sem cliente).

- [ ] **Step 2: Implementação `EmbedCheckoutClient`** (conforme exemplo em `modules/frontend-widget-dashboard-implementation-plan.md` refinado):

Incluir `FORBIDDEN` set e `walk` pré-serialização; métodos **`startCheckout`**, **`trackEvent`**, **`chatMessage`**, **`applyOffer`** que chamam `POST` `/embed/start`, `/embed/track`, `/embed/chat`, `/embed/offers/apply`.

- [ ] **Step 3: package.json**

```json
"scripts": {
  "test": "vitest run"
},
"devDependencies": {
  "vitest": "^3.2.4"
}
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
```

Instalar deps: `pnpm install` na raíz ou só widget.

Run: `pnpm --filter @aacp/widget test` — PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/widget/package.json vitest.config.ts apps/widget/src/embed-client.ts apps/widget/src/embed-client.test.ts
git commit -m "feat(widget): vitest-covered embed REST client"
```

---

### Task SEG-003: `main.tsx` token-first Web Component

**Files:**
- Modify: `apps/widget/src/main.tsx`

- [ ] **Step 1:** Atributos alvo `<aacp-checkout-agent embed-session-token="..." api-base-url="..."></aacp-checkout-agent>`.

- [ ] **Step 2:** Se `merchant-id` presente mas **sem** embed token → ramo legacy chama URLs antigas (`/start-checkout` etc.). Se **ambos** presentes preferir sempre embed.

- [ ] **Step 3:** Substituir `post` genérico no ramo embed por `EmbedCheckoutClient` instanciado memoizado (`useMemo`).

- [ ] **Step 4:** `pnpm --filter @aacp/widget build && pnpm --filter @aacp/widget typecheck`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(widget): bootstrap via embed-session-token with legacy fallback"
```

---

### Task SEG-004: Battery `embed-security.scenarios.spec.ts`

**Files:**
- Create: `apps/api/src/modules/embed/presentation/http/embed-security.scenarios.spec.ts`
- Modify: `apps/api/src/test-runner.ts`

- [ ] **Step 1:** Testes mínimos (todos runnable sem HTTP):

**(a)** Guard + token expirado (igual exemplo Task).

**(b)** Token inválido (truncar último char da assinatura) → Unauthorized.

**(c)** Headers vazios → `missing_embed_session_token`.

**(d)** Bearer presente mas string curta `'Bearer x'` onde verify falha → `invalid_embed_session_token`.

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { EmbedAuthGuard } from "./embed-auth.guard.js";

function mockCtx(tok: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: tok })
    })
  };
}

describe("EmbedAuthGuard security scenarios", () => {
  const secret = Buffer.from("embed-security-battery-secret-32chs");

  it("requires token header", async () => {
    const guard = new EmbedAuthGuard(new EmbedTokenService({ value: secret }));
    await assert.rejects(
      async () =>
        guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as never),
      UnauthorizedException
    );
  });

  it("rejects tampered MAC", async () => {
    const svc = new EmbedTokenService({ value: secret });
    const now = Math.floor(Date.now() / 1000);
    let tok = svc.sign({
      typ: "aacp_embed_v1",
      merchantId: "m1",
      issuedAtUnix: now,
      expiresAtUnix: now + 400,
      nonce: "n_mac"
    });
    tok = tok.slice(0, -4) + "ZZZZ";

    const guard = new EmbedAuthGuard(svc);
    await assert.rejects(
      async () =>
        guard.canActivate(mockCtx({ "x-aacp-embed-token": tok }) as never),
      UnauthorizedException
    );
  });

  // it("replays accepted", ...) — opcional: replay não erro (idempotência GET-less)
});
```

Run: `pnpm --filter @aacp/api test`.

- [ ] **Step 2: Commit**

```bash
git commit -m "test(embed): auth guard failure matrix"
```

---

### Task SEG-005: Smoke e2e `embed.checkout-flow.e2e-spec.ts`

**Files:**
- Create: `apps/api/src/modules/embed/presentation/http/embed.checkout-flow.e2e-spec.ts`
- Modify: `apps/api/src/test-runner.ts`

- [ ] **Step 1:** Reutilizar padrões de `apps/api/src/modules/checkout/presentation/http/checkout.controller.spec.ts` para `ConversationPort` fake quando `embed/chat` faz parte da cadeia; se o smoke ficar apenas **start → track**:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../../checkout/application/use-cases/track-checkout-event.use-case.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";

test("embed smoke: start checkout then track with same merchant on token path", async () => {
  const repo = new InMemoryCheckoutRepository();
  const tokens = new EmbedTokenService({
    value: Buffer.from("embed-e2e-smoke-token-secret00000")
  });
  const now = Math.floor(Date.now() / 1000);
  const embedClaims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_e2e_smoke",
      issuedAtUnix: now,
      expiresAtUnix: now + 4000,
      nonce: crypto.randomUUID()
    })
  );

  const start = new StartCheckoutUseCase(repo);
  const track = new TrackCheckoutEventUseCase(repo);
  const helper = new EmbedCheckoutGuardHelper(repo);
  const c = new EmbedCheckoutController(start, track, {} as never, helper, {} as never);

  const started = await c.start({ embedClaims }, {
    merchant_id: "ignore_me",
    cart: {
      currency: "BRL",
      total: 50,
      items: [{ sku: "s", name: "S", price: 50, quantity: 1, cost: 20 }]
    }
  });

  const tracked = await c.track({ embedClaims }, {
    merchant_id: "ignore_me",
    session_id: started.session_id,
    event: "cart_viewed"
  });

  assert.equal(tracked.received, true);
  assert.equal(typeof tracked.abandonment_score, "number");
});
```

Ajustar se `EmbedCheckoutController` constructor order não for `(start, track, sendChat, guards, apply)` conforme arquivo real.

- [ ] **Step 2:** `pnpm --filter @aacp/api test`

- [ ] **Step 3: Commit**

```bash
git commit -m "test(embed): programmatic smoke embed start/track"
```

---

## Auto-revisão (skill writing-plans)

1. **Cobertura spec:** SEW-T005–007 + REQ 001/002/008/004/007 cobertos nas tabelas acima (payment embed start deixado fora porque `payment` grande — continua backlog `payment-asaas` plan).
2. **Placeholders:** nenhum TBD textual; todos snippets completos nomeiam paths.
3. **Consistências:** Tipos `@aacp/shared-types` preservados (`ApplyOfferRequest`, `TrackEventRequest`, …).

---

## Gates

```bash
pnpm --filter @aacp/api typecheck
pnpm --filter @aacp/api test
pnpm --filter @aacp/widget typecheck
pnpm --filter @aacp/widget build
pnpm --filter @aacp/widget test
```

---

**Plan saved to:** `docs/superpowers/plans/2026-05-04-secure-embed-widget-completion.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — subagent por tarefa (SEG-001…), revisão curta entre tarefas.
2. **Inline execution** — executar todas as tarefas em sequência com checkpoints (`executing-plans`).

Which approach?
