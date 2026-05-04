# Frontend Widget and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir `apps/widget` (Web Component / React mount) para consumir apenas rotas embed token-only quando disponíveis, e `apps/dashboard` para login merchant, navegação básica, gestão incremental de agent rules/checkout-settings/negociação conforme APIs existentes.

**Architecture:** Chamadas REST com credentials via cookie/session API existente (`aacp_access_token`); widgets embed usam apenas `embed_session_token` + `API_BASE`; nenhuma chave de provider ou margin no cliente; componentes funcionais minimalistas até design system aparecer.

**Tech Stack:** React 18+, Vite, Vitest + Testing Library opcional para componentes (`apps/widget/package.json`, `apps/dashboard/package.json`).

---

### Task FEW-T001: Configuração Vitest nos apps

**Files:**
- Modify: `apps/widget/package.json`, `apps/dashboard/package.json` — add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`
- Create: `apps/widget/vitest.config.ts`, `apps/dashboard/vitest.config.ts`

- [ ] Scripts `pnpm --filter widget test` e idem dashboard.

Commit: `chore(widget,dashboard): add vitest baseline`

---

### Task FEW-T002: Cliente embed sem secrets

**Files:**
- Create: `apps/widget/src/embed-client.ts`
- Create: `apps/widget/src/embed-client.spec.ts`

```typescript
export type EmbedClientConfig = {
  apiBaseUrl: string;
  embedSessionToken: string;
};

export class EmbedCheckoutClient {
  constructor(private cfg: EmbedClientConfig) {}

  headers() {
    return {
      "Content-Type": "application/json",
      "X-AACP-Embed-Token": this.cfg.embedSessionToken
    };
  }

  async startCheckout(body: { session_hint?: string }) {
    const res = await fetch(`${this.cfg.apiBaseUrl}/embed/start`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`start_failed:${res.status}`);
    return await res.json();
  }
}
```

- [ ] **Test Vitest:** `expect(JSON.stringify(headers)).not.toContain("ASAAS")` e não contém campo `merchant_api_key`.

Commit: `feat(widget): typed embed checkout client`

---

### Task FEW-T003: Web component wrapper

**Files:**
- Modify: `apps/widget/src/main.tsx` — ler atributos `embed-session-token` e `api-base-url`, montar raiz chat + event sender stub.

Commit: `feat(widget): wc attributes for embed session`

---

### Task FED-T001: API client dashboard autenticado

**Files:**
- Create: `apps/dashboard/src/api-client.ts` — todas as rotas `{ credentials: "include" }`.
- Create: `apps/dashboard/src/api-client.spec.ts`

- [ ] Test mock fetch garante URLs relativas configuráveis e sem env vars secretas inlined.

Commit: `feat(dashboard): cookie-auth api client`

---

### Task FED-T002: Páginas stub orientadas aos módulos

**Files:**
- Create: `apps/dashboard/src/pages/RulesPage.tsx` — lista `GET /merchants/me/rules`
- Create: `apps/dashboard/src/pages/CheckoutSettingsPage.tsx` — `GET/PUT /checkout-settings`
- Create: `apps/dashboard/src/pages/NegotiationPage.tsx` — `POST /negotiations/evaluate` formulário técnico
- Modify: router em `apps/dashboard/src/main.tsx`

Commits per page.

---

### Task FED-T003: Smoke e2e browser (opcional)

**Files:**
- Planejar usando Playwright MCP depois quando API dev up — documentar apenas neste milestone com comando `pnpm dlx playwright test dashboard-smoke.spec.ts`.

Commit skip se não automatizar já: `docs(dashboard): note future playwright smoke`

---

## Bateria de testes (matriz obrigatória)

| Suite | Casos principais |
|-------|-------------------|
| `embed-client.spec.ts` | headers; redact forbidden keys na serialização opcional debug |
| `api-client.spec.ts` | sempre `credentials: include` |
| `RulesPage.tsx` test | erro 401 tratado |

**Gates:**

- `pnpm --filter widget build`
- `pnpm --filter dashboard build`
- `pnpm --filter widget test`
