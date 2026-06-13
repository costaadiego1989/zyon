# ADR 0011 — Payment: Asaas, idempotência e tokenização de cartão

- **Status:** proposto
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Payment), Segurança, Plataforma
- **Relacionado:** [ADR 0002](./0002-acl-pattern-cross-context.md), [ADR 0003](./0003-event-bus-and-transactional-outbox.md), [ADR 0007](./0007-module-maturity-and-progressive-closure.md), [ADR 0008](./0008-production-readiness-roadmap.md), [ADR 0009](./0009-platform-p0-hardening.md), [ADR 0022](./0022-widget-transactional-path.md). Baseline: `.specs/maturity/payment.md`.

## Contexto

`payment` cobre payment intents Asaas e webhooks. Classificado **L2
(blocked), alvo L3, prioridade P1**. Dois bloqueios diretos:

- **P0.8 — cartão com PAN/CVV:** o `CardForm` do widget transmite dados de
  cartão ao backend (`apps/widget/src/components/checkout/CardForm.tsx`,
  `cvv` linha 104, `ccv: cvv` linha 164). Isso coloca o backend no escopo
  PCI e é proibido para produção.
- Pagamento aprovado deve disparar `payment.approved` para o checkout
  concluir o pedido por evento (ADR 0003); idempotência de webhook é
  obrigatória (webhooks duplicados do Asaas são esperados).

## Decisão

- **Tokenização provider-side:** desativar o envio de PAN/CVV ao backend;
  usar tokenização do provider (Asaas transparente tokenizado ou
  equivalente Stripe Elements) de modo que o backend nunca receba PAN/CVV.
  Confirmação de pagamento **apenas por webhook** assinado e idempotente.
- **Adapter Asaas via ACL** (ADR 0002): `domain/services/asaas-mapping.ts`
  puro + adapter fino sobre `HttpClient`, com timeout/retry e contract test
  em sandbox.
- **Webhook idempotente** por id de cobrança/evento Asaas, persistido;
  publica `payment.approved`/`payment.failed` via outbox durável (ADR 0009).
- Intents e estados de pagamento **persistidos** (nunca só em memória).

## Melhorias para produção

### Segurança
- Sem PAN/CVV no backend (P0.8). Verificação de assinatura do webhook
  Asaas. `merchant_id` do contexto, nunca do body. Logs sem PAN/CVV.
  Desabilitar controllers legados de payment (P0.7).

### Desacoplamento
- ACL Asaas; comunicação com checkout só por evento (sem chamada síncrona).

### Persistência & Consistência
- Índice de idempotência de webhook persistido; intent + outbox atômicos;
  semântica de retry/compensação para falha parcial do provider.

### Observabilidade
- Métricas de intents criados, aprovados, falhos, latência do provider e
  taxa de webhook duplicado; alertas de provider indisponível.

### Otimização & Escala
- Timeout/retry com backoff no adapter; circuit breaker simples para Asaas.

### Features faltantes
- Reconciliação pagamento↔pedido; runbook de webhook perdido/atrasado;
  contract test sandbox do Asaas.

## Alternativas consideradas
- **Manter checkout transparente com PAN no backend sob TLS.** Rejeitado:
  escopo PCI e P0.8. Tokenização provider-side é mandatória.
- **Confirmar pagamento na resposta síncrona da API.** Rejeitado: webhook
  é a fonte de verdade; resposta síncrona não é confiável.

## Consequências
**Positivas:** backend fora do escopo PCI de PAN; confirmação confiável e
idempotente.
**Negativas/riscos:** depende de integração de tokenização no widget
(ADR 0022); UX de cartão muda.

**Barra de aceite:** DoD L3 + E2E de webhook duplicado, provider
indisponível e cartão sem PAN no backend.
