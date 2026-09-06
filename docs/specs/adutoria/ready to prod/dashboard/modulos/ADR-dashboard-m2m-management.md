# ADR — Dashboard / m2m-management

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-036](<../../api/ADR-api-public-api.md#api-036>) — Maioria dos controllers públicos não entra no AppModule: Existência de controller/SDK/OpenAPI não implica endpoint em produção; integrações públicas anunciadas podem retornar 404.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/m2m-management.ts:39](<../../../../../../apps/dashboard/src/api/endpoints/m2m-management.ts#L39>) | GET | /m2m/agents | Alcançável: negotiation /m2m/agents | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/m2m-management.ts:43](<../../../../../../apps/dashboard/src/api/endpoints/m2m-management.ts#L43>) | POST | /m2m/agents | Alcançável: negotiation /m2m/agents | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/m2m-management.ts:47](<../../../../../../apps/dashboard/src/api/endpoints/m2m-management.ts#L47>) | PUT | /m2m/agents/{encodeURIComponent(agentId)}/suspend | Alcançável: negotiation /m2m/agents/:id/suspend | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/m2m-management.ts:51](<../../../../../../apps/dashboard/src/api/endpoints/m2m-management.ts#L51>) | GET | /m2m/protocol/config | Alcançável: negotiation /m2m/protocol/config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/m2m-management.ts:55](<../../../../../../apps/dashboard/src/api/endpoints/m2m-management.ts#L55>) | PUT | /m2m/protocol/config | Alcançável: negotiation /m2m/protocol/config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/m2m-management.ts:62](<../../../../../../apps/dashboard/src/api/endpoints/m2m-management.ts#L62>) | GET | /audit/events?{query} | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-036: Subir AppModule production e executar smoke por método/path das rotas suportadas, com casos 401/403/404 e consumidores reais.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
