# ADR 0001 (scraping-agent) — Arquitetura do módulo de scraping-agent e hardening de tenant/auth/roteamento

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Growth), Segurança, Plataforma
- **Relacionado:** [ADR 0003](../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0004](../../../../../../docs/architecture/adr/0004-prisma-isolation-per-context.md), [ADR 0005](../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0007](../../../../../../docs/architecture/adr/0007-module-maturity-and-progressive-closure.md), [ADR 0009](../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0012](../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0021](../../../../../../docs/architecture/adr/0021-post-pilot-self-checkout-scraping.md). Baseline: `.specs/maturity/scraping-agent.md`.

## Contexto

`scraping-agent` é o módulo do contexto **growth** que orquestra cotações de
preço (price-quote jobs): requisição, ingestão de resultados por fonte,
ranking, finalização com decisão de roteamento e cancelamento. É o de **menor
maturidade da plataforma — P4 / L0–L1** (ADR 0021), com controllers na lista
de rotas a proteger (P0.7).

### Responsabilidades e camadas

- **Domínio:** `PriceQuoteJobEntity` (máquina de estados
  pending→running→completed/cancelled/failed); políticas
  `source-allow-list.policy` (`filterAllowedSources`), `total-cost.policy`,
  `purchase-routing.policy` (`decidePurchaseRouting`); serviço
  `result-ranker.service` (`rankResults`); port `PriceSourcePort`. Eventos em
  `scraping-domain-event`.
- **Ports:** `PriceQuoteJobRepository` (escopo por `merchant_id`),
  `PriceSourcePort`, `OutboxRepository`.
- **Aplicação:** `RequestPriceQuote`, `IngestQuoteFromSource`,
  `FinalizeQuoteJob`, `CancelQuoteJob`.
- **Infra:** `InMemoryPriceQuoteJobRepository`, `FlatRateSourceAdapter`.
- **Apresentação:** `WidgetPriceQuoteController` (`embed/price-quote`, hoje só
  `@NonProductionRoute`, sem `EmbedAuthGuard`).

### Fluxos-chave

1. **Request:** filtra fontes permitidas → cria/persiste job → outbox
   `scraping.job.requested`.
2. **Ingest:** carrega job → `start` se pending → `ingestResult` → save.
3. **Finalize:** rankeia resultados → decide roteamento → `complete` → outbox
   `scraping.job.completed`.

### Invariantes que o módulo deve sustentar

- **Tenant boundary:** `merchant_id` derivado de claims do embed, nunca do
  body; toda query escopada por `merchant_id` (ADR 0005/0012).
- **Persistência Prisma em runtime** (ADR 0004); save + outbox atômicos
  (ADR 0003); idempotência de ingestão.
- **Roteamento determinístico** via `decidePurchaseRouting`.
- Rotas de scraping desabilitadas/protegidas em produção até L3 (ADR 0021,
  P0.7).

## Decisão

Manter o desenho e fechar os desvios abaixo antes de qualquer promoção (ADR
0021): o controller passa a exigir `EmbedAuthGuard` com `merchant_id`
derivado das claims; o roteamento passa a usar `decidePurchaseRouting` de
fato; a ingestão fica idempotente e rejeita jobs terminais; a allow-list de
fontes passa a ser por merchant; e o módulo migra para repo Prisma com
save+outbox atômico e um dispatcher que aciona `PriceSourcePort`.

## Bugs registrados (root cause + remediação)

### P1 — Controller de price-quote sem auth e confia em `merchant_id` do body (segurança)
- **Onde:** `presentation/http/widget-price-quote.controller.ts:9-37`.
- **Root cause:** `WidgetPriceQuoteController` tem apenas
  `@NonProductionRoute()` — sem `EmbedAuthGuard` (ao contrário de
  widget-coupons/widget-cross-sell, que usam guard +
  `assertSessionBelongsToEmbedMerchant`). `merchant_id` vem direto do body em
  request/getJob/cancel/finalize, sem prova de que o caller é dono do tenant.
