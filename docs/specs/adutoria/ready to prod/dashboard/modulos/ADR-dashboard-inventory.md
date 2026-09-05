# ADR — Dashboard / inventory

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-017](<../../api/ADR-api-inventory.md#api-017>) — Handler de venda injeta token incorreto e absorve falhas: Pedido concluído pode não baixar estoque nem sincronizar ERP/CRM; evento é considerado entregue sem retry.
- [API-002](<../../api/ADR-api-catalog.md#api-002>) — Reserva concorrente pode ultrapassar estoque disponível: Overselling, reserved negativo e baixa duplicada sob concorrência, múltiplos depósitos ou execução paralela do job.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/inventory.ts:77](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L77>) | GET | /dashboard/inventory/summary | Alcançável: inventory /dashboard/inventory/summary | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:96](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L96>) | GET | /dashboard/inventory/items?{query} | Alcançável: inventory /dashboard/inventory/items | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:109](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L109>) | POST | /dashboard/inventory/items/{encodeURIComponent(itemId)}/movements | Alcançável: inventory /dashboard/inventory/items/:id/movements | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:121](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L121>) | POST | /dashboard/inventory/items/transfer | Alcançável: inventory /dashboard/inventory/items/transfer | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:139](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L139>) | GET | /dashboard/inventory/movements?{query} | Alcançável: inventory /dashboard/inventory/movements | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:154](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L154>) | GET | /dashboard/inventory/alerts?{query} | Alcançável: inventory /dashboard/inventory/alerts | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:163](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L163>) | POST | /dashboard/inventory/alerts/{encodeURIComponent(alertId)}/acknowledge | Alcançável: inventory /dashboard/inventory/alerts/:id/acknowledge | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:172](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L172>) | GET | /dashboard/inventory/locations | Alcançável: inventory /dashboard/inventory/locations | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:184](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L184>) | POST | /dashboard/inventory/locations | Alcançável: inventory /dashboard/inventory/locations | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:195](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L195>) | GET | /dashboard/inventory/erp-connections | Alcançável: inventory /dashboard/inventory/erp-connections | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:208](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L208>) | POST | /dashboard/inventory/erp-connections/{encodeURIComponent(provider)}/connect | Alcançável: inventory /dashboard/inventory/erp-connections/:provider/connect | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:217](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L217>) | POST | /dashboard/inventory/erp-connections/{encodeURIComponent(connectionId)}/disconnect | Alcançável: inventory /dashboard/inventory/erp-connections/:id/disconnect | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:226](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L226>) | POST | /dashboard/inventory/erp-connections/{encodeURIComponent(connectionId)}/sync | Alcançável: inventory /dashboard/inventory/erp-connections/:id/sync | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:237](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L237>) | GET | /dashboard/inventory/crm-connections | Alcançável: inventory /dashboard/inventory/crm-connections | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:250](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L250>) | POST | /dashboard/inventory/crm-connections/{encodeURIComponent(provider)}/connect | Alcançável: inventory /dashboard/inventory/crm-connections/:provider/connect | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:259](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L259>) | POST | /dashboard/inventory/crm-connections/{encodeURIComponent(connectionId)}/disconnect | Alcançável: inventory /dashboard/inventory/crm-connections/:id/disconnect | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/inventory.ts:268](<../../../../../../apps/dashboard/src/api/endpoints/inventory.ts#L268>) | GET | /inventory/erp/oauth/{encodeURIComponent(provider)}/authorize | Alcançável: inventory /inventory/erp/oauth/:provider/authorize | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-017: Teste de composição Nest deve resolver a dependência real; evento order.completed baixa itens uma vez; falha no ERP gera retry independente sem repetir a baixa.
- API-002: Em PostgreSQL, disparar 100 reservas para uma unidade: exatamente uma deve vencer. Competir confirm/expire/retry e provar conservation de quantity/reserved por depósito.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
