# ADR 0021 — Pós-piloto: self-checkout e scraping-agent

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia, Produto
- **Relacionado:** [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md). Baseline: `.specs/maturity/self-checkout.md`, `.specs/maturity/scraping-agent.md`.

## Contexto

Dois módulos **P4 — expansão pós-piloto** (ADR 0007), a fechar **conforme
demanda comprovada**, sem atrasar P0/P1:

- `self-checkout` — **L1**.
- `scraping-agent` — **L0–L1** (o de menor maturidade da plataforma);
  controllers de scraping na lista de rotas a proteger (P0.7).

## Decisão

- Manter ambos fora do gate de piloto. Quando promovidos, seguem a mesma
  DoD L3 do ADR 0007. Até lá, **não podem expor rota externa sem auth nem
  estado crítico em produção**; em produção devem ficar desabilitados/atrás
  de flag (P0.7) enquanto não atingirem L3.

## Melhorias para produção

### Segurança
- Rotas de scraping desabilitadas/protegidas em produção (P0.7); `scraping`
  respeita robots/limites e isolamento por tenant; sem credencial em log.

### Desacoplamento
- `PersistenceModule` quando promovidos; comunicação por evento/porta.

### Persistência & Consistência
- Definir persistência e idempotência só quando houver demanda comprovada.

### Observabilidade
- Métricas básicas atrás de flag.

### Otimização & Escala
- Rate limit e backoff no scraping; isolamento de carga.

### Features faltantes
- Especificação completa do self-checkout e do scraping antes de promover a
  L3.

## Alternativas consideradas
- **Promover junto do piloto.** Rejeitado pelo ADR 0007 (P4 não atrasa
  P0/P1).
- **Deixar rotas abertas em produção.** Rejeitado por P0.7.

## Consequências
**Positivas:** foco no caminho do piloto; superfície de ataque reduzida.
**Negativas/riscos:** funcionalidades adiadas; aceitável por serem
pós-piloto.

**Barra de aceite (quando promovidos):** DoD L3 do ADR 0007.
