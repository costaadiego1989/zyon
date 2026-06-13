# ADR 0010 — Checkout: caminho transacional do piloto

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Checkout), Segurança, Plataforma
- **Relacionado:** [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0005](./0005-multi-tenant-isolation.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0011](./0011-payment-hardening.md), [ADR 0022](./0022-widget-transactional-path.md). Baseline: `.specs/maturity/checkout.md`.

## Contexto

`checkout` é o núcleo: sessões, eventos, scoring, chat, ofertas e o
read-model do dashboard. Está classificado **L2 (blocked), alvo L3,
prioridade P1** (`.specs/maturity/MATURITY-INDEX.md`). O módulo concentra
hoje a infraestrutura Prisma compartilhada (ADR 0004) e possui controllers
legados na lista P0.7. O `checkout` recebe `payment.approved` e
`negotiation.agreement.accepted` por evento (ADR 0003) e materializa o
pedido via `CompleteOrderUseCase`. Invariantes do CLAUDE.md: LLM nunca
autoriza ofertas; desconto só pelo `rules-engine`; subsídio de frete só
pelo `shipping-engine`; toda mensagem gerada validada por
`isSafeGeneratedMessage`; matemática de oferta determinística.

Estado verificado: existem repositório Prisma de checkout e de
intervention-ledger e specs de cross-tenant fuzz
(`checkout.cross-tenant-fuzz.prisma-e2e-spec.ts`), porém o módulo está
`blocked` pelos P0 (tenant guard, outbox em memória, rotas legadas).

## Decisão

Levar `checkout` a L3 após os P0 (ADR 0009), com:

- sessão e ledger de intervenção **sempre persistidos** em produção
  (Prisma), nunca só em memória;
- conclusão de pedido **idempotente** por `session_id`/`external_order_id`
  e dirigida por evento com outbox durável (ADR 0003/0009);
- ofertas, scoring e chat respeitando as invariantes (rules-engine,
  shipping-engine, `isSafeGeneratedMessage`, fallback determinístico);
- read-model do dashboard como projeção, reconstruível via replay da outbox.

## Melhorias para produção

### Segurança
- `merchant_id` derivado sempre do contexto de tenant, nunca do body
  (ADR 0005/0009). Desabilitar/proteger controllers legados de checkout
  (P0.7). Validar request/response em runtime. Garantir que nenhuma
  resposta de chat afirme desconto/frete/estoque/pagamento não autorizado.

### Desacoplamento
- Remover dependência do `prisma-client` local em favor do
  `PersistenceModule`. Comunicação com payment/negotiation/shipping **só**
  por evento/porta (sumir `CheckoutPaymentAdapter`, ADR 0003).

### Persistência & Consistência
- Idempotência de `CompleteOrderUseCase` por chave natural; writes de
  agregado + outbox atômicos; semântica documentada de retry/compensação
  para pagamento aprovado e acordo de negociação.

### Observabilidade
- Logs estruturados com `correlation_id` + `merchant_id` + `session_id`;
  métricas de criação de sessão, scoring, ofertas emitidas/aceitas, latência
  e backlog de eventos.

### Otimização & Escala
- Paginação no read-model do dashboard; índices por `merchant_id` nas
  consultas quentes; limites de tamanho de histórico de chat.

### Features faltantes
- Runbook de replay do read-model; reconciliação sessão↔pedido↔pagamento;
  teste de restart em banco real.

## Alternativas consideradas
- **Concluir pedido de forma síncrona ao pagamento.** Rejeitado pelo ADR
  0003 (acoplamento e perda em falha parcial); usamos evento + outbox.
- **Manter scoring/ofertas com estado em memória.** Rejeitado: viola DoD L3.

## Consequências
**Positivas:** núcleo confiável e auditável; split futuro viável.
**Negativas/riscos:** maior superfície de teste (dispatcher, idempotência,
replay); latência percebida na conclusão (mitigada, ADR 0003).

**Barra de aceite:** DoD L3 do ADR 0007 + E2E de happy path, cross-tenant
negado, retry idempotente e webhook duplicado verdes.
