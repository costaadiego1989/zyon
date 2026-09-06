# ADR — Dashboard / billing

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-039](<../../api/ADR-api-shared.md#api-039>) — Auditoria de dependências retornou avisos de segurança pendentes: Release exige triagem de alcançabilidade e atualização das dependências afetadas. Exemplos reportados incluem multer, ws, protobufjs, undici e sharp.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/billing.ts:13](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L13>) | GET | /billing/subscription | Alcançável: payment /billing/subscription<br>Não montada: public-api /billing/subscription | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:16](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L16>) | POST | /billing/checkout-session | Alcançável: payment /billing/checkout-session | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:19](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L19>) | POST | /billing/portal-session | Alcançável: payment /billing/portal-session | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:24](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L24>) | GET | /payments/connections | Alcançável: operations /payments/:paymentId<br>Alcançável: payment /payments/connections | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:28](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L28>) | POST | /payments/connections/stripe/onboarding-link | Alcançável: payment /payments/connections/stripe/onboarding-link | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:31](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L31>) | POST | /payments/connections/stripe/sync | Alcançável: payment /payments/connections/stripe/sync | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:34](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L34>) | POST | /merchants/me/payment-connections/asaas | Alcançável: payment /merchants/me/payment-connections/asaas | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:37](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L37>) | POST | /payments/connections/asaas | Alcançável: payment /payments/connections/asaas | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:40](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L40>) | POST | /payments/connections/asaas/onboarding-link | Alcançável: payment /payments/connections/asaas/onboarding-link | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:43](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L43>) | POST | /payments/connections/asaas/sync | Alcançável: payment /payments/connections/asaas/sync | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:46](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L46>) | POST | /merchants/me/payment-connections/mercadopago/oauth-link | Alcançável: payment /merchants/me/payment-connections/mercadopago/oauth-link | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:49](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L49>) | POST | /merchants/me/payment-connections/mercadopago/sync | Alcançável: payment /merchants/me/payment-connections/mercadopago/sync | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/billing.ts:52](<../../../../../../apps/dashboard/src/api/endpoints/billing.ts#L52>) | POST | /merchants/me/crypto-payments/enable | Alcançável: merchant /merchants/me/crypto-payments/enable | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-039: Nenhum high/critical alcançável sem mitigação comprovada; SBOM e audit do lockfile final anexados à release.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
