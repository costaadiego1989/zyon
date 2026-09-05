# ADR — Dashboard / returns

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [DASH-003](<../ADR-dashboard.md#dash-003>) — Ações de devolução usam nomes de rotas divergentes: Operador não consegue emitir etiqueta nem registrar recebimento por essas ações; reembolso existente não pode ser considerado pronto.
- [API-007](<../../api/ADR-api-returns.md#api-007>) — Reembolso é declarado concluído sem devolver dinheiro: Operação financeira informa sucesso falso e usa valor sem relação com o pedido pago.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/returns.ts:43](<../../../../../../apps/dashboard/src/api/endpoints/returns.ts#L43>) | GET | /merchants/{encodeURIComponent(merchantId)}/returns?{query} | Alcançável: returns /merchants/:mid/returns | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/returns.ts:47](<../../../../../../apps/dashboard/src/api/endpoints/returns.ts#L47>) | POST | /merchants/{encodeURIComponent(merchantId)}/returns/{returnId}/generate-label | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/returns.ts:51](<../../../../../../apps/dashboard/src/api/endpoints/returns.ts#L51>) | POST | /merchants/{encodeURIComponent(merchantId)}/returns/{returnId}/mark-received | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/returns.ts:55](<../../../../../../apps/dashboard/src/api/endpoints/returns.ts#L55>) | POST | /merchants/{encodeURIComponent(merchantId)}/returns/{returnId}/inspect | Alcançável: returns /merchants/:mid/returns/:rid/inspect | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/returns.ts:59](<../../../../../../apps/dashboard/src/api/endpoints/returns.ts#L59>) | POST | /merchants/{encodeURIComponent(merchantId)}/returns/{returnId}/refund | Alcançável: returns /merchants/:mid/returns/:rid/refund | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- DASH-003: Fluxo real request→label→receive→inspect→refund deve usar contratos montados e exibir tracking/status confirmado.
- API-007: Testar estorno parcial/integral, retry, timeout após sucesso, chargeback prévio e duplicidade. Status COMPLETED precisa de providerRefundId e valor confirmado.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