- **Impacto:** qualquer caller cria/lê/cancela/finaliza jobs de um
  `merchant_id` arbitrário spoofando o body. Read/write cross-tenant de jobs.
  O tenant boundary é satisfeito sintaticamente, mas o `merchant_id` é
  controlado pelo atacante.
- **Remediação decidida:** aplicar `EmbedAuthGuard`, derivar `merchant_id` das
  claims do embed (não do body) e assertar ownership de sessão como os
  controllers irmãos. **Sem mudança de contrato de domínio** (mudança de
  apresentação/segurança).

### P1 — Repos in-memory ligados como persistência de runtime nos 4 módulos (infra)
- **Onde:** `scraping-agent.module.ts:13-21` (e CouponsModule, CrossSellModule, SelfCheckoutModule).
- **Root cause:** os 4 module roots ligam os tokens de repositorio a InMemory* via useExisting no root.
  CLAUDE.md exige: Prisma e a unica persistencia de runtime; in-memory so como test double em specs. Nao existe Prisma*Repository para nenhum dos 4 modulos (so buyer-account/buyer-purchase-history tem).
- **Impacto:** todo estado de coupon, cross-sell, scraping-job e buyer-wallet/template vive em memoria de processo: perdido no restart, nao compartilhado entre instancias, divergente do contrato de persistencia. Em prod = perda de dados e sem escala horizontal; tambem enfraquece o isolamento por tenant que depende do DB.
- **Remediação decidida:** implementar repos Prisma por porta contra `schema.prisma` e liga-los nos module roots; InMemory* fica restrito a specs. **Precisa de migração** (models/migrations Prisma ausentes).

### P1 — State + outbox sem transação compartilhada (dados)
- **Onde:** `request-price-quote.use-case.ts` e demais writes (padrão do contexto).
- **Root cause:** `save(...)` e `appendOutbox(...)` são dois `await` separados sem transação.
- **Impacto:** estado sem evento ou evento duplicado no retry — quebra o at-least-once do outbox.
- **Remediação decidida:** transactional outbox (ADR 0003). **Bloqueado até repos Prisma** — amarrado ao ADR de persistência.

### P1 — Finalize hardcoda roteamento `external`; `decidePurchaseRouting` é dead code (funcional)
- **Onde:** `application/use-cases/finalize-quote-job.use-case.ts:21`.
- **Root cause:** `const routing = topResult ? "external" : "external"` — os dois ramos retornam `external`. `decidePurchaseRouting` (compara o host de `result.url` com `merchantDomain` para escolher `integrated`) nunca é invocado na aplicação.
- **Impacto:** toda cotação finalizada roteia o buyer para fora, mesmo quando o top result está no domínio do próprio merchant (deveria ser `integrated`). Conversões de checkout integrado perdidas e `routing_decision` sempre errada.
- **Remediação decidida:** chamar `decidePurchaseRouting(topResult, merchantDomain)` no top result e usar o retorno; passar o domínio do merchant ao use-case. **Sem mudança de contrato de domínio** (precisa do `merchantDomain` na entrada).

### P2 — `getJob` usa GET com body para `merchant_id` (contrato)
- **Onde:** `presentation/http/widget-price-quote.controller.ts:24-27`.
- **Root cause:** `@Get(":job_id")` lê `merchant_id` de `@Body()`. A maioria dos clients/intermediários descarta body em GET, então `merchant_id` chega `undefined` e `repo.findById(jobId, undefined)` retorna `null` — o endpoint efetivamente sempre 404 para clients conformes.
- **Impacto:** polling de status quebrado para clients padrão; e onde o body passa, `merchant_id` continua controlado pelo atacante (ver bug de auth).
- **Remediação decidida:** mover `merchant_id` para query param ou, preferível, derivar das claims do embed; manter GET sem body. **Mudança de contrato HTTP.**

