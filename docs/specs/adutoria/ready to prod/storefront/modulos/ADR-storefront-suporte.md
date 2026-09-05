# ADR — Storefront / suporte

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-storefront.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-041](<../../api/ADR-api-support.md#api-041>) — Gateway permite ouvir tickets e enviar mensagens como merchant sem autenticação: Conhecendo IDs, qualquer conexão pode receber tickets/mensagens e se passar por atendente. Os guards dos controllers HTTP não cobrem o gateway.
- [W2-009](<../../widget_v2/ADR-widget_v2.md#w2-009>) — Suporte responde políticas fixas em vez das configurações da loja: Promessas ao comprador podem contrariar configurações reais. Endurecer o backend sem atualizar socket rompe atendimento.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/storefront/src/components/SupportPanel.tsx:47](<../../../../../../apps/storefront/src/components/SupportPanel.tsx#L47>) | POST | /api/checkout-token | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/SupportPanel.tsx:175](<../../../../../../apps/storefront/src/components/SupportPanel.tsx#L175>) | POST | /api/checkout-token | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/SupportPanel.tsx:191](<../../../../../../apps/storefront/src/components/SupportPanel.tsx#L191>) | POST | {API_BASE}/support/chat | Alcançável: support /support/chat | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-041: Socket anônimo/alheio não entra em sala nem envia mensagem; buyer não consegue assumir papel merchant mesmo enviando IDs válidos.
- W2-009: Alterar FAQ no dashboard muda conteúdo exibido; falha na API não inventa política; buyer recebe somente o seu ticket.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
