# ADR — Storefront / sessao-e-proxy

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-storefront.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-044](<../../api/ADR-api-embed.md#api-044>) — Emissão via storefront transforma parâmetros públicos em credencial de tenant: Qualquer caller da rota pode solicitar token com escopos de checkout/pagamento para tenant/origem escolhidos, ampliando o impacto dos defeitos de ownership e preço.
- [SF-006](<../ADR-storefront.md#sf-006>) — Proxy /api/v1 troca credenciais de buyer/embed por chave de serviço: Consumidores desse proxy não conseguem manter autenticação buyer/embed conforme o contrato; chave de um merchant não pode representar compradores de múltiplas lojas.
- [API-005](<../../api/ADR-api-storefront.md#api-005>) — Flag de legado expõe consultas e mutações administrativas sem autenticação: Com a flag ligada: exposição de dados de orçamento e alterações indevidas. Com ela desligada: fluxos dos fronts dependentes retornam 404. Estado real da flag no deploy não foi consultado.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/storefront/src/app/api/checkout-token/route.ts:46](<../../../../../../apps/storefront/src/app/api/checkout-token/route.ts#L46>) | GET | {API_BASE}/embed-sessions | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/app/api/v1/[...path]/route.ts:87](<../../../../../../apps/storefront/src/app/api/v1/[...path]/route.ts#L87>) | GET | {API_BASE_URL}/v1/{path}?{query} | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/server-client.ts:18](<../../../../../../apps/storefront/src/lib/api/server-client.ts#L18>) | GET | url | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/server-client.ts:34](<../../../../../../apps/storefront/src/lib/api/server-client.ts#L34>) | GET | {API_BASE_URL}/storefront/{slug}/config | Alcançável: storefront /storefront/:slug/config<br>Alcançável: storefront /storefront/conversations/:conversationId<br>Alcançável: storefront /storefront/funnel/:merchantId<br>Alcançável: storefront /storefront/cart/:cartId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/server-client.ts:39](<../../../../../../apps/storefront/src/lib/api/server-client.ts#L39>) | GET | {API_BASE_URL}/storefront/{slug}/stories | Alcançável: storefront /storefront/:slug/stories<br>Alcançável: storefront /storefront/conversations/:conversationId<br>Alcançável: storefront /storefront/funnel/:merchantId<br>Alcançável: storefront /storefront/cart/:cartId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/api/server-client.ts:45](<../../../../../../apps/storefront/src/lib/api/server-client.ts#L45>) | GET | {API_BASE_URL}/storefront/index | Alcançável: storefront /storefront/index | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-044: Host de A não emite token de B, origem arbitrária é rejeitada e carrinho alheio não pode ser vinculado. Emissão anônima legítima permanece limitada ao contexto autorizado.
- SF-006: No proxy, buyer A e embed B preservam escopo correto; refresh/cookies e origem funcionam sem expor chave de serviço.
- API-005: Subir production com a flag desligada: compra deve funcionar; listar/alterar orçamento sem principal deve falhar em qualquer configuração.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
