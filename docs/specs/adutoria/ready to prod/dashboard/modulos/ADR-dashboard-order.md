# ADR — Dashboard / order

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-022](<../../api/ADR-api-operations.md#api-022>) — Cancelamento local pode encerrar antes do cancelamento externo: Pedido parece cancelado, mas o provedor pode continuar cobrando/processando; retry da mesma ação não repara a divergência.
- [API-023](<../../api/ADR-api-shipping.md#api-023>) — Compra de etiqueta precede validação do pedido: Pode gastar em etiqueta para pedido inexistente ou deixar etiqueta comprada sem vínculo quando persistência falha.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/order.ts:11](<../../../../../../apps/dashboard/src/api/endpoints/order.ts#L11>) | GET | /orders{query} | Alcançável: operations /orders<br>Não montada: public-api /orders | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/order.ts:19](<../../../../../../apps/dashboard/src/api/endpoints/order.ts#L19>) | PUT | /orders/{encodeURIComponent(orderId)}/tracking | Alcançável: operations /orders/:orderId/tracking | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/order.ts:27](<../../../../../../apps/dashboard/src/api/endpoints/order.ts#L27>) | PUT | /orders/{encodeURIComponent(orderId)}/status | Alcançável: operations /orders/:orderId/status | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/order.ts:44](<../../../../../../apps/dashboard/src/api/endpoints/order.ts#L44>) | POST | /shipping/labels | Alcançável: shipping /shipping/labels | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-022: Falhar o provedor após update local e reiniciar: cancelamento deve continuar pendente e ser retomado sem duplicar reembolso.
- API-023: Pedido inexistente/alheio nunca chama provedor; timeout após compra deve recuperar a mesma etiqueta e rastreio.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
