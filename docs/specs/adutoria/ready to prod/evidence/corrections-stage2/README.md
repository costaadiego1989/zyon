# Evidências — segunda etapa

Versão de implementação: `b97179b`, comparada a `9c80287`. [Decisões, contratos e reprodução](../../CORRECOES-ETAPA-2.md). **NO-GO para produção.**

- [Resumo verificável](verification-summary.json): 677 testes, 654 passes, 22 falhas, um skip; mais três testes HTTP reais aprovados.
- [Suíte completa](combined-tests.log) e [comparação de falhas](test-baseline-comparison.json).
- [Baseline](baseline-tests.log): checkout separado do commit anterior, mesma seleção disponível, 598 testes, 573 passes, 24 falhas, um skip. Inclui a rota Next de emissão de token que seus testes importam. Dependências consultadas por junctions; fontes `@zyon/*` resolvidos na própria cópia.
- [HTTP real](http-integration.log): duas instâncias Nest, PostgreSQL e Redis reais; listeners apenas em loopback, apps encerrados ao concluir.
- [Typecheck](api-typecheck.log), [setup/emissão isolados](isolated-setup-compile.log) e [composição Nest](nest-composition.log).
- [Schema no banco descartável](prisma-schema-push.log) e [SQL das migrações de segurança](security-migrations.log). A suíte também executa SQL e constraints da inbox em outro schema exclusivo.
- [OTP dirigido](buyer-otp-targeted.log) e [inbox dirigido](whatsapp-inbox-targeted.log), anteriores à rodada consolidada final; não somar esses totais aos 677.
- [Manifesto de fontes](implementation-manifest.json): SHA-256 dos bytes do worktree validado. Não substitui os manifests históricos do primeiro lote.
- [Validação dos documentos e hashes](document-validation.json).

39 testes PostgreSQL e três testes Redis estão incluídos nos 677. Os três HTTP são adicionais e usam o JavaScript emitido com metadata. A composição completa usa configurações fictícias, bloqueia fetch externo e não chama `app.init()`/`listen()`; não é teste de lifecycle de todos os módulos. Os testes unitários usam loader de transpile e `--test-force-exit`, sem comprovação de shutdown global.

A baseline e alguns logs dirigidos foram produzidos pelo redirecionamento do PowerShell. Na cópia versionada, UTF-16 com BOM foi convertido para UTF-8, finais de linha foram normalizados e espaços finais removidos; resultados e mensagens foram preservados. O log de setup pode conter `NativeCommandError` do PowerShell para avisos que o Prisma escreve em stderr. O helper concluiu geração e compilação e imprimiu seu marcador final; o typecheck separado também terminou com código zero, por isso seu log está vazio.

Nenhum nome de falha novo apareceu na comparação; isso não prova ausência de regressões fora da seleção ou em testes com nomes repetidos. As 22 falhas preexistentes continuam impedindo declarar a suíte verde. Provedores reais, build de release, browser dos fronts, carga, backup/restore e rollout integrado não foram validados.

PostgreSQL e Redis foram criados exclusivamente para esta etapa, com label `codex.task=ready-to-prod-stage2`, portas dinâmicas em loopback e remoção automática ao encerrar. A [evidência de encerramento](container-cleanup.json) registra os IDs conferidos; nenhum container preexistente foi alterado.
