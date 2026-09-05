# ADR — Storefront / marketplace

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-storefront.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [SF-004](<../ADR-storefront.md#sf-004>) — Busca marketplace envia query e interpreta envelope errados: Busca pode parecer sem resultados mesmo com catálogo disponível; list retorna 404.
- [API-006](<../../api/ADR-api-marketplace.md#api-006>) — Chargeback administrativo não recebe nem valida a loja: Uma loja autenticada com ID conhecido pode cancelar liquidação ou criar dívida de outro vendedor.

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
| [apps/storefront/src/lib/hooks/useMarketplaceSearch.ts:58](<../../../../../../apps/storefront/src/lib/hooks/useMarketplaceSearch.ts#L58>) | GET | {API_BASE}/storefront/marketplace/search?{params.toString()} | Alcançável: storefront /storefront/marketplace/search | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/hooks/useMarketplaceSearch.ts:94](<../../../../../../apps/storefront/src/lib/hooks/useMarketplaceSearch.ts#L94>) | POST | {API_BASE}/storefront/marketplace/items | Alcançável: storefront /storefront/marketplace/items | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- SF-004: Busca por produto indexado retorna o item correto para host autorizado; ausência real e erro HTTP têm estados distintos.
- API-006: Settlement de B não pode ser afetado por A; replay do evento do provedor não duplica dívida; falha entre transição e criação deve reverter ou ser recuperada.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
