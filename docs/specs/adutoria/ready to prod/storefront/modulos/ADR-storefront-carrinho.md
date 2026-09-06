# ADR — Storefront / carrinho

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-storefront.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [SF-002](<../ADR-storefront.md#sf-002>) — Carrinho mistura alterações locais e chamadas incompletas: Tela pode mostrar quantidade/remover item que não foi persistido; requisição PATCH retorna 400 e DELETE não corresponde ao handler. Pagamento pode usar carrinho divergente.
- [SF-003](<../ADR-storefront.md#sf-003>) — Heurísticas de centavos alteram preços legítimos: Comprador vê valor diferente do cobrado, sobretudo em tickets altos.
- [API-005](<../../api/ADR-api-storefront.md#api-005>) — Flag de legado expõe consultas e mutações administrativas sem autenticação: Com a flag ligada: exposição de dados de orçamento e alterações indevidas. Com ela desligada: fluxos dos fronts dependentes retornam 404. Estado real da flag no deploy não foi consultado.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/storefront/src/lib/api/api-client.ts:48](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L48>) | GET | url | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:85](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L85>) | GET | {API_BASE}/merchants/{merchantId}/products?{query} | Alcançável: catalog /merchants/:mid/products | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:97](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L97>) | GET | {API_BASE}/merchants/{merchantId}/products/{productId} | Alcançável: catalog /merchants/:mid/products/:pid | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:109](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L109>) | GET | {API_BASE}/checkout-settings/widget-config?merchantId={encodeURIComponent(merchantId)} | Alcançável: checkout-settings /checkout-settings/widget-config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:115](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L115>) | GET | {API_BASE}/storefront/{slug}/config | Alcançável: storefront /storefront/:slug/config<br>Alcançável: storefront /storefront/conversations/:conversationId<br>Alcançável: storefront /storefront/funnel/:merchantId<br>Alcançável: storefront /storefront/cart/:cartId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:127](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L127>) | GET | {API_BASE}/storefront/marketplace/search?{params.toString()} | Alcançável: storefront /storefront/marketplace/search | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:137](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L137>) | GET | {API_BASE}/storefront/marketplace/items?{params.toString()} | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:152](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L152>) | POST | {API_BASE}/storefront/conversations | Alcançável: storefront /storefront/conversations | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:169](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L169>) | POST | {API_BASE}/storefront/conversations/{checkoutId}/messages | Alcançável: storefront /storefront/conversations/:conversationId/messages | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:187](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L187>) | GET | {API_BASE}/storefront/cart/{encodeURIComponent(cartId)}?merchantId={encodeURIComponent(merchantId)} | Alcançável: storefront /storefront/:slug/config<br>Alcançável: storefront /storefront/:slug/stories<br>Alcançável: storefront /storefront/:slug/logo<br>Alcançável: storefront /storefront/cart/:cartId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:198](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L198>) | DELETE | {API_BASE}/storefront/cart/{encodeURIComponent(cartId)}/items/{encodeURIComponent(variantId)} | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:213](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L213>) | GET | {API_BASE}/buyer/consent/intent-memory | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/api-client.ts:220](<../../../../../../apps/storefront/src/lib/api/api-client.ts#L220>) | DELETE | {API_BASE}/buyer/consent/intent-memory | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/viewmodels/useConversationViewModel.ts:22](<../../../../../../apps/storefront/src/lib/viewmodels/useConversationViewModel.ts#L22>) | POST | {API_BASE}/v1/storefront/conversations/{encodeURIComponent(sessionId)}/events | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- SF-002: Aumentar/reduzir/remover item, recarregar e pagar mantém quantidades e total do servidor. Falha de rede não aparenta sucesso.
- SF-003: Casos R$0,01, R$999,99, R$1000, R$1500 e R$15000 mantêm valor exato no card, carrinho e pagamento.
- API-005: Subir production com a flag desligada: compra deve funcionar; listar/alterar orçamento sem principal deve falhar em qualquer configuração.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
