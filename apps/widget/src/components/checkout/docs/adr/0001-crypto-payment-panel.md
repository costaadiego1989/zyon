# ADR 0001 (widget/components/checkout) — `CryptoPaymentPanel`: broadcast on-chain e confirmação reconciliável

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Widget), Pagamentos, Segurança
- **Relacionado:** [ADR 0027](../../../../../../../docs/architecture/adr/0027-payment-crypto-evm.md), [ADR 0011](../../../../../../../docs/architecture/adr/0011-payment-hardening.md), [ADR 0022](../../../../../../../docs/architecture/adr/0022-widget-transactional-path.md). Módulos irmãos: [`use-checkout-payment`](../../../../hooks/docs/adr/0001-use-checkout-payment.md).

## Contexto

`CryptoPaymentPanel.tsx` é a UI de pagamento em USDC (EVM) do widget (ADR 0027).
Conecta carteira (MetaMask/Trust via `use-crypto-wallet`), exibe a cotação e o
endereço de destino, e em `handlePay`:

1. resolve a conta (`wallet.address` ou `connectMetaMask`);
2. faz **broadcast** da transferência on-chain (`wallet.sendUsdcTransfer`),
   obtendo `txHash`;
3. chama `model.onConfirmPayment(intentId, txHash, account)`
   (→ `confirmCryptoPayment` em `use-checkout-payment`);
4. fecha o painel em caso de sucesso.

**Portas:** `useCryptoWallet`, `CryptoPaymentPanelModel`
(`onConfirmPayment`, `onClose`, `quote`, `intentId`).

**Invariantes que o módulo deve manter:**

1. Se os fundos saíram on-chain, o `txHash` necessário para reconciliação
   **nunca** pode ser perdido.
2. A confirmação deve poder ser **retentada** sem rebroadcast.
3. A reconciliação não pode depender exclusivamente da chamada síncrona de
   confirmação (ADR 0022: confirmação webhook-driven).

## Decisão

Persistir as referências da transferência no momento do broadcast e oferecer
retry de confirmação, alinhando crypto à reconciliação assíncrona do PIX.

### Bugs verificados e remediação

| Severidade | Falha | Causa raiz | Remediação decidida | Contrato/migração |
|---|---|---|---|---|
| **P1** | Pagamento crypto enviado on-chain mas confirmação perdida em erro (16–35) | `handlePay` faz broadcast de `sendUsdcTransfer` e então `confirmCryptoPayment` lança `crypto_confirm_failed` em qualquer falha de confirmação (`use-checkout-payment.ts:465-471`). O `txHash` é um `const` local, descartado no throw; o painel permanece aberto com erro genérico e **sem** caminho de retry com hash retido. O USDC do comprador sai da carteira mas o pedido nunca é confirmado na UI, e o `txHash` para reconciliar é perdido. | Persistir `intentId`+`txHash`+`walletAddress` (estado/storage) no instante do broadcast; em falha de confirmação, mantê-los e expor ação "retentar confirmação"; reconciliar via webhook/poll como o PIX, em vez de depender só da chamada síncrona de confirmação. | **Sim** — exige caminho de reconciliação assíncrona (webhook/poll) para crypto, espelhando `payment-status` do PIX (ADR 0027/0022). Mudança de contrato no backend para expor status crypto polável. |

## Melhorias para produção

### Segurança
- `txHash` e `walletAddress` retidos localmente apenas para retry/reconciliação;
  nunca expostos a frame arbitrário (ADR 0012). Seed phrase nunca solicitada.

### Desacoplamento
- Confirmação dirigida por status autoritativo (webhook/poll), não só pela
  chamada síncrona (ADR 0022).

### Persistência & Consistência
- Referências da transferência persistidas no broadcast; retry idempotente sem
  rebroadcast.

### Observabilidade
- Log de broadcast com `txHash` (sem PII), estado de confirmação pendente.

### Otimização & Escala
- Reconciliação assíncrona evita pedido órfão em instabilidade de RPC/confirm.

### Features faltantes
- Endpoint de status crypto polável; UX de "confirmação pendente / retentar".

## Alternativas consideradas
- **Manter confirmação só síncrona.** Rejeitado: perde `txHash` e órfã o pedido
  em qualquer falha pós-broadcast.
- **Bloquear fechamento do painel até confirmar.** Insuficiente sem retenção do
  hash e reconciliação assíncrona.

## Consequências
**Positivas:** fundos on-chain sempre reconciliáveis; retry sem rebroadcast.
**Negativas/riscos:** exige status crypto polável no backend; mais estado local.

**Barra de aceite:** após broadcast bem-sucedido, falha de confirmação retém
`txHash`/`walletAddress` e oferece retry; pedido reconcilia via webhook/poll;
nenhum cenário em que o USDC sai e o `txHash` se perde.
