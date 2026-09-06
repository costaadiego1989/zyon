# ADR — Dashboard / http-e-shell

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-009](<../../api/ADR-api-auth.md#api-009>) — Refresh reutiliza token expirado e revogação não é compartilhada: Replay após rotação; revogação não acompanha réplicas/restart.
- [API-041](<../../api/ADR-api-support.md#api-041>) — Gateway permite ouvir tickets e enviar mensagens como merchant sem autenticação: Conhecendo IDs, qualquer conexão pode receber tickets/mensagens e se passar por atendente. Os guards dos controllers HTTP não cobrem o gateway.
- [DASH-006](<../ADR-dashboard.md#dash-006>) — Suíte atual contém 33 falhas e cobertura de contrato insuficiente: Não há baseline verde para afirmar regressão controlada. Testes de fonte/snapshot que passam não garantem rotas/DTOs da API montada.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/external/via-cep.ts:17](<../../../../../../apps/dashboard/src/api/external/via-cep.ts#L17>) | GET | https://viacep.com.br/ws/{cepDigits}/json/ | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/http/client.ts:94](<../../../../../../apps/dashboard/src/api/http/client.ts#L94>) | GET | path | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/auth/OAuthCallback.tsx:45](<../../../../../../apps/dashboard/src/auth/OAuthCallback.tsx#L45>) | POST | {base}/auth/oauth/callback | Alcançável: auth /auth/oauth/callback | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/pages/cart-recovery/CartRecoveryPage.tsx:171](<../../../../../../apps/dashboard/src/pages/cart-recovery/CartRecoveryPage.tsx#L171>) | POST | {props.apiBaseUrl}/cart-recovery/test-send | Alcançável: cart-recovery /cart-recovery/test-send | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/pages/chargebacks/ChargebackDisputeChat.tsx:39](<../../../../../../apps/dashboard/src/pages/chargebacks/ChargebackDisputeChat.tsx#L39>) | GET | {props.apiBaseUrl}/marketplace/dashboard/chargebacks/{props.chargebackId} | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/pages/chargebacks/ChargebackDisputeChat.tsx:65](<../../../../../../apps/dashboard/src/pages/chargebacks/ChargebackDisputeChat.tsx#L65>) | POST | {props.apiBaseUrl}/marketplace/dashboard/chargebacks/{props.chargebackId}/dispute | Alcançável: marketplace /marketplace/dashboard/chargebacks/:id/dispute | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/pages/chargebacks/useChargebacksPage.ts:29](<../../../../../../apps/dashboard/src/pages/chargebacks/useChargebacksPage.ts#L29>) | GET | {apiBaseUrl}/marketplace/dashboard/chargebacks | Alcançável: marketplace /marketplace/dashboard/chargebacks | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/shell/DashboardShell.tsx:184](<../../../../../../apps/dashboard/src/shell/DashboardShell.tsx#L184>) | GET | {API_BASE_URL}/merchants/{me.id}/notifications?since={encodeURIComponent(lastCheck)} | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-009: Mesmo token expirado só pode gerar um refresh; duas réplicas e dois requests paralelos devem obter um vencedor. Logout/reset/removal devem invalidar a sessão.
- API-041: Socket anônimo/alheio não entra em sala nem envia mensagem; buyer não consegue assumir papel merchant mesmo enviando IDs válidos.
- DASH-006: Suíte oficial passa com expectativas justificadas e testes novos detectam os caminhos ausentes registrados nesta auditoria.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
