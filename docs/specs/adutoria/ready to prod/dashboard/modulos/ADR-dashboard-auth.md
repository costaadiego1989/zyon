# ADR — Dashboard / auth

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [DASH-002](<../ADR-dashboard.md#dash-002>) — Configurações de conta chamam endpoints ausentes: Leitura/edição da conta e troca de senha pela tela falham com 404 na composição auditada.
- [API-009](<../../api/ADR-api-auth.md#api-009>) — Refresh reutiliza token expirado e revogação não é compartilhada: Replay após rotação; revogação não acompanha réplicas/restart.
- [API-010](<../../api/ADR-api-auth.md#api-010>) — Recuperação de senha depende de memória local: Link de reset pode falhar em outra réplica/restart; token previamente emitido pode continuar aceito.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/auth.ts:7](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L7>) | POST | /auth/login | Alcançável: auth /auth/login | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/auth.ts:16](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L16>) | POST | /auth/register | Alcançável: auth /auth/register | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/auth.ts:25](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L25>) | POST | /auth/oauth/callback | Alcançável: auth /auth/oauth/callback | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/auth.ts:34](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L34>) | POST | /auth/logout | Alcançável: auth /auth/logout | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/auth.ts:38](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L38>) | POST | /auth/forgot-password | Alcançável: auth /auth/forgot-password | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/auth.ts:42](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L42>) | POST | /auth/reset-password | Alcançável: auth /auth/reset-password | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/auth.ts:46](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L46>) | GET | /auth/me | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/auth.ts:50](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L50>) | PUT | /auth/me | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/auth.ts:54](<../../../../../../apps/dashboard/src/api/endpoints/auth.ts#L54>) | PUT | /auth/me/password | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- DASH-002: Teste de contrato monta AppModule e cobre leitura, update e senha atual incorreta/correta; tela só informa sucesso após resposta real.
- API-009: Mesmo token expirado só pode gerar um refresh; duas réplicas e dois requests paralelos devem obter um vencedor. Logout/reset/removal devem invalidar a sessão.
- API-010: Gerar reset na réplica A e concluir na B após restart; replay deve falhar; token anterior à troca de senha deve ser rejeitado.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
