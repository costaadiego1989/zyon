# ADR — Widget v2 / frete

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-widget_v2.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [W2-004](<../ADR-widget_v2.md#w2-004>) — Frete usa envelope/campos divergentes e fallback com preços inventados: Frete não é persistido e pagamento pode falhar shipping_method_required_before_payment; preço/prazo exibidos não são cotação aprovada.
- [API-023](<../../api/ADR-api-shipping.md#api-023>) — Compra de etiqueta precede validação do pedido: Pode gastar em etiqueta para pedido inexistente ou deixar etiqueta comprada sem vínculo quando persistência falha.

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

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- W2-004: Cotação real deve renderizar e selecionar preço exato na sessão; provider indisponível não oferece frete fictício nem libera pagamento.
- API-023: Pedido inexistente/alheio nunca chama provedor; timeout após compra deve recuperar a mesma etiqueta e rastreio.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
