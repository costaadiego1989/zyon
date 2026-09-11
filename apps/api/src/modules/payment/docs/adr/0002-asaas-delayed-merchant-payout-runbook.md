# Asaas: repasse do merchant apos a janela de estorno

## Escopo

Este fluxo e exclusivo do Asaas. O comprador paga para a conta platform; a
taxa de servico do comprador e a taxa da plataforma ficam registradas na
platform. O valor liquido do merchant fica retido durante a janela configurada
e so e transferido para a carteira Asaas vinculada ao merchant depois dela.

O modo continua desligado por padrao. Stripe, Mercado Pago e cripto permanecem
barrados no modo de repasse atrasado ate que cada um tenha a mesma
implementacao de transferencia e conciliacao.

## Pre-requisitos

1. A conta platform do Asaas esta configurada com `ASAAS_API_KEY` e
   `ASAAS_API_BASE_URL` de producao.
2. Cada merchant participante tem conexao Asaas ativa e uma `walletId`
   vinculada. A chave da subconta nao e usada para criar a transferencia.
3. O endpoint publico `POST /webhooks/asaas` esta cadastrado no Asaas com o
   mesmo `ASAAS_WEBHOOK_TOKEN` da API e recebe os eventos de pagamento e
   `TRANSFER_CREATED`, `TRANSFER_PENDING`, `TRANSFER_IN_BANK_PROCESSING`,
   `TRANSFER_BLOCKED`, `TRANSFER_DONE`, `TRANSFER_FAILED` e
   `TRANSFER_CANCELLED`.
4. A migration de `PaymentHold` ja foi aplicada pelo processo de deploy da API.

## Ativacao controlada

1. Em sandbox, configure `PAYMENT_MERCHANT_SETTLEMENT_MODE=delayed_merchant_payout`.
2. Mantenha a segunda trava desligada enquanto o checkout e os webhooks forem
   conferidos: `PAYMENT_MERCHANT_DELAYED_PAYOUT_ASAAS_ENABLED=false`.
3. Configure uma janela entre 1 e 90 dias com
   `PAYMENT_MERCHANT_PAYOUT_HOLD_DAYS`; o padrao e 14 dias.
4. Faca um pagamento controlado de baixo valor e valide: pagamento aprovado,
   `PaymentHold` criado, taxa e liquido imutaveis, e agenda exibida em
   Financeiro.
5. Simule o fim da janela em sandbox. O worker envia somente uma solicitacao
   `POST /v3/transfers` para a `walletId` vinculada e grava uma referencia
   deterministica. Nao considere o valor repassado nesta etapa.
6. Entregue `TRANSFER_DONE` pelo webhook e valide: ID de transferencia salvo,
   hold `released`, recibo no historico e status "Repasse confirmado" na agenda.
7. Valide um reembolso antes da janela e uma falha/ambiguidade de transferencia.
   Reembolso bloqueia o repasse; erro ambiguo permanece pendente de conciliacao
   humana e nunca recebe reenvio automatico.
8. So apos registrar as evidencias acima, habilite
   `PAYMENT_MERCHANT_DELAYED_PAYOUT_ASAAS_ENABLED=true` em producao.

## Operacao e recuperacao

- `held` e `payout_ready`: valor ainda protegido pela janela de estorno.
- `payout_submitted`: transferencia enviada, aguardando confirmacao do Asaas.
- `released`: somente o webhook `TRANSFER_DONE` confirmou o repasse.
- `payout_failed`: requer conciliacao operacional antes de qualquer nova acao.
- `refund_reversal_required` e `chargeback_debt`: o provedor confirmou o
  repasse, mas um evento posterior exige recuperacao manual.

A observacao de split por si so nao prova que o merchant recebeu o valor. A
agenda de repasses e o recibo com o identificador de transferencia sao a fonte
de verdade operacional para esse fluxo.
