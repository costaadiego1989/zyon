# ADR — Dashboard / negotiation

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-043](<../../api/ADR-api-checkout.md#api-043>) — Preço e frete iniciais podem vir do cliente sem revalidação de catálogo: Token embed com checkout:start pode inicializar itens, descontos ou frete adulterados e alimentar intenção com valor inferior ao catálogo quando não há commerceCartRef. Guard de tenant não garante autoridade de preço.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/negotiation.ts:14](<../../../../../../apps/dashboard/src/api/endpoints/negotiation.ts#L14>) | GET | /merchant-negotiation-policy | Alcançável: negotiation /merchant-negotiation-policy | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/negotiation.ts:17](<../../../../../../apps/dashboard/src/api/endpoints/negotiation.ts#L17>) | PUT | /merchant-negotiation-policy | Alcançável: negotiation /merchant-negotiation-policy | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/negotiation.ts:24](<../../../../../../apps/dashboard/src/api/endpoints/negotiation.ts#L24>) | GET | /negotiations/sessions?{query} | Alcançável: negotiation /negotiations/sessions | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/negotiation.ts:28](<../../../../../../apps/dashboard/src/api/endpoints/negotiation.ts#L28>) | GET | /negotiations/stats{qs} | Alcançável: negotiation /negotiations/stats | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/negotiation.ts:33](<../../../../../../apps/dashboard/src/api/endpoints/negotiation.ts#L33>) | POST | /negotiations/evaluate | Alcançável: negotiation /negotiations/evaluate | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-043: Alterar price,total,currentDiscount,shipping e campos customer.*_verified no body não altera o valor autorizado nem o estado de autenticação; SKU desconhecido deve falhar.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
