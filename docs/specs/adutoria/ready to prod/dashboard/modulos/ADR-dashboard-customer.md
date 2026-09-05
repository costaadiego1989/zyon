# ADR — Dashboard / customer

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-042](<../../api/ADR-api-checkout.md#api-042>) — E-mail conhecido é tratado como prova de identidade do comprador: Informar o email de um comprador existente pode vincular a identidade dele e expor dados de perfil numa sessão nova. Histórico de verificação não prova posse no request atual.
- [API-032](<../../api/ADR-api-buyer-purchase-history.md#api-032>) — Histórico cresce sem limite nas leituras e saves: Custo de I/O e memória cresce com o comprador; recorrência deixa o caminho de checkout progressivamente mais caro.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/customer.ts:10](<../../../../../../apps/dashboard/src/api/endpoints/customer.ts#L10>) | GET | /customers{query} | Alcançável: operations /customers<br>Não montada: public-api /customers | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/customer.ts:23](<../../../../../../apps/dashboard/src/api/endpoints/customer.ts#L23>) | GET | /customers{query} | Alcançável: operations /customers<br>Não montada: public-api /customers | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/customer.ts:31](<../../../../../../apps/dashboard/src/api/endpoints/customer.ts#L31>) | GET | /customers/{encodeURIComponent(customerId)} | Alcançável: operations /customers/:customerId<br>Não montada: public-api /customers/:customerId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/customer.ts:46](<../../../../../../apps/dashboard/src/api/endpoints/customer.ts#L46>) | GET | /payments{query} | Alcançável: operations /payments | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/customer.ts:55](<../../../../../../apps/dashboard/src/api/endpoints/customer.ts#L55>) | GET | /checkout/dashboard/overview/{encodeURIComponent(merchantId)} | Alcançável: checkout /checkout/dashboard/overview/:merchantId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/customer.ts:63](<../../../../../../apps/dashboard/src/api/endpoints/customer.ts#L63>) | GET | /checkout/dashboard/store-overview/{encodeURIComponent(merchantId)}?period={encodeURIComponent(period)} | Alcançável: checkout /checkout/dashboard/store-overview/:merchantId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/customer.ts:71](<../../../../../../apps/dashboard/src/api/endpoints/customer.ts#L71>) | GET | /checkout/dashboard/overview/timeseries/{encodeURIComponent(merchantId)}?period={encodeURIComponent(period)} | Alcançável: checkout /checkout/dashboard/overview/timeseries/:merchantId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-042: Sessão nova com email de vítima, sem OTP/buyer token, permanece não verificada e não recebe dados da conta. Cobrir início e captura por chat.
- API-032: EXPLAIN e teste com 100 mil compras por buyer devem demonstrar leitura limitada e inserção sem regravar o histórico.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
