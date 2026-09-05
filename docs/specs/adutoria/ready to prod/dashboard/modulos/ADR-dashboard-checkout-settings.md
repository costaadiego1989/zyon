# ADR — Dashboard / checkout-settings

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [DASH-005](<../ADR-dashboard.md#dash-005>) — Salvar configurações busca ETag novo e pode sobrescrever edição concorrente: Um formulário antigo pode adquirir o ETag mais recente e sobrescrever mudanças alheias sem apresentar conflito ao usuário.
- [W2-010](<../../widget_v2/ADR-widget_v2.md#w2-010>) — Desconto é anunciado sem autorização persistida: Banner pode prometer 5% que não chega ao total do pagamento e pode ultrapassar regra da loja.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/checkout-settings.ts:8](<../../../../../../apps/dashboard/src/api/endpoints/checkout-settings.ts#L8>) | GET | /checkout-settings | Alcançável: checkout-settings /checkout-settings | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/checkout-settings.ts:14](<../../../../../../apps/dashboard/src/api/endpoints/checkout-settings.ts#L14>) | GET | /checkout-settings | Alcançável: checkout-settings /checkout-settings | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/checkout-settings.ts:21](<../../../../../../apps/dashboard/src/api/endpoints/checkout-settings.ts#L21>) | PUT | /checkout-settings | Alcançável: checkout-settings /checkout-settings | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- DASH-005: Duas abas editam o mesmo campo a partir de V1: salvar A gera V2 e salvar B deve apresentar conflito sem sobrescrever V2.
- W2-010: Loja com desconto máximo zero nunca exibe oferta de 5%; oferta exibida deve ser reconciliada no pagamento.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
