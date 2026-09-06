# ADR — Dashboard / catalog

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-001](<../../api/ADR-api-catalog.md#api-001>) — Reserva e mídia permitem operar recursos de outra loja: Com IDs conhecidos, uma conta da loja A pode reservar estoque ou excluir mídia da loja B. A autenticação do merchant no caminho não valida o recurso referenciado.
- [API-002](<../../api/ADR-api-catalog.md#api-002>) — Reserva concorrente pode ultrapassar estoque disponível: Overselling, reserved negativo e baixa duplicada sob concorrência, múltiplos depósitos ou execução paralela do job.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/catalog.ts:136](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L136>) | GET | /merchants/{encodeURIComponent(merchantId)}/products?{query} | Alcançável: catalog /merchants/:mid/products | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:144](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L144>) | GET | /merchants/{encodeURIComponent(merchantId)}/products/{encodeURIComponent(productId)} | Alcançável: catalog /merchants/:mid/products/:pid | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:152](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L152>) | POST | /merchants/{encodeURIComponent(merchantId)}/products | Alcançável: catalog /merchants/:mid/products | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:160](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L160>) | PUT | /merchants/{encodeURIComponent(merchantId)}/products/{encodeURIComponent(productId)} | Alcançável: catalog /merchants/:mid/products/:pid | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:168](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L168>) | DELETE | /merchants/{encodeURIComponent(merchantId)}/products/{encodeURIComponent(productId)} | Alcançável: catalog /merchants/:mid/products/:pid | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:176](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L176>) | PUT | /merchants/{encodeURIComponent(merchantId)}/products/{encodeURIComponent(productId)}/variants/{encodeURIComponent(variantId)} | Alcançável: catalog /merchants/:mid/products/:pid/variants/:vid | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:184](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L184>) | POST | /merchants/{encodeURIComponent(merchantId)}/products/media | Alcançável: catalog /merchants/:mid/products/media | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:192](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L192>) | DELETE | /merchants/{encodeURIComponent(merchantId)}/products/media/{encodeURIComponent(mediaId)} | Alcançável: catalog /merchants/:mid/products/media/:mediaId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:200](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L200>) | GET | /merchants/{encodeURIComponent(merchantId)}/categories | Alcançável: catalog /merchants/:mid/categories | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:208](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L208>) | POST | /merchants/{encodeURIComponent(merchantId)}/categories | Alcançável: catalog /merchants/:mid/categories | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:216](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L216>) | PUT | /merchants/{encodeURIComponent(merchantId)}/categories/{encodeURIComponent(id)} | Alcançável: catalog /merchants/:mid/categories/:cid | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:224](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L224>) | DELETE | /merchants/{encodeURIComponent(merchantId)}/categories/{encodeURIComponent(id)} | Alcançável: catalog /merchants/:mid/categories/:cid | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:232](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L232>) | PATCH | /merchants/{encodeURIComponent(merchantId)}/categories/reorder | Alcançável: catalog /merchants/:mid/categories/reorder | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:240](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L240>) | POST | /merchants/{encodeURIComponent(merchantId)}/products/generate-description | Alcançável: catalog /merchants/:mid/products/generate-description | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/catalog.ts:248](<../../../../../../apps/dashboard/src/api/endpoints/catalog.ts#L248>) | POST | /merchants/{encodeURIComponent(merchantId)}/products/{encodeURIComponent(productId)}/generate-seo | Alcançável: catalog /merchants/:mid/products/:pid/generate-seo | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-001: Duas lojas: reservar variante, anexar mídia e excluir mídia alheias deve retornar 403/404 sem alterar nenhuma linha. Repetir usando todos os aliases HTTP.
- API-002: Em PostgreSQL, disparar 100 reservas para uma unidade: exatamente uma deve vencer. Competir confirm/expire/retry e provar conservation de quantity/reserved por depósito.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
