# ADR — Storefront / conversa

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-storefront.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-004](<../../api/ADR-api-storefront.md#api-004>) — WebSocket aceita salas de conversa sem autenticação ou vínculo: Um cliente que conheça o ID da conversa pode ouvir mensagens emitidas para ela. O gateway está registrado independentemente do bloqueio HTTP de rotas legadas.
- [API-042](<../../api/ADR-api-checkout.md#api-042>) — E-mail conhecido é tratado como prova de identidade do comprador: Informar o email de um comprador existente pode vincular a identidade dele e expor dados de perfil numa sessão nova. Histórico de verificação não prova posse no request atual.
- [SF-007](<../ADR-storefront.md#sf-007>) — Adapter de orçamento descarta dados e abre conversa: Se usado, o formulário não gera orçamento e perde contato do interessado. É lacuna latente, não prova de falha de uma tela ativa.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/storefront/src/components/ConversationShell.tsx:484](<../../../../../../apps/storefront/src/components/ConversationShell.tsx#L484>) | POST | {API_BASE}/v1/storefront/conversations/{encodeURIComponent(conversationId)}/events | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/lib/viewmodels/useConversationViewModel.ts:22](<../../../../../../apps/storefront/src/lib/viewmodels/useConversationViewModel.ts#L22>) | POST | {API_BASE}/v1/storefront/conversations/{encodeURIComponent(sessionId)}/events | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-004: Cliente anônimo, token de outra loja e buyer diferente não podem entrar nem receber eventos de uma conversa; testar reconexão e expiração.
- API-042: Sessão nova com email de vítima, sem OTP/buyer token, permanece não verificada e não recebe dados da conta. Cobrir início e captura por chat.
- SF-007: Teste do consumidor comprova criação e consulta de orçamento com campos corretos; nenhuma conversa substitui silenciosamente o orçamento.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
