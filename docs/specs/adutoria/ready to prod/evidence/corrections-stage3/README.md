# Evidências da terceira etapa

Implementação: `9d09a83baaa9b8f51a298de746af5ed6d1db31cb`. Base: `ebb954a`. Branch: `fix/ready-to-prod-audit`. Decisão: **NO-GO**.

O [relatório da etapa](../../CORRECOES-ETAPA-3.md) descreve o comportamento, as migrações e os limites. A [situação acumulada](../corrections/correction-status.json) mantém todos os gates de produção abertos.

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Seleção consolidada com PostgreSQL/Redis | 1.140 testes, 1.099 pass, 33 fail, 8 skip | [Log completo](combined-tests.log) |
| Baseline com seleção ampliada | 1.028 testes, 987 pass, 33 fail, 8 skip | [Log da baseline](baseline-tests.log) |
| Comparação por nome de falha | Nenhum nome novo; falhas anteriores permanecem | [Comparação](baseline-comparison.json) |
| Typecheck isolado | PASS, sem diagnósticos | [Log](api-typecheck.log) |
| Compilação isolada | PASS, sem diagnósticos | [Log](api-compile.log) |
| HTTP real adicional | 3/3 pass | [Log](http-integration.log) |
| Composição Nest | PASS | [Log](nest-composition.log) |

O [resumo estruturado](verification-summary.json) registra escopo e limitações. O [manifest](implementation-manifest.json) contém SHA-256 dos bytes verificados dos 80 arquivos alterados na implementação. Os logs foram convertidos para UTF-8/LF e tiveram espaços finais removidos; diagnósticos e falhas foram preservados. Logs de compilação vazios representam ausência de diagnósticos, com exit code 0 registrado no resumo.

## Reprodução local

Preparar o client Prisma isolado e o schema no banco descartável conforme o [procedimento da segunda etapa](../corrections-stage2/README.md). Usar o schema atual, incluindo as três migrações desta etapa. O runner exige PostgreSQL em loopback no banco `ready_prod_test`, client Prisma próprio e Redis em loopback nas variáveis `READY_PROD_TEST_DATABASE_URL`, `READY_PROD_TEST_PRISMA_CLIENT` e `READY_PROD_TEST_REDIS_URL`.

```powershell
node apps/api/tests/run-ready-prod-tests.mjs --database
node node_modules/typescript/bin/tsc -p .audit/verification/api-isolated-tsconfig.json --incremental false --noEmit
node node_modules/typescript/bin/tsc -p .audit/verification/api-isolated-tsconfig.json --incremental false --outDir .audit/verification/compiled --noEmitOnError true
node --loader ./apps/api/tests/ready-prod-runtime-loader.mjs --test apps/api/tests/security-stage2-http.integration.test.mjs
node --loader ./apps/api/tests/ready-prod-runtime-loader.mjs apps/api/tests/ready-prod-composition.mjs
```

A baseline foi extraída de `ebb954a` com o mesmo seletor ampliado e aliases locais, sem executar testes de banco novos que não existiam naquele commit. Isso explica o aumento da quantidade de testes. A comparação por nomes inclui suites e não prova ausência de regressões fora da seleção ou em nomes duplicados.

Os testes exercitam falha de commit, CAS, concorrência, replay, escopo de tenant, migrações aditivas e lifecycle do dispatcher com banco real. Não validam o lifecycle de toda a aplicação, build limpo de release, deploy, browser dos fronts, carga ou provedores reais. Sete testes financeiros externos permanecem explicitamente ignorados. A composição Nest não executa `app.init/listen`; os avisos de serviços externos não configurados são esperados nesse ambiente.

O registro de [limpeza dos containers](container-cleanup.json) identifica apenas os serviços descartáveis deste lote. A [validação dos documentos](document-validation.json) verifica links locais do material alterado e a integridade dos hashes de implementação.
