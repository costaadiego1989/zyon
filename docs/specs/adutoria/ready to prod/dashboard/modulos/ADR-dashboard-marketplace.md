# ADR — Dashboard / marketplace

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [DASH-004](<../ADR-dashboard.md#dash-004>) — Envio/entrega de marketplace apontam para rotas não declaradas: Ações de expedição/entrega do vendedor retornam 404 ou não evoluem settlement.
- [API-006](<../../api/ADR-api-marketplace.md#api-006>) — Chargeback administrativo não recebe nem valida a loja: Uma loja autenticada com ID conhecido pode cancelar liquidação ou criar dívida de outro vendedor.
- [API-008](<../../api/ADR-api-marketplace.md#api-008>) — Job marca transferência como realizada sem provedor: Dashboard e ledger podem afirmar que o vendedor recebeu valores que nunca foram transferidos.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/marketplace.ts:41](<../../../../../../apps/dashboard/src/api/endpoints/marketplace.ts#L41>) | GET | /marketplace/dashboard/config | Alcançável: marketplace /marketplace/dashboard/config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/marketplace.ts:48](<../../../../../../apps/dashboard/src/api/endpoints/marketplace.ts#L48>) | PATCH | /marketplace/dashboard/config | Alcançável: marketplace /marketplace/dashboard/config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/marketplace.ts:53](<../../../../../../apps/dashboard/src/api/endpoints/marketplace.ts#L53>) | GET | /marketplace/dashboard/orders | Alcançável: marketplace /marketplace/dashboard/orders | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/marketplace.ts:60](<../../../../../../apps/dashboard/src/api/endpoints/marketplace.ts#L60>) | GET | /marketplace/dashboard/stats | Alcançável: marketplace /marketplace/dashboard/stats | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/marketplace.ts:72](<../../../../../../apps/dashboard/src/api/endpoints/marketplace.ts#L72>) | POST | /marketplace/orders/line-items/{encodeURIComponent(lineItemId)}/ship | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/marketplace.ts:81](<../../../../../../apps/dashboard/src/api/endpoints/marketplace.ts#L81>) | POST | /marketplace/orders/line-items/{encodeURIComponent(lineItemId)}/deliver | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- DASH-004: Vendedor envia/entrega item próprio; item alheio falha; comando repetido não agenda transferência duplicada.
- API-006: Settlement de B não pode ser afetado por A; replay do evento do provedor não duplica dívida; falha entre transição e criação deve reverter ou ser recuperada.
- API-008: Nenhum transferred sem evidência do provedor; falha/reinício antes e depois do payout converge para uma única transferência.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
