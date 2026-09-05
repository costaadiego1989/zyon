# ADR — Dashboard / integration

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-018](<../../api/ADR-api-integrations.md#api-018>) — Envio de webhook passa Agent incompatível ao fetch: Entregas que passam pela fixação de DNS falham antes da conexão, consomem retries e não chegam ao destinatário.
- [API-021](<../../api/ADR-api-coupons.md#api-021>) — Limites de uso podem ser excedidos em sessões concorrentes: Cupom de uso único pode ser consumido mais vezes e falhas intermediárias podem desalinhar contador/evento.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/integration.ts:33](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L33>) | GET | /integrations/api-keys | Alcançável: integrations /integrations/api-keys | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:36](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L36>) | POST | /integrations/api-keys | Alcançável: integrations /integrations/api-keys | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:39](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L39>) | DELETE | /integrations/api-keys/{encodeURIComponent(apiKeyId)} | Alcançável: integrations /integrations/api-keys/:apiKeyId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:44](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L44>) | POST | /__test__/seed | Não montada: __test__ /__test__/seed | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:49](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L49>) | GET | /merchant/coupons | Alcançável: coupons /merchant/coupons | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:67](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L67>) | POST | /merchant/coupons | Alcançável: coupons /merchant/coupons | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:70](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L70>) | DELETE | /merchant/coupons/{encodeURIComponent(id)} | Alcançável: coupons /merchant/coupons/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:73](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L73>) | PATCH | /merchant/coupons/{encodeURIComponent(id)} | Alcançável: coupons /merchant/coupons/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:78](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L78>) | GET | /storefront/budget-requests?merchantId={encodeURIComponent(merchantId)} | Alcançável: storefront /storefront/budget-requests | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:86](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L86>) | POST | /storefront/budget-requests/{encodeURIComponent(requestId)}/status | Alcançável: storefront /storefront/budget-requests/:id/status | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:99](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L99>) | GET | /commerce/connections | Alcançável: commerce /commerce/connections<br>Não montada: public-api /commerce/connections | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:108](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L108>) | POST | /commerce/connections | Alcançável: commerce /commerce/connections<br>Não montada: public-api /commerce/connections | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:111](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L111>) | POST | /commerce/connections/test | Alcançável: commerce /commerce/connections/test | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:114](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L114>) | POST | /commerce/connections/sync | Alcançável: commerce /commerce/connections/sync | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:117](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L117>) | DELETE | /commerce/connections | Alcançável: commerce /commerce/connections | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:125](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L125>) | GET | /installations | Alcançável: installations /installations<br>Não montada: public-api /installations | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:134](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L134>) | GET | /installations/{encodeURIComponent(installationId)} | Alcançável: installations /installations/:installationId<br>Não montada: public-api /installations/:id | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/integration.ts:137](<../../../../../../apps/dashboard/src/api/endpoints/integration.ts#L137>) | GET | /installations/{encodeURIComponent(installationId)}/health | Alcançável: installations /installations/:installationId/health | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-018: Servidor local recebe uma entrega com assinatura válida pelo adaptador real; cobrir IPv4/IPv6, redirecionamento bloqueado, timeout e retry.
- API-021: Com maxUses=1, duas sessões/buyers paralelos produzem um consumo; crash em cada fronteira não altera cota nem publica em duplicidade.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
