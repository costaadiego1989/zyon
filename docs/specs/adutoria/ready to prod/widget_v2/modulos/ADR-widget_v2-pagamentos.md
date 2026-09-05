# ADR — Widget v2 / pagamentos

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-widget_v2.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [W2-002](<../ADR-widget_v2.md#w2-002>) — Resposta de intenção é lida com nomes que a API não retorna: PIX sem código e requests de status/confirm com ID indefinido; cartão sem clientSecret.
- [W2-003](<../ADR-widget_v2.md#w2-003>) — Polling omite session_id e ignora approved: Pagamento confirmado permanece pendente até erro por timeout; comprador pode tentar pagar novamente.
- [W2-005](<../ADR-widget_v2.md#w2-005>) — Cartão não tem renderer ativo e confirmação usa body incorreto: Comprador escolhe cartão e não recebe formulário útil; confirmação corrigida parcialmente ainda falha 400.
- [W2-006](<../ADR-widget_v2.md#w2-006>) — Cripto é oferecida sem fluxo de pagamento e confirmação: Método oferecido não pode ser concluído no widget atual.
- [API-014](<../../api/ADR-api-payment.md#api-014>) — Taxa do cartão diverge do total esperado na conclusão: Cobrança aprovada pode falhar na conclusão do pedido com order_total_mismatch. A taxa padrão de R$1,99 excede a tolerância.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/widget_v2/src/api/checkout-session.ts:185](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L185>) | POST | {this.baseUrl}/embed/start | Alcançável: embed /embed/start | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:207](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L207>) | GET | {this.baseUrl}/storefront/cart/{encodeURIComponent(this.cartRef)}?merchantId={encodeURIComponent(this.merchantId)} | Alcançável: storefront /storefront/:slug/config<br>Alcançável: storefront /storefront/:slug/stories<br>Alcançável: storefront /storefront/:slug/logo<br>Alcançável: storefront /storefront/cart/:cartId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:228](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L228>) | POST | {this.baseUrl}/embed/chat | Alcançável: embed /embed/chat | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:243](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L243>) | PATCH | {this.baseUrl}/storefront/cart/{encodeURIComponent(this.cartRef)}/items/{encodeURIComponent(variantId)}?merchantId={encodeURIComponent(this.merchantId)} | Alcançável: storefront /storefront/cart/:cartId/items/:variantId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:257](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L257>) | POST | {this.baseUrl}/embed/cart | Alcançável: embed /embed/cart | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:268](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L268>) | POST | {this.baseUrl}/embed/shipping/quote | Alcançável: shipping /embed/shipping/quote | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:289](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L289>) | POST | {this.baseUrl}/embed/shipping/select | Alcançável: embed /embed/shipping/select<br>Alcançável: shipping /embed/shipping/select | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:306](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L306>) | POST | {this.baseUrl}/embed/payment/intents | Alcançável: embed /embed/payment/intents | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:324](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L324>) | GET | {this.baseUrl}/embed/payment/intents/{intentId}/status | Alcançável: embed /embed/payment/intents/:intentId/status | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:334](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L334>) | POST | {this.baseUrl}/embed/offers/apply | Alcançável: embed /embed/offers/apply | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/api/checkout-session.ts:345](<../../../../../../apps/widget_v2/src/api/checkout-session.ts#L345>) | POST | {this.baseUrl}/embed/customer/update | Alcançável: embed /embed/customer/update | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/components/StripeCardPayment.tsx:50](<../../../../../../apps/widget_v2/src/components/StripeCardPayment.tsx#L50>) | POST | {api.apiBaseUrl}/embed/payment/intents/{paymentIntent.intent_id}/stripe/confirm | Alcançável: embed /embed/payment/intents/:intentId/stripe/confirm | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/widget_v2/src/store/checkout-store.ts:221](<../../../../../../apps/widget_v2/src/store/checkout-store.ts#L221>) | GET | {apiBaseUrl}/checkout-settings/widget-config?merchantId={encodeURIComponent(merchantId)} | Alcançável: checkout-settings /checkout-settings/widget-config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- W2-002: Resposta real de create para pix/card/crypto deve passar schema do client e renderizar instruções de pagamento utilizáveis.
- W2-003: PIX approved conclui após confirmação de pedido; failed/cancelled param polling; unmount/retry não cria timers paralelos.
- W2-005: Teste em navegador percorre cartão/3DS até pedido; webhook atrasado e falha de rede não causam cobrança duplicada nem sucesso falso.
- W2-006: Crypto habilitada só aparece quando client suporta a rede/token e conclui confirmação idempotente; expiração e rede incorreta são bloqueadas.
- API-014: Cartão com taxa padrão, taxa zero e descontos deve concluir com o valor capturado correto; replay não cria pedido duplicado.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
