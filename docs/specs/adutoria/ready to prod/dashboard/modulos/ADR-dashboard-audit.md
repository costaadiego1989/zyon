# ADR — Dashboard / audit

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [API-028](<../../api/ADR-api-audit.md#api-028>) — Trilha de auditoria é gravada fora do commit da mutação: Uma alteração financeira/administrativa pode persistir sem evento de auditoria após crash ou erro de armazenamento.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/audit.ts:26](<../../../../../../apps/dashboard/src/api/endpoints/audit.ts#L26>) | GET | /audit-events{query} | Alcançável: audit /audit-events<br>Não montada: public-api /audit-events | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- API-028: Falha no registro de audit não pode criar mutação crítica sem trilha; retries devem conservar um evento lógico e não registrar segredos.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
