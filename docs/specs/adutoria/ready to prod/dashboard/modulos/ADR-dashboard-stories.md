# ADR — Dashboard / stories

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-003](<../../api/ADR-api-stories.md#api-003>) — Atualização e arquivamento ignoram o tenant recebido: Uma loja autenticada pode modificar ou arquivar conteúdo de outra loja com um ID conhecido.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/stories.ts:52](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L52>) | GET | /story-manager/categories | Alcançável: stories /story-manager/categories | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:56](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L56>) | POST | /story-manager/categories | Alcançável: stories /story-manager/categories | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:63](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L63>) | PATCH | /story-manager/categories/{id} | Alcançável: stories /story-manager/categories/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:70](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L70>) | DELETE | /story-manager/categories/{id} | Alcançável: stories /story-manager/categories/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:74](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L74>) | POST | /story-manager/categories/reorder | Alcançável: stories /story-manager/categories/reorder | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:83](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L83>) | GET | /story-manager/categories/{categoryId}/stories | Alcançável: stories /story-manager/categories/:categoryId/stories | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:87](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L87>) | POST | /story-manager/categories/{categoryId}/stories | Alcançável: stories /story-manager/categories/:categoryId/stories | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:94](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L94>) | PATCH | /story-manager/{id} | Alcançável: stories /story-manager/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:101](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L101>) | DELETE | /story-manager/{id} | Alcançável: stories /story-manager/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:105](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L105>) | POST | /story-manager/reorder | Alcançável: stories /story-manager/reorder | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/stories.ts:112](<../../../../../../apps/dashboard/src/api/endpoints/stories.ts#L112>) | POST | /story-manager/upload | Alcançável: stories /story-manager/upload | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-003: Cobrir update/archive/reorder/create com categorias/stories de duas lojas; nenhuma associação ou alteração cruzada pode persistir.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