### P2 — Ingestão sem idempotência e mal-tratando jobs terminais (runtime)
- **Onde:** `application/use-cases/ingest-quote-from-source.use-case.ts:15-18`.
- **Root cause:** se o job já está `completed`/`cancelled`/`failed`, `updated = job` (não iniciado) e `ingestResult` lança `illegal_transition` (entidade exige `running`) — surge como 500 não tratado. Não há dedup por `result.id`, então resultados redelivered acumulam duplicatas que distorcem `rankResults`.
- **Impacto:** entradas de ranking duplicadas e 500s não tratados em callbacks tardios/duplicados. Contagem de resultados em `scraping.job.completed` inflada.
- **Remediação decidida:** rejeitar ingestão em jobs terminais com erro de domínio mapeado para 409; dedup por `result.id` (substituir, não anexar) antes do save. **Sem mudança de contrato.**

### P2 — Request ignora allow-list de fontes configurada pelo merchant (validação)
- **Onde:** `application/use-cases/request-price-quote.use-case.ts:8-29`.
- **Root cause:** `DEFAULT_ALLOWED_SOURCES` é constante hardcoded usada como allow-list de todo merchant; não há lookup de política por merchant. `raw_query` é ilimitado (sem validação de tamanho/conteúdo) e o job, uma vez criado, não tem orquestrador/consumer (nada despacha para `PriceSourcePort`).
- **Impacto:** merchants não podem restringir/estender fontes; input não validado; jobs persistidos mas nunca executados na aplicação (só existe `FlatRateSourceAdapter` e nada o invoca) — cotações não populam sem trigger externo.
- **Remediação decidida:** carregar a política de fontes do merchant, validar bounds de `raw_query` e ligar um dispatcher que faz fan-out aos adapters `PriceSourcePort` e alimenta `IngestQuoteFromSource`. **Mudança de contrato** (política por tenant + wiring de dispatcher).

## Melhorias para produção

### Segurança
- `EmbedAuthGuard` no controller; `merchant_id` das claims, nunca do body; rotas de scraping protegidas/desabilitadas em prod até L3 (ADR 0021, P0.7); respeitar robots/limites; sem credencial em log.

### Desacoplamento
- `PersistenceModule`/repos Prisma; dispatcher acionando `PriceSourcePort` por porta; comunicação por evento (ADR 0003).

### Persistência & Consistência
- Repo Prisma (ADR 0004); save + outbox atômicos; ingestão idempotente por `result.id`; rejeição de jobs terminais.

### Observabilidade
- Métricas de jobs requested/completed/cancelled, fontes completadas, decisão de roteamento; logs com `correlation_id` + `merchant_id` + `job_id`.

### Otimização & Escala
- Rate limit e backoff por fonte; índices por `merchant_id`; limites de tamanho de `raw_query` e de resultados por job.

### Features faltantes
- Especificação completa do scraping antes de promover a L3 (ADR 0021); orquestrador de fan-out às fontes; política de fontes por tenant.

## Alternativas consideradas
- **Manter `merchant_id` no body sem auth.** Rejeitado: cross-tenant (P0.7, ADR 0012).
- **Manter roteamento hardcoded `external`.** Rejeitado: ignora checkout integrado e emite decisão sempre errada.
- **Allow-list global hardcoded.** Rejeitado: tira do merchant o controle de fontes.
- **Repos in-memory em produção.** Rejeitado pela DoD L3 e ADR 0021 (sem estado crítico em prod até L3).

## Consequências
**Positivas:** jobs isolados por tenant e autenticados; roteamento correto; estado durável e ingestão idempotente.
**Negativas/riscos:** módulo de menor maturidade — esforço de L0/L1→L3 não deve atrasar P0/P1 (ADR 0021); novo wiring de dispatcher e migrações Prisma ampliam superfície de teste.

**Barra de aceite:** DoD L3 do ADR 0007 + E2E de: acesso a job de outro tenant negado (`merchant_id` das claims), roteamento `integrated` quando o top result é do domínio do merchant, ingestão idempotente, job terminal rejeitado com 409 e save+outbox atômicos verdes.
