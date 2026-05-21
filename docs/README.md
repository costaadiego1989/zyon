# Documentação AACP

Índice da documentação técnica da plataforma. Cada seção tem
um README/spec dedicado; este arquivo é só o ponto de entrada.

## 1. Arquitetura

Como o sistema é montado e para onde está indo.

| Documento | Conteúdo |
| --------- | -------- |
| [`architecture-clean-ddd.md`](./architecture-clean-ddd.md) | Princípios de Clean Architecture e DDD adotados (existente). |
| [`architecture/refactor-plan.md`](./architecture/refactor-plan.md) | Plano de refactor: estado atual, problemas, alvo, ondas de migração, métricas. |
| [`architecture/bounded-contexts.md`](./architecture/bounded-contexts.md) | Mapa de contextos, eventos, ACL, proibições. |
| [`architecture/widget-architecture.md`](./architecture/widget-architecture.md) | Arquitetura atual do widget e roadmap (split de hooks, Shadow DOM, telemetria, Playwright). |

### ADRs

| ADR | Tema |
| --- | ---- |
| [`adr/0001-modular-monolith-bounded-contexts.md`](./architecture/adr/0001-modular-monolith-bounded-contexts.md) | Adoção formal do modular monolith. |
| [`adr/0002-acl-pattern-cross-context.md`](./architecture/adr/0002-acl-pattern-cross-context.md) | Padrão ACL cross-context e wrapper HttpClient. |
| [`adr/0003-event-bus-and-transactional-outbox.md`](./architecture/adr/0003-event-bus-and-transactional-outbox.md) | EventBus em-process + Outbox dispatcher. |
| [`adr/0004-prisma-isolation-per-context.md`](./architecture/adr/0004-prisma-isolation-per-context.md) | Mover Prisma client para `PersistenceModule` global. |
| [`adr/0005-multi-tenant-isolation.md`](./architecture/adr/0005-multi-tenant-isolation.md) | TenantContext (ALS) + middleware Prisma + RLS opcional. |

## 2. Testes

| Documento | Conteúdo |
| --------- | -------- |
| [`testing/test-strategy.md`](./testing/test-strategy.md) | Pirâmide de testes, gaps, baterias E2E do widget (Playwright), contract tests, mutation testing, pipelines de CI. |

## 3. Features novas

Cada documento abaixo é um spec que entra em `.specs/features/<nome>/`
para ser quebrado em tasks atômicas.

| Feature | Doc |
| ------- | --- |
| Cross-sell + Upsell + Cupons | [`features/cross-sell-and-coupons.md`](./features/cross-sell-and-coupons.md) |
| Self-Checkout do Comprador (Wallet + Templates) | [`features/buyer-self-checkout.md`](./features/buyer-self-checkout.md) |
| Agente de Cotação Multi-Fonte (Scraping) | [`features/price-scraping-agent.md`](./features/price-scraping-agent.md) |
| Métodos de Entrega + Fulfillment | [`features/delivery-and-fulfillment.md`](./features/delivery-and-fulfillment.md) |

## 4. Produto

| Documento | Conteúdo |
| --------- | -------- |
| [`product/mvp-gap-closure.md`](./product/mvp-gap-closure.md) | Lacunas abertas para fechar o MVP e plano de execucao por checkout, frete, hub, suporte e operacao. |
| [`product/agentic-checkout-differentiation.md`](./product/agentic-checkout-differentiation.md) | Posicionamento e diferenciação. |
| [`product/premium-widget-ui-system.md`](./product/premium-widget-ui-system.md) | Sistema de UI premium do widget. |

## 5. Integrações

| Documento | Conteúdo |
| --------- | -------- |
| [`integrations/checkout-widget-and-api.md`](./integrations/checkout-widget-and-api.md) | Snippets, payloads, requisitos para clientes integrarem (embed UI ou API-only). |

## 6. Material histórico (superpowers)

Plans existentes com histórico do MVP estão em [`superpowers/`](./superpowers/). Servem como contexto, não como verdade atual.

## 7. Como navegar

**Quero entender o todo →** comece por [`architecture/refactor-plan.md`](./architecture/refactor-plan.md), depois [`architecture/bounded-contexts.md`](./architecture/bounded-contexts.md).

**Vou implementar uma feature →** abra o doc da feature em [`features/`](./features/) + a estratégia de testes.

**Vou trabalhar no widget →** [`architecture/widget-architecture.md`](./architecture/widget-architecture.md) + os ADRs 0003 e 0005.

**Vou refatorar a infraestrutura →** ADRs 0001/0003/0004/0005 + Onda 1 do refactor-plan.

## 8. Convenções

- Documentos vivos. Toda mudança não trivial em arquitetura passa por ADR novo.
- Toda feature tem doc próprio antes do código (segue
  [`architecture-clean-ddd.md` § Spec-Driven Workflow](./architecture-clean-ddd.md)).
- Eventos de domínio têm schema versionado em
  [`bounded-contexts.md` §4](./architecture/bounded-contexts.md). Mudança breaking exige bump
  do `schema_version` + co-existência de pelo menos uma release.
