# ADR 0001 — Modular Monolith com Bounded Contexts

- **Status:** aceito
- **Data:** 2026-05-09
- **Decisores:** Engenharia de Plataforma
- **Contexto:** referencia [`../refactor-plan.md`](../refactor-plan.md) e [`../bounded-contexts.md`](../bounded-contexts.md)

## Contexto

A AACP é vendida hoje como um único deployable (NestJS API + dois front-ends).
A pressão por novas features (cross-sell, self-checkout, scraping, novas
transportadoras) tornou tentador quebrar prematuramente em microsserviços.
Por outro lado, o monólito atual já apresenta acoplamentos fortes
(Prisma client centralizado, use-cases injetando use-cases de outros
contextos) que precisam ser endereçados antes de qualquer extração.

## Decisão

Adotamos formalmente o padrão **Modular Monolith com Bounded Contexts**
como destino de médio prazo (12–18 meses), com cada contexto preparado
para extração futura sem refactor de domínio.

Características obrigatórias:

1. Cada contexto tem `domain/`, `application/`, `infrastructure/`,
   `presentation/` (camadas Clean Architecture).
2. Comunicação cross-context **somente** via:
   - portas públicas re-exportadas em `{contexto}.module.ts`, ou
   - eventos no EventBus/Outbox (preferível para escrita).
3. Cada contexto tem um único schema lógico no Postgres
   (mesmo cluster por enquanto). Migrations são por contexto.
4. Linter de boundaries (`eslint-plugin-boundaries` + regra própria)
   bloqueia imports cross-context fora das duas formas acima.

## Alternativas consideradas

### A. Microsserviços imediatos
- ❌ Custo operacional alto (Kafka/Rabbit, k8s, descoberta).
- ❌ Equipe atual não tem maturidade SRE para isso.
- ❌ Latência LLM já ajusta o p95 — adicionar saltos de rede só piora.

### B. Manter como está (monolito clássico)
- ❌ Acoplamentos fortes já visíveis (10+ imports cross-module).
- ❌ Impossível extrair contextos para times separados sem freeze.

### C. Modular Monolith (decidida)
- ✅ Mantém um deployable, baixa complexidade ops.
- ✅ Permite split futuro com baixíssimo custo de refactor de domínio.
- ✅ Permite testes E2E rápidos.

## Consequências

**Positivas:**
- Boundaries explicitamente codificadas (lint + ADR + módulo NestJS).
- Caminho de migração para microsserviços fica como decisão futura *informada*, não como acidente.
- Times podem ser re-organizados por contexto.

**Negativas:**
- Custo de pôr em ordem o módulo `checkout` (ver [refactor-plan §6 Onda 2](../refactor-plan.md)).
- Risco de "monólito modular no nome, espaguete na prática" se o lint não for enforcado em CI desde já.

## Plano de adoção

- Onda 0 do roadmap: lint, CI gate, ADR aprovado.
- Onda 1: `PersistenceModule`.
- Onda 2: split do `CheckoutRepository`.
- Onda 3: EventBus + Outbox dispatcher.
- Reavaliar após Onda 7 (novas features) se vale extrair `scraping-agent`
  ou `fulfillment` para serviço próprio (ambos com perfil de carga muito
  diferente do checkout).
