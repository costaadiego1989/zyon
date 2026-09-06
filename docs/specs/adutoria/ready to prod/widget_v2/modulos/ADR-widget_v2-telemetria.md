# ADR — Widget v2 / telemetria

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **CONDITIONAL**.

[Relatório do app](<../ADR-widget_v2.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [W2-008](<../ADR-widget_v2.md#w2-008>) — Tracking envia campos diferentes do contrato e não captura rejeição assíncrona: Funil, abandono e gatilhos deixam de refletir ações reais sem erro visível; análise de conversão perde confiabilidade.
- [API-034](<../../api/ADR-api-revenue-lift.md#api-034>) — Atribuição monetária usa unidade divergente e só é logada neste fluxo: Revenue lift pode ficar vazio ou representar valores escalados incorretamente; não há evidência de medição confiável de incrementalidade.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/widget_v2/src/lib/tracking.ts:37](<../../../../../../apps/widget_v2/src/lib/tracking.ts#L37>) | POST | {api.apiBaseUrl}/embed/track | Alcançável: embed /embed/track | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- W2-008: Cada evento da UI aceito pelo backend persiste com sessão e metadata; 400/rede indisponível são mensuráveis sem Promise rejeitada não tratada.
- API-034: Pedido de R$100 deve persistir 10000 centavos; relatório precisa reconciliar população, conversões e custos com eventos de origem.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
