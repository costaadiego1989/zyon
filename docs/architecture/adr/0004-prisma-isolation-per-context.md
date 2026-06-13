# ADR 0004 — Prisma client em PersistenceModule global

- **Status:** aceito
- **Data:** 2026-05-09
- **Decisores:** Engenharia, Plataforma
- **Relacionado:** [ADR 0001](./0001-modular-monolith-bounded-contexts.md), [ADR 0005](./0005-multi-tenant-isolation.md)

## Contexto

Hoje:

```ts
// apps/api/src/modules/auth/auth.module.ts            ← faz isso
// apps/api/src/modules/merchant/merchant.module.ts    ← faz isso
// apps/api/src/modules/agent-rules/agent-rules.module.ts
// apps/api/src/modules/buyer-purchase-history/...
// apps/api/src/modules/checkout-settings/...
// apps/api/src/modules/negotiation/...
// apps/api/src/modules/payment/...
import { createPrismaClient } from "../checkout/infrastructure/prisma/prisma-client.js";
```

7 contextos importam o cliente do `checkout`. Isso faz do `checkout` o
container de infraestrutura compartilhada, viola o princípio de boundaries
e impede mover qualquer um dos 7 contextos para serviço próprio
(eles passariam a importar `checkout/...` de fora).

Adicionalmente, cada `useFactory` cria uma nova instância:

```ts
provide: PAYMENT_REPOSITORY,
useFactory: (memory: InMemoryPaymentRepository) => {
  if (process.env.CHECKOUT_REPOSITORY === "prisma") {
    return new PrismaPaymentRepository(createPrismaClient());  // ← nova conexão
  }
  return memory;
},
```

Isso pode (em produção) abrir múltiplos pools, esgotar conexões ou
gerar mismatch entre transações. Hoje só não dá problema porque
`createPrismaClient` retorna singleton — mas o contrato não está claro.

## Decisão

Criar `apps/api/src/shared/persistence/persistence.module.ts` como módulo
global Nest:

```ts
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PersistenceModule {}
```

`PrismaService extends PrismaClient` com `onModuleInit` (`$connect`),
`onModuleDestroy` (`$disconnect`), middleware de tenant (ver ADR 0005)
e middleware de query log/observability.

Path alias `@app/persistence` para imports curtos:

```json
// tsconfig.base.json
"paths": {
  "@app/persistence": ["apps/api/src/shared/persistence/index.ts"],
  "@app/messaging":   ["apps/api/src/shared/messaging/index.ts"],
  "@app/observability":["apps/api/src/shared/observability/index.ts"],
  "@app/http":        ["apps/api/src/shared/http/index.ts"],
  "@app/tenant":      ["apps/api/src/shared/tenant/index.ts"]
}
```

Cada repositório passa a injetar:

```ts
@Injectable()
export class PrismaCheckoutRepository implements CheckoutSessionRepository {
  constructor(private readonly prisma: PrismaService) {}
  // ...
}
```

E o módulo registra **apenas** seus repositórios:

```ts
@Module({
  imports: [],   // PersistenceModule é @Global, não precisa importar
  providers: [
    {
      provide: CHECKOUT_SESSION_REPOSITORY,
      useClass: process.env.CHECKOUT_REPOSITORY === "prisma"
        ? PrismaCheckoutSessionRepository
        : InMemoryCheckoutSessionRepository,
    },
  ],
})
export class CheckoutModule {}
```

## Schema lógico por contexto, schema físico único (por enquanto)

Continuamos com **um único banco e um único `schema.prisma`** mas
organizamos o arquivo por contexto:

```prisma
// === identity ===
model MerchantUser { ... }
model BuyerUser    { ... }       // novo

// === merchant ===
model Merchant     { ... }

// === agent-rules ===
model AgentRule    { ... }

// === checkout-settings ===
model CheckoutSetting { ... }

// === buyer-purchase-history ===
model BuyerPurchaseRecord { ... }

// === checkout (split) ===
model CheckoutSession   { ... }
model CheckoutEvent     { ... }
model AuthorizedOffer   { ... }
model AcceptedOffer     { ... }
model CompletedOrder    { ... }
model CheckoutIntervention { ... }
model BuyerIdentity     { ... }   // mover para identity na Onda 4

// === messaging ===
model OutboxMessage     { ... }
model OutboxMessageDLQ  { ... }   // novo

// === negotiation ===
model MerchantNegotiationPolicy           { ... }
model BuyerAgentNegotiationPreference     { ... }
model NegotiationSession                  { ... }
model NegotiationCostLedgerEntry          { ... }

// === payment ===
model PaymentIntent      { ... }
model PaymentProviderEvent { ... }

// === fulfillment === (NEW)
model Shipment           { ... }
model TrackingEvent      { ... }

// === cross-sell === (NEW)
model CrossSellPromotion { ... }

// === coupons === (NEW)
model Coupon             { ... }
model CouponRedemption   { ... }

// === self-checkout === (NEW)
model BuyerWallet        { ... }
model BuyerSavedAddress  { ... }
model BuyerSavedPaymentMethod { ... }
model BuyerCheckoutTemplate { ... }

// === scraping === (NEW)
model PriceQuoteJob      { ... }
model PriceQuoteResult   { ... }
```

Quando um contexto for extraído, levamos as tabelas dele para o banco do
serviço novo (Prisma `multiSchema` ou novo banco). A arquitetura permite
ambos os caminhos.

## Alternativas consideradas

- **Schemas Postgres separados (`prisma multiSchema`)** — boa ideia
  para amanhã (extração); decidimos não pagar agora porque não há
  benefício imediato.
- **Banco por contexto desde já** — overkill; complica transações
  cross-aggregate que ainda usamos no checkout.
- **Manter o cliente no checkout** — mantém o problema.

## Consequências

**Positivas:**
- Imports cross-context para `checkout/infrastructure/prisma` zerados.
- Cada contexto pode ser movido para `multiSchema` ou banco próprio
  trocando uma porta.
- Middleware Prisma central permite logging, tenant filter, soft delete uniforme.

**Negativas:**
- Uma migração mecânica em 7 módulos.
- Path alias requer ajuste em ESM/CJS interop e tsconfig de cada app.

## Plano de adoção

- Onda 1 do roadmap.
- Sequência:
  1. Criar `PersistenceModule` + `PrismaService`.
  2. Adicionar path aliases no `tsconfig.base.json` + `tsconfig.json` de cada app.
  3. Substituir os 7 imports por `@app/persistence`.
  4. Apagar `apps/api/src/modules/checkout/infrastructure/prisma/prisma-client.ts`.
  5. CI gate `grep -rn "modules/checkout/infrastructure/prisma" apps/api/src` retorna 0.
