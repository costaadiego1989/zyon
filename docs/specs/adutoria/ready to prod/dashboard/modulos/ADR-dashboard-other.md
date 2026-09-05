# ADR — Dashboard / other

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **CONDITIONAL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

Nenhuma incompatibilidade específica confirmada neste agrupamento. O fluxo permanece condicionado à execução de contrato/browser, aos gates de build e aos achados globais de autenticação/tenant.

## Chamadas e provedor

Não foi extraído call site HTTP próprio. O componente pode delegar a outro client; conferir o ADR do app. Arquivo other.ts é shell obsoleto sem métodos e não deve ser tratado como capacidade implementada.

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- Montar API real e executar chamadas acima com dados válidos, tenant incorreto, credencial ausente e payload inválido.
- Verificar envelope, null/empty, paginação, 401/403/409/412/429, timeout e erro de rede no consumidor.
- Para mutações, provar retry idempotente e sincronização do estado exibido com a resposta persistida.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
