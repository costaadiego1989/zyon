# ADR — Widget v2 / bootstrap

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-widget_v2.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [W2-001](<../ADR-widget_v2.md#w2-001>) — Início não hidrata carrinho e identidade usados pelo pagamento: Carrinho exibido pode ter itens enquanto sessão cobradora está vazia/incompleta; buyer informado no redirect não fica autenticado por esse parâmetro.
- [API-044](<../../api/ADR-api-embed.md#api-044>) — Emissão via storefront transforma parâmetros públicos em credencial de tenant: Qualquer caller da rota pode solicitar token com escopos de checkout/pagamento para tenant/origem escolhidos, ampliando o impacto dos defeitos de ownership e preço.

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

- W2-001: Redirect de carrinho real cria sessão com mesmos SKUs/valores; reload retoma a mesma compra; URL globalUserId não permite assumir identidade.
- API-044: Host de A não emite token de B, origem arbitrária é rejeitada e carrinho alheio não pode ser vinculado. Emissão anônima legítima permanece limitada ao contexto autorizado.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
