# ADR — Dashboard / revenue-manager

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **CONDITIONAL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-033](<../../api/ADR-api-revenue-manager.md#api-033>) — Observação usa estimativas fixas como métricas: Hipóteses e decisões automáticas podem se apoiar em valores sintéticos apresentados como observação.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/revenue-manager.ts:89](<../../../../../../apps/dashboard/src/api/endpoints/revenue-manager.ts#L89>) | GET | /revenue-manager/hypotheses | Alcançável: revenue-manager /revenue-manager/hypotheses | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/revenue-manager.ts:96](<../../../../../../apps/dashboard/src/api/endpoints/revenue-manager.ts#L96>) | POST | /revenue-manager/hypotheses/{encodeURIComponent(id)}/approve | Alcançável: revenue-manager /revenue-manager/hypotheses/:id/approve | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/revenue-manager.ts:105](<../../../../../../apps/dashboard/src/api/endpoints/revenue-manager.ts#L105>) | POST | /revenue-manager/hypotheses/{encodeURIComponent(id)}/reject | Alcançável: revenue-manager /revenue-manager/hypotheses/:id/reject | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/revenue-manager.ts:114](<../../../../../../apps/dashboard/src/api/endpoints/revenue-manager.ts#L114>) | GET | /revenue-manager/observations | Alcançável: revenue-manager /revenue-manager/observations | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/revenue-manager.ts:122](<../../../../../../apps/dashboard/src/api/endpoints/revenue-manager.ts#L122>) | GET | /revenue-manager/strategy-lessons | Alcançável: revenue-manager /revenue-manager/strategy-lessons | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-033: Dataset sem eventos medidos não pode gerar taxa observada; decisão registra origem/amostra e exige dados suficientes.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
