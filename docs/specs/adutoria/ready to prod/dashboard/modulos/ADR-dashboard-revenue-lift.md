# ADR — Dashboard / revenue-lift

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **CONDITIONAL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-034](<../../api/ADR-api-revenue-lift.md#api-034>) — Atribuição monetária usa unidade divergente e só é logada neste fluxo: Revenue lift pode ficar vazio ou representar valores escalados incorretamente; não há evidência de medição confiável de incrementalidade.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/revenue-lift.ts:39](<../../../../../../apps/dashboard/src/api/endpoints/revenue-lift.ts#L39>) | GET | /analytics/revenue-lift{qs} | Alcançável: revenue-lift /analytics/revenue-lift | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/revenue-lift.ts:44](<../../../../../../apps/dashboard/src/api/endpoints/revenue-lift.ts#L44>) | GET | /analytics/revenue-lift/trend{qs} | Alcançável: revenue-lift /analytics/revenue-lift/trend | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-034: Pedido de R$100 deve persistir 10000 centavos; relatório precisa reconciliar população, conversões e custos com eventos de origem.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
