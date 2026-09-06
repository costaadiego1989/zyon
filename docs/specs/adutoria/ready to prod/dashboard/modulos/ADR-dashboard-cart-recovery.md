# ADR — Dashboard / cart-recovery

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-019](<../../api/ADR-api-cart-recovery.md#api-019>) — Deduplicação das tentativas de recuperação é volátil: Restart ou múltiplas réplicas perdem histórico e podem reenviar mensagens; falha de envio pode ser tratada como tentativa consumida.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/cart-recovery.ts:38](<../../../../../../apps/dashboard/src/api/endpoints/cart-recovery.ts#L38>) | GET | /dashboard/cart-recovery/metrics | Alcançável: cart-recovery /dashboard/cart-recovery/metrics | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/cart-recovery.ts:47](<../../../../../../apps/dashboard/src/api/endpoints/cart-recovery.ts#L47>) | GET | /dashboard/cart-recovery/attempts | Alcançável: cart-recovery /dashboard/cart-recovery/attempts | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/cart-recovery.ts:54](<../../../../../../apps/dashboard/src/api/endpoints/cart-recovery.ts#L54>) | GET | /dashboard/cart-recovery/strategies | Alcançável: cart-recovery /dashboard/cart-recovery/strategies | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/cart-recovery.ts:63](<../../../../../../apps/dashboard/src/api/endpoints/cart-recovery.ts#L63>) | PATCH | /dashboard/cart-recovery/strategies | Alcançável: cart-recovery /dashboard/cart-recovery/strategies | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/cart-recovery.ts:73](<../../../../../../apps/dashboard/src/api/endpoints/cart-recovery.ts#L73>) | GET | /dashboard/cart-recovery/config | Alcançável: cart-recovery /dashboard/cart-recovery/config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/cart-recovery.ts:82](<../../../../../../apps/dashboard/src/api/endpoints/cart-recovery.ts#L82>) | PATCH | /dashboard/cart-recovery/config | Alcançável: cart-recovery /dashboard/cart-recovery/config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-019: Duas réplicas avaliando o mesmo carrinho produzem uma tentativa; restart e falha do WhatsApp preservam histórico e possibilidade de retry.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
