# ADR — Dashboard / experiments

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **CONDITIONAL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-034](<../../api/ADR-api-revenue-lift.md#api-034>) — Atribuição monetária usa unidade divergente e só é logada neste fluxo: Revenue lift pode ficar vazio ou representar valores escalados incorretamente; não há evidência de medição confiável de incrementalidade.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/experiments.ts:16](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L16>) | GET | /dashboard/experiments | Alcançável: experiments /dashboard/experiments | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/experiments.ts:21](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L21>) | GET | /dashboard/experiments/{encodeURIComponent(experimentId)} | Alcançável: experiments /dashboard/experiments/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/experiments.ts:41](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L41>) | POST | /dashboard/experiments | Alcançável: experiments /dashboard/experiments | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/experiments.ts:57](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L57>) | PUT | /dashboard/experiments/{encodeURIComponent(experimentId)} | Alcançável: experiments /dashboard/experiments/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/experiments.ts:66](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L66>) | POST | /dashboard/experiments/{encodeURIComponent(experimentId)}/start | Alcançável: experiments /dashboard/experiments/:id/start | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/experiments.ts:75](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L75>) | POST | /dashboard/experiments/{encodeURIComponent(experimentId)}/stop | Alcançável: experiments /dashboard/experiments/:id/stop | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/experiments.ts:84](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L84>) | POST | /dashboard/experiments/{encodeURIComponent(experimentId)}/archive | Alcançável: experiments /dashboard/experiments/:id/archive | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/experiments.ts:93](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L93>) | GET | /dashboard/experiments/{encodeURIComponent(experimentId)}/results | Alcançável: experiments /dashboard/experiments/:id/results | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/experiments.ts:118](<../../../../../../apps/dashboard/src/api/endpoints/experiments.ts#L118>) | POST | /dashboard/experiments/{encodeURIComponent(experimentId)}/promote | Alcançável: experiments /dashboard/experiments/:id/promote | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-034: Pedido de R$100 deve persistir 10000 centavos; relatório precisa reconciliar população, conversões e custos com eventos de origem.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
