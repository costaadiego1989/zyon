# ADR — Dashboard / webhook

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [DASH-005](<../ADR-dashboard.md#dash-005>) — Salvar configurações busca ETag novo e pode sobrescrever edição concorrente: Um formulário antigo pode adquirir o ETag mais recente e sobrescrever mudanças alheias sem apresentar conflito ao usuário.
- [API-018](<../../api/ADR-api-integrations.md#api-018>) — Envio de webhook passa Agent incompatível ao fetch: Entregas que passam pela fixação de DNS falham antes da conexão, consomem retries e não chegam ao destinatário.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/webhook.ts:17](<../../../../../../apps/dashboard/src/api/endpoints/webhook.ts#L17>) | GET | /webhook-endpoints | Alcançável: integrations /webhook-endpoints | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/webhook.ts:27](<../../../../../../apps/dashboard/src/api/endpoints/webhook.ts#L27>) | POST | /webhook-endpoints | Alcançável: integrations /webhook-endpoints | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/webhook.ts:37](<../../../../../../apps/dashboard/src/api/endpoints/webhook.ts#L37>) | PUT | /webhook-endpoints/{encodeURIComponent(endpointId)} | Alcançável: integrations /webhook-endpoints/:endpointId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/webhook.ts:47](<../../../../../../apps/dashboard/src/api/endpoints/webhook.ts#L47>) | POST | /webhook-endpoints/{encodeURIComponent(endpointId)}/test | Alcançável: integrations /webhook-endpoints/:endpointId/test | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/webhook.ts:58](<../../../../../../apps/dashboard/src/api/endpoints/webhook.ts#L58>) | GET | /webhook-endpoints | Alcançável: integrations /webhook-endpoints | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/webhook.ts:67](<../../../../../../apps/dashboard/src/api/endpoints/webhook.ts#L67>) | GET | /webhook-endpoints/{encodeURIComponent(endpoint.id)}/deliveries{query} | Alcançável: integrations /webhook-endpoints/:endpointId/deliveries | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/webhook.ts:81](<../../../../../../apps/dashboard/src/api/endpoints/webhook.ts#L81>) | POST | /webhook-endpoints/{encodeURIComponent(endpointId)}/deliveries/{encodeURIComponent(deliveryId)}/replay | Alcançável: integrations /webhook-endpoints/:endpointId/deliveries/:deliveryId/replay | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- DASH-005: Duas abas editam o mesmo campo a partir de V1: salvar A gera V2 e salvar B deve apresentar conflito sem sobrescrever V2.
- API-018: Servidor local recebe uma entrega com assinatura válida pelo adaptador real; cobrir IPv4/IPv6, redirecionamento bloqueado, timeout e retry.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
