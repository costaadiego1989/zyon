# ADR — Dashboard / funnel

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-005](<../../api/ADR-api-storefront.md#api-005>) — Flag de legado expõe consultas e mutações administrativas sem autenticação: Com a flag ligada: exposição de dados de orçamento e alterações indevidas. Com ela desligada: fluxos dos fronts dependentes retornam 404. Estado real da flag no deploy não foi consultado.
- [W2-008](<../../widget_v2/ADR-widget_v2.md#w2-008>) — Tracking envia campos diferentes do contrato e não captura rejeição assíncrona: Funil, abandono e gatilhos deixam de refletir ações reais sem erro visível; análise de conversão perde confiabilidade.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/funnel.ts:45](<../../../../../../apps/dashboard/src/api/endpoints/funnel.ts#L45>) | GET | /checkout/funnel/{encodeURIComponent(merchantId)} | Alcançável: checkout /checkout/funnel/:merchantId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/funnel.ts:63](<../../../../../../apps/dashboard/src/api/endpoints/funnel.ts#L63>) | GET | /storefront/funnel/{encodeURIComponent(merchantId)} | Alcançável: storefront /storefront/:slug/config<br>Alcançável: storefront /storefront/:slug/stories<br>Alcançável: storefront /storefront/:slug/logo<br>Alcançável: storefront /storefront/funnel/:merchantId | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/funnel.ts:67](<../../../../../../apps/dashboard/src/api/endpoints/funnel.ts#L67>) | GET | /checkout/funnel/{encodeURIComponent(merchantId)}/sessions | Alcançável: checkout /checkout/funnel/:merchantId/sessions | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/funnel.ts:76](<../../../../../../apps/dashboard/src/api/endpoints/funnel.ts#L76>) | GET | /storefront/funnel/{encodeURIComponent(merchantId)}/sessions | Alcançável: storefront /storefront/funnel/:merchantId/sessions | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-005: Subir production com a flag desligada: compra deve funcionar; listar/alterar orçamento sem principal deve falhar em qualquer configuração.
- W2-008: Cada evento da UI aceito pelo backend persiste com sessão e metadata; 400/rede indisponível são mensuráveis sem Promise rejeitada não tratada.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
