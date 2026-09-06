# Evidências da auditoria

Snapshot: 2026-09-05, commit base dcb8150aae34b8284178d9d257e4ac174654d965, árvore com alterações preexistentes. Arquivos de aplicação preservados.

- [source-manifest.json](source-manifest.json): hashes SHA-256 das 1.942 fontes dos quatro apps.
- [module-composition.json](module-composition.json): @Module/imports/controllers alcançáveis estaticamente.
- [api-routes.json](api-routes.json): handlers/aliases/guards extraídos e marcação de legado.
- [frontend-contracts.json](frontend-contracts.json): 281 call sites e candidatos de roteamento; não são testes de contrato.
- [database-inventory.json](database-inventory.json): modelos, campos de tenant, índices e DDL na baseline ativa.
- [findings.json](findings.json): registro estruturado dos 68 achados.
- [dependency-audit-summary.json](dependency-audit-summary.json): advisories reportados pelo registry, sem inferir explorabilidade.
- [api-typecheck.log](api-typecheck.log), [api-typecheck-explicit-node-types.log](api-typecheck-explicit-node-types.log), [dashboard-typecheck.log](dashboard-typecheck.log), [storefront-typecheck.log](storefront-typecheck.log), [widget-typecheck.log](widget-typecheck.log).
- [api-jwt-tests.log](api-jwt-tests.log), [api-domain-tests.log](api-domain-tests.log), [selected-tests.json](selected-tests.json), [dashboard-tests-summary.log](dashboard-tests-summary.log).
- [reproductions.test.mjs](reproductions.test.mjs), [ts-loader.mjs](ts-loader.mjs), [reproductions.log](reproductions.log): seis reproduções locais sem provedores externos.

O loader não reproduz a resolução DI completa do Nest e não faz typecheck; está aqui somente para caracterizar os caminhos indicados. Os testes retornam sucesso quando confirmam o defeito atual. Para comandos e interpretação, ver [VALIDACAO.md](../VALIDACAO.md).

- [document-validation.json](document-validation.json): links, referências e hashes conferidos.
- [config-manifest.json](config-manifest.json): hashes das configurações, lockfile, schema e baseline inspecionados.
