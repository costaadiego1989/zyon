# ADR 0001 (widget/hooks) — `use-checkout-payment`: intent de pagamento, PIX long-poll e confirmação

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Segurança, Pagamentos
- **Relacionado:** [ADR 0011](../../../../../../docs/architecture/adr/0011-payment-hardening.md), [ADR 0022](../../../../../../docs/architecture/adr/0022-widget-transactional-path.md), [ADR 0027](../../../../../../docs/architecture/adr/0027-payment-crypto-evm.md), [ADR 0010](../../../../../../docs/architecture/adr/0010-checkout-pilot-path-hardening.md). Módulos irmãos: [`use-checkout-session`](./0002-use-checkout-session.md), [`crypto-payment-panel`](../../../components/checkout/docs/adr/0001-crypto-payment-panel.md).

## Contexto

`use-checkout-payment.ts` é a porta do widget para iniciar e finalizar pagamentos
no caminho transacional do piloto (ADR 0022). Responsabilidades:

- **`createPaymentIntent(method)`** — POST `payment-intents` com `session_id`,
  `idempotency_key`, `method` e `accepted_offer_id` opcional; ramifica por
  snapshot retornado (aprovado síncrono, Stripe Elements, cotação crypto EVM,
  ou cobrança assíncrona PIX/boleto).
- **`pollPaymentStatus(intentId)`** — long-poll (4s, deadline 10min) do status
  autoritativo do PIX; confirmação **nunca** otimista (ADR 0022).
- **`confirmStripePayment` / `confirmCryptoPayment`** — confirmam o intent após
  evento do provider e chamam `finalizeConfirmation`.
- **`markPaymentCompleted`** — encerra o poll, limpa intents locais, sincroniza
  a experiência para `stage: "completed"` e emite a mensagem de confirmação a
  partir de referências reais (`order_id`, `receipt_url`).

**Portas:** `embed-client` (`checkoutJson`/`checkoutGet`, paths embed vs legacy),
`paymentIntentSnapshotSchema`, `CheckoutSessionState`, `CheckoutChatState`.

**Invariantes que o módulo deve manter:**

1. Uma tentativa de checkout gera **no máximo uma** cobrança/intent (idempotência).
2. Confirmação dirigida por status autoritativo/webhook, nunca otimista.
3. Toda cobrança aprovada deve poder ser reconciliada com um `intentId` válido.
4. `merchant_id` só vai no body em modo legacy; em embed é derivado do token.

## Decisão

Endurecer o módulo para preservar as invariantes acima, corrigindo as três
falhas verificadas e mantendo a confirmação webhook-driven do ADR 0022.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P1** | Intents/cobranças duplicados em duplo-toque rápido na forma de pagamento (linhas 250–260) | `createPaymentIntent` gera `crypto.randomUUID()` novo a cada chamada e não tem lock próprio; `busy` do chat só é checado na entrada do `tapQuick`, não antes do POST. Dois toques rápidos enviam duas `idempotency_key` distintas → duas cobranças (PIX duplicado / Stripe intent duplicado). | Derivar uma `idempotency_key` **estável por tentativa** (`session_id` + `method` + hash do carrinho) em vez de por clique; e guardar `createPaymentIntent` com um `ref` in-flight que ignora reentrância até a requisição liquidar. | Não. Reusa o `idempotency_key` já aceito pelo endpoint. |
| **P2** | Pagamento de cartão aprovado fica órfão por `intentId` vazio (278–289) | `setStripeIntent({ intentId: snap.id ?? "" })`; `confirmStripePayment` trata a string vazia como "sem intent" (352–359) e emite mensagem de "aguardando confirmação" que nunca resolve, mesmo com o cartão já cobrado no Stripe. | Tratar `snap.id` ausente como **erro antes** de abrir o formulário Stripe (abortar com mensagem clara) em vez de persistir `intentId` vazio. | Não. |
| **P3** | PIX long-poll fecha sobre `sessionState` obsoleto (137–190) | `pollPaymentStatus` roda até 10min a partir do render em que `createPaymentIntent` foi chamado; `markPaymentCompleted` faz spread de `sessionState.activeExperience` dessa closure obsoleta, podendo sobrescrever atualizações de experiência ocorridas na janela do poll. | Ler `activeExperience` de um `ref` atualizado por efeito, ou usar atualização funcional em `syncExperience` que faz merge contra o snapshot mais recente. | Não. |

> A perda de `txHash` na confirmação crypto (linhas 465–471) tem causa raiz
> compartilhada com o painel; ver [`crypto-payment-panel`](../../../components/checkout/docs/adr/0001-crypto-payment-panel.md).

## Melhorias para produção

### Segurança
- Sem PAN/CVV trafegando ao backend AACP — cartão via Stripe Elements (ADR 0011/0022).
- `merchant_id` só no body em legacy; em embed derivado do token (ADR 0012).

### Desacoplamento
- UI não decide valor/desconto; consome snapshot tipado do engine (ADR 0025).

### Persistência & Consistência
- Idempotência por chave natural estável (não por clique) evita dupla cobrança.
- `intentId` sempre presente para qualquer cobrança aprovada (reconciliável).
- Confirmação consistente com status autoritativo/webhook.

### Observabilidade
- Telemetria de funil (intent criado, aprovado, expirado, falho) sem PII/PAN.
- Log de reentrância bloqueada e de `intentId` ausente.

### Otimização & Escala
- Lock in-flight e estados de carregamento idempotentes; degradação graciosa
  quando o provider/cotação está indisponível.

### Features faltantes
- Reconciliação intent↔pedido↔pagamento; UX de PIX expirado já tratada no poll.

## Alternativas consideradas
- **Confirmação otimista antes do webhook.** Rejeitada (ADR 0022): pode
  confirmar pagamento não capturado.
- **Lock só no `busy` do chat.** Insuficiente: `busy` é virado dentro do chat
  hook, depois do POST do intent.

## Consequências
**Positivas:** caminho de pagamento sem dupla cobrança e sem cobrança órfã.
**Negativas/riscos:** maior superfície de teste (reentrância, closures de poll).

**Barra de aceite:** E2E realapi de happy path; duplo-toque rápido gera **uma**
cobrança; cartão aprovado com `snap.id` ausente aborta com mensagem clara; PIX
expirado e indisponibilidade do provider verdes; nenhum PAN/CVV no tráfego.
