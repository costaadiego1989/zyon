# ADR 0005 — Multi-tenant isolation com TenantContext + RLS opcional

- **Status:** aceito
- **Data:** 2026-05-09
- **Decisores:** Engenharia, Plataforma, Segurança
- **Relacionado:** [ADR 0001](./0001-modular-monolith-bounded-contexts.md), [ADR 0004](./0004-prisma-isolation-per-context.md)

## Contexto

`merchant_id` aparece em **toda** assinatura de método e em **toda**
tabela com `@@unique([merchantId, ...])` ou `@@index([merchantId, ...])`.
Mas isolamento real de tenant depende de:

1. o controller passar o `merchant_id` certo,
2. o use-case respeitar esse `merchant_id`,
3. o repositório filtrar pelo `merchant_id`.

Hoje só (1) é parcialmente protegido (no embed, via `EmbedAuthGuard`).
(2) e (3) dependem de disciplina dos devs. Não há:

- guard global validando que o `merchant_id` da request é o do JWT;
- middleware Prisma forçando `where: { merchantId }`;
- row-level security no Postgres;
- teste de fuzz cross-tenant.

Risco: um bug de aplicação ("esqueci de passar `merchantId` no `findFirst`")
permite vazamento entre lojas.

## Decisão

### 5.1 TenantContext via `AsyncLocalStorage`

```ts
// apps/api/src/shared/tenant/tenant-context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantSnapshot {
  merchantId: string;
  userId?: string;            // merchant operator
  buyerGlobalUserId?: string; // buyer
  role: "merchant_admin" | "merchant_operator" | "buyer" | "embed";
  embedSessionToken?: string;
  correlationId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantSnapshot>();

export function currentTenant(): TenantSnapshot {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error("TenantContext not initialized");
  return ctx;
}
```

### 5.2 `TenantContextMiddleware` global

Para cada request HTTP:

1. Lê JWT (operator), embed token (buyer/widget) ou rejeita rotas privadas sem credencial.
2. Resolve `merchantId` (do JWT ou do embed token) e `correlationId` (header `x-correlation-id` ou novo UUID).
3. Encapsula `next()` em `tenantStorage.run(ctx, next)`.

Rotas públicas (`/auth/*`, `/embed/start`, `/health`) ficam fora do guard via `@PublicRoute()`.

### 5.3 `TenantGuard` declarativo

Decorator `@CurrentTenant()` injeta o `TenantSnapshot` nos use-cases que
precisam (ou eles chamam `currentTenant()` diretamente). Decorator
`@RequireRole("merchant_admin")` valida role.

Validação cruzada: se a request tem `merchantId` no body/path **e** o
tenant resolvido é diferente, retornamos `403`.

### 5.4 Middleware Prisma de tenant filter (opt-in por modelo)

```ts
prisma.$use(async (params, next) => {
  const tenant = tenantStorage.getStore();
  if (!tenant || !MODELS_WITH_TENANT.has(params.model ?? "")) {
    return next(params);
  }

  if (["findFirst", "findMany", "findUnique", "count", "aggregate", "groupBy"].includes(params.action)) {
    params.args.where = { ...(params.args.where ?? {}), merchantId: tenant.merchantId };
  }
  if (params.action === "create") {
    params.args.data = { ...params.args.data, merchantId: tenant.merchantId };
  }
  if (params.action === "update" || params.action === "delete") {
    params.args.where = { ...(params.args.where ?? {}), merchantId: tenant.merchantId };
  }
  return next(params);
});
```

`MODELS_WITH_TENANT` é a lista explícita de tabelas escopadas — não
queremos middleware acidental nos modelos globais (`Coupon` global,
catálogo de scraping, etc.).

### 5.5 Postgres RLS (opcional, atrás de feature flag)

Para tenants enterprise que exijam *defense in depth*, ativamos
Row-Level Security:

```sql
ALTER TABLE checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON checkout_sessions
  USING (merchant_id = current_setting('aacp.merchant_id'));
```

E o middleware Prisma faz `SET LOCAL aacp.merchant_id = $1` no início
de cada transação.

Esse é o **última camada** — proteção contra bug de aplicação. Habilitamos
quando o Postgres suportar (managed services como RDS suportam).

### 5.6 Teste de fuzz cross-tenant

Suite obrigatória `apps/api/test/cross-tenant-fuzz.e2e-spec.ts`:

- Criar 2 merchants (`mrc_alpha`, `mrc_beta`), cada um com 5 sessões.
- 1000 requests aleatórias misturando JWT do `alpha` com `merchantId` do
  `beta` e vice-versa. Aceitar somente as combinações coerentes.
- Métricas: 0 vazamento; tempo médio < 50 ms.

## Alternativas consideradas

- **Apenas guard manual em controllers:** atual; depende de disciplina.
- **Banco por tenant (database-per-tenant):** zero vazamento físico,
  mas custo operacional explode para escala SaaS.
- **Schema-per-tenant:** intermediário, mas com hot-spot de migrations.
- **TenantContext + middleware Prisma + RLS opcional (decidida):**
  tem 3 camadas de defesa, custo de implementação alto **uma vez**.

## Consequências

**Positivas:**
- Cobertura por padrão; impossível esquecer `merchantId` em uma query nova.
- Testes de domínio ficam mais limpos (não precisam passar `merchantId`
  toda hora; é o contexto).
- RLS opcional como vantagem comercial p/ contas enterprise.

**Negativas:**
- Devs precisam aprender a invariante (correlation id e merchantId
  vêm do contexto, não do parâmetro).
- Debugar fica um pouco mais difícil sem ALS (o erro "TenantContext
  not initialized" aparece em testes mal configurados).

## Plano de adoção

- Onda 4 do roadmap.
- Sequência:
  1. Implementar `TenantContextModule` + middleware.
  2. Cobrir rotas existentes; marcar públicas com `@PublicRoute()`.
  3. Cross-tenant fuzz test.
  4. Habilitar tenant filter Prisma.
  5. Rollout RLS atrás de flag para 1 merchant piloto.
