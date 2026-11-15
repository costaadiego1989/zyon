# Service Businesses, WhatsApp Conversations and Generic Business RAG Tasks

## Execution Protocol

Implementar com a skill **tlc-spec-driven**, seguindo Execute e Critical Rules. Se a skill não estiver disponível, parar. Um gate e um commit por tarefa; nenhuma tarefa aprovada por inferência.

**Design**: `.specs/features/whatsapp-service-booking-business-rag/design.md`
**Status**: In Progress
**Approved**: 2026-11-14 - user: "Aprovar o plano e iniciar implementação local"
**Date**: 2026-11-14
**Mutations**: 3
**User-directed addition**: 2026-11-14 - "Lista simples em Dados da empresa (recomendado)"; "lembrando que e só para empresas de serviços". Adds ONB-06 and T96/T97 to the original approved plan:72 criteria/97 tasks. These two local tasks are directly requested; original approvals are preserved. They run after T16 without blocking the original T16+T25 booking barrier and must finish before T95/final verification.
**Build**: `pnpm --filter @zyon/api typecheck; pnpm --filter @zyon/api lint; pnpm --filter @zyon/api build; pnpm --filter @zyon/widget-v2 typecheck; pnpm --filter @zyon/widget-v2 build; pnpm --filter @zyon/dashboard typecheck; node scripts/service-local-build.mjs dashboard; pnpm --filter @zyon/storefront typecheck; node scripts/service-local-build.mjs storefront`

Especificação original de 47 requisitos aprovada; este plano incorpora os refinamentos explícitos posteriores e totaliza 71 critérios. Aprovação deste documento confirma também os refinamentos. Ainda não autoriza push, deploy ou banco/provedor de produção. Empresas de produtos conservam os fluxos aprovados em ambos os canais. Não implementar antes do gate --execute e aprovação registrada nas palavras do usuário.

## Test Coverage Matrix

Generated from codebase, project guidelines, and spec. Padrão consultado: `.github/workflows/ci.yml` da fonte completa, scripts dos packages API/dashboard/storefront/widget, `apps/dashboard/vitest.config.ts`, `apps/api/tests/test-network-guard.mjs`, owned resource contracts e dez gates PROD do agenda-review.md. Nenhum AGENTS.md adicional foi encontrado nas duas bases inspecionadas. CI exige AI security, typecheck e build dos quatro apps; não inventar script lint onde não existe.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain/use cases | unit | 1:1 com os ACs, todos branches comerciais e edge cases, produtos preservados | API src/**/*.spec.ts | `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./src/path/target.spec.ts` (path escolhido pela tarefa) |
| HTTP/auth/channel adapters | integration | Cada rota happy/invalid/foreign/forbidden/error/stale; auth, modo, response + persistência + rollback | API tests/service-*.integration.spec.ts e whatsapp-human-handoff.integration.spec.ts | `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./tests/<named-file>.ts` |
| Persistence/holds/outbox | integration | DB/Redis reais próprios, overlap/corridas/replay/rollback, sem skip por env ausente | API tests/service-*.integration.spec.ts | Mesmo Node runner; runtime T2 cria recursos, não depende de URL externa |
| Graph/provenance | unit + integration | Canonical save/outbox, versões/retirada/retry, tenant, canários privados, templates com Neo4j/gateway próprios | API tests/business-rag.integration.spec.ts | `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./tests/business-rag.integration.spec.ts` |
| React/hooks/navigation | unit + browser | Estado, payload e permissão em testes; interação/foco/responsivo/erro em browser, sem apenas espelhar implementação | dashboard src/**/*.spec.ts(x), e2e/service-product-coexistence.spec.ts | `pnpm --dir apps/dashboard exec vitest run <file>`; `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts` |
| Buyer UI/voice | integration + browser | Mesmo estado canônico, dois modos/dois canais, mídia opcional, texto/voz ambíguos e fluxo comercial aprovado | API channel tests + browser fixture local com API/DB | `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./tests/service-channel-journey.integration.spec.ts`; `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts` |
| Schema/config | none (build), contract/integration when behavior exists | Schema validado; migração/config/runtime com prova real e negativas | prisma/migrations, *.contract.spec.mjs | `pnpm --dir apps/api exec prisma validate`; build; testes de comportamento correspondentes |
| Evidence/evaluation | unit + integration | 71 critérios, zero skip/zero casos, revision/ambiente verdadeiros e todos casos críticos aprovados | API tests/*-report.spec.mjs, business-rag-evaluation.spec.mjs | Mesmo Node runner selecionando arquivo/teste |

Arquivos novos e config e2e neste plano **serão criados** nas tarefas responsáveis. Os comandos existentes são padrões verificados do projeto; nenhum teste planejado foi executado. T1 confirma baseline e localização definitiva antes de código. T2 prepara runtime que os testes de cada implementação importam. Se runner/config mudar, registrar ajuste técnico e revalidar tarefas sem reduzir cobertura.

## Test Co-location and Composition

Ao criar endpoint, provider ou consumer, incluir seu registro mínimo no módulo de produção na mesma tarefa. O arquivo Where indica o componente principal; alterações mínimas de composição/tipo exigidas para fazê-lo funcionar fazem parte desse mesmo componente, não autorizam refactor adjacente. O gate Full usa AppModule real com runtime local e assertivas HTTP/DB. TestingModule isolado é complemento unitário, nunca prova de rota servida. Não adiar testes de controller para a futura tarefa de wiring.

O gate de browser de cada componente é criado junto dele no config local inicial; pode montar o componente em fixture isolada com API local. A aceitação final visita rotas reais completas. Endpoints/consumers de humano, RAG e métricas, criados depois do wiring inicial da agenda, entram nos respectivos módulos quando surgem. O coletor final rejeita pacote que só constrói providers sem provar Conversas, callback/outbox, ingestão canônica e métricas no AppModule servido.

Comandos Tn selecionam um teste raiz co-localizado por tarefa. Os testes finais nomeados por requisito abaixo assertam o critério completo, não substituem o gate intermediário. Arquivos, seletores e contagem são contratos planejados; ainda serão criados e executados. Para documentação T1 não se inventa teste unitário; para schema usa-se validação/build mais integração da migração na sua própria tarefa.

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick API | Domain function/presenter | `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 <companion.spec.ts>` |
| Quick UI | React/hooks/client | `pnpm --dir apps/dashboard exec vitest run <companion.spec.tsx>` |
| Full | Controller/repository/integration | Quick correspondente + Node integration selecionado na tarefa, runtime local próprio; zero skipped |
| Browser | User-facing component | Quick correspondente + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep '<case>'`; endpoints locais e fake provider identificados |
| Build | Schema/config and end of each phase | **Build** do cabeçalho + testes da fase; scripts existentes, sem cleanup alheio |
| Product baseline | Antes da implementação e antes da aceitação final | `pnpm --dir apps/api test:baseline-gates`; `pnpm --dir apps/api test:ai-security`; seleções PROD-02..10 abaixo |
| Product DB | Mudança checkout/payment/stock | `pnpm --dir apps/api exec node ./tests/normal-checkout-payment.integration.mjs --local-disposable --prisma-loopback-exec`; widget equivalente; estoque próprio no runner product-stock-regression.integration.spec.ts |

Não executar seleções legadas que herdam ambiente/URLs sem o guard; não usar testes skipped de estoque como prova. Comandos completos PROD-01..10 e caminhos atuais em `C:/Users/Admin/Desktop/AACP/.audit/service-plan-20261114/agenda-review.md:139`. O anexo abaixo fixa os gates centrais para não depender só do relatório externo.

## Product Regression Gates

- Source baseline existente: `pnpm --dir apps/api test:baseline-gates` (runner limpa env e injeta rede protegida).
- WhatsApp UI e storefront catálogo: Node protegido com arquivos `src/modules/whatsapp-channel/domain/ui/meta-ui-renderer.spec.ts`, `meta-catalog-cards.spec.ts`, `meta-product-navigation.spec.ts`, `meta-product-comparison.spec.ts`, `meta-compact-presentation.spec.ts`; storefront `infrastructure/agents/store-langgraph-catalog.spec.ts`, `infrastructure/tool-handlers/contextual-product-search.spec.ts`, `infrastructure/agents/storefront-ui-action.executor.spec.ts`.
- Carrinho/identidade: `pnpm --dir apps/api test:storefront-cart-line-selection`; `test:storefront-cart-uow:db`; `test:storefront-cart-binding-fence:db`; `test:storefront-buyer-bootstrap`; `test:storefront-checkout-continuity` (mesmo prefixo pnpm --dir apps/api para cada script).
- Frete: `pnpm --dir apps/api exec node ./tests/payment-neighborhood-admission.integration.mjs --local-disposable --prisma-loopback-exec`.
- Normal checkout e cross-sell: `pnpm --dir apps/api exec node ./tests/normal-checkout-payment.integration.mjs --local-disposable --prisma-loopback-exec`; `pnpm --dir apps/api exec node ./tests/widget-cross-sell-checkout.integration.mjs --local-disposable --prisma-loopback-exec`. Benefits/product-types somente se afetados e não já cobertos.
- Pix/cartão/troca: Node protegido nos arquivos `payment/application/create-payment-intent.use-case.spec.ts`, `cancel-checkout-payment.use-case.spec.ts`, `checkout/presentation/http/checkout.payment-method-fix.spec.ts`, WhatsApp adapters `whatsapp-storefront-parity.spec.ts`, `whatsapp-checkout-edit.spec.ts` e application/services/whatsapp-checkout-identity.spec.ts.
- Webhooks/recibos: Node protegido em handle-asaas/mercadopago/stripe-webhook.use-case.spec.ts, whatsapp-paid-receipt.spec.ts, paid-order-receipt-delivery.spec.ts, complete-order.use-case.spec.ts, inventory-sale.spec.ts; `pnpm --dir apps/api test:stripe-webhook:payment-http`; `pnpm --dir apps/api test:notifications-payment-cycle`.
- Jornada AppModule compilada: `pnpm --dir apps/api test:compile`, depois `pnpm --dir apps/api exec node ./tests/storefront-journey-commerce.integration.mjs --local-disposable --prisma-loopback-exec --compiled-test-artifact --commerce-only --no-real-provider`.
- Browser fixture existente reconciliada: `pnpm --dir apps/storefront exec playwright test --config e2e/commerce-rules.playwright.config.ts`; prova nova com persistência dos dois canais no config service-local, não presumida por essa fixture de componentes.
- Falha preexistente exige comparação documentada com baseline. Não alterar expectativa aprovada para deixar serviço verde. Produto serviço não agendado/digital nos testes antigos não prova esta nova agenda.

## Execution Plan

Em 2026-11-14 o usuário pediu: "por que esta demorando tanto? spawnar subagents". A execução agora prepara fases independentes em worktrees isoladas. Phase 1 continua em N; Phase 2 (T10–T16) e Phase 3 (T17–T25) podem ser preparadas em paralelo, com gates e commits após incorporar T9. T17 depende da base T9, não da UI/About T16. Phase 4 aguarda integração verde de ambas. Tarefas dentro de cada fase mantêm ordem, gate e commit próprios. Nenhum critério ou teste é reduzido; builds pesados são serializados por limite de memória. Detalhes em parallel-execution.md. Verificação final usa autor independente.

### Phase 1: Baseline and capability

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9
```

### Phase 2: Company forms and merchant policy

```
T10 → T11 → T12 → T13 → T14 → T15 → T16
```

### Phase 3: Professionals and shared availability

```
T17 → T18 → T19 → T20 → T21 → T22 → T23 → T24 → T25
```

### Phase 4: Atomic appointment admission

```
T26 → T27 → T28 → T29 → T30 → T31 → T32
```

### Phase 5: Financial integration and service events

```
T33 → T34 → T35 → T36 → T37 → T38 → T39
```

### Phase 6: Buyer service journeys in both channels

```
T40 → T41 → T42 → T43 → T44 → T45 → T46 → T47
```

### Phase 7: Durable WhatsApp human delivery

```
T48 → T49 → T50 → T51 → T52 → T53 → T54 → T55
```

### Phase 8: WhatsApp Conversations tab and automatic return

```
T56 → T57 → T58 → T59 → T60 → T61 → T62
```

### Phase 9: Public knowledge lifecycle and controlled retrieval

```
T63 → T64 → T65 → T66 → T67 → T68 → T69 → T70 → T71
```

### Phase 10: Generic evaluation and service administration

```
T72 → T73 → T74 → T75 → T76 → T77
```

### Phase 11: Availability operations and navigation

```
T78 → T79 → T80 → T81 → T82 → T83 → T84
```

### Phase 12: Business-specific metrics

```
T85 → T86 → T87 → T88 → T89 → T90 → T91
```

### Phase 13: Coexistence evidence and activation gates

```
T92 → T93 → T94 → T95
```

### Phase boundaries

```
T9 → T10
T9 → T17
T25 → T26
T32 → T33
T39 → T40
T25 → T48
T55 → T56
T13 → T63
T18 → T63
T25 → T65
T71 → T72
T77 → T78
T84 → T85
T91 → T92
T16 → T96
T96 → T97
T97 → T95
```

## Task Breakdown

### T1: Reconcile the complete implementation baseline

**Status**: Complete - baseline documental e fonte curada; evidência em baseline.md/execution.md e baseline-manifest.json.

**What**: Registrar revisões, manifestos e diferenças API/frontend em checkout completo isolado; preservar alterações concorrentes e scripts de teste reais, sem copiar a árvore principal indiscriminadamente.
**Where**: `.specs/features/whatsapp-service-booking-business-rag/baseline.md`
**Depends on**: None
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: REG-04, QA-01

**Done when**:

- [x] Resultado descrito em What demonstrado; fonte de produto preservada e origem API/frontend explicitamente distinguida.
- [x] Documental: comparação de árvores, manifests e comandos existentes; nenhum teste de aplicação é substituído por este inventário.
- [x] Gate Document passa, 1.259 hashes verificados e testes existentes preservados. Tarefa marcada antes do commit atômico; sem push/deploy.

**Tests**: Documental: comparação de árvores, manifests e comandos existentes; nenhum teste de aplicação é substituído por este inventário.
**Gate**: Document: git diff --check e comparação documental de manifestos/árvores; sem teste artificial para documentação. Os checks finais por ID abaixo continuam obrigatórios. Linking local de dependências será concluído antes de T2.
**Commit**: `feat(service-business): t1 reconcile the complete implementation baseline`

### T2: Create an owned local service test runtime

**Status**: Complete - 7/7 tests, zero failed/skipped; checked production build and real AppModule/SQL/Redis/Neo4j smoke. See task-02-evidence.json.

**What**: Runtime de testes cria somente PostgreSQL/Redis e, para suítes de grafo, Neo4j descartáveis próprios; inicializa schema/fixtures/HTTP/gateway locais, filtra env, rejeita endpoints externos, prova ownership antes de cleanup e falha se uma dependência obrigatória faltar.
**Where**: `apps/api/tests/service-test-runtime.mjs`
**Depends on**: T1
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: QA-03, RAG-08, REG-03

**Done when**:

- [x] Runtime local e negativas demonstrados sem alterar comportamento aprovado de produto.
- [x] Contract + integração reais: endpoints/env/ownership/zero/skip/fail recusados; service-test-runtime.spec.mjs tem seis subcasos e raiz T2.
- [x] Gate Full passa: 7 testes, 7 pass, zero failed/skipped; build de produção checked e cleanup por ACK/saída natural. Tarefa marcada antes do commit; sem push/deploy.

**Tests**: Contract + integração em service-test-runtime.spec.mjs: quatro negativas originais, negativa de Redis publicado e integração real de SQL/Redis/Neo4j/AppModule/cleanup. API-RAG e PSP reais não estão comprovados nesta tarefa.
**Gate**: Full: com cwd apps/api, `node --import ./tests/test-network-guard.mjs --test --test-name-pattern "^T2$" ./tests/service-test-runtime.spec.mjs`. Harness é JS nativo e AppModule é artefato de produção checked, dispensando loader TS nesta tarefa. Resultado 7/7, zero skips. Os checks finais por ID continuam obrigatórios.
**Commit**: `feat(service-business): t2 create an owned local service test runtime`

### T3: Pin browser acceptance to local owned backends

**What**: Config dedicada inicia backend/frontend/fixture WhatsApp locais com env filtrado e fake PSP/Meta explícitos; bloqueia proxy remoto, aponta artifacts e impõe contagem de casos.
**Where**: `apps/dashboard/playwright.service-local.config.ts`
**Depends on**: T2
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: QA-02, REG-02, REG-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Contract do config + browser smoke: endpoint/credencial externos rejeitados, API local real com persistência e requests não autorizados bloqueados.
- [x] Gate Build passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Contract do config + browser smoke: endpoint/credencial externos rejeitados, API local real com persistência e requests não autorizados bloqueados.
**Gate**: Build: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T3$"` + `node --test apps/dashboard/e2e/service-local-scope.spec.mjs apps/dashboard/e2e/service-local-reporter.spec.mjs` e Build. Teste raiz T3 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t3 pin browser acceptance to local owned backends`

### T4: Define additive service persistence models

**What**: Schema contém contratos do design, relações tenant e índices/unique de idempotência; campos de serviço não alteram snapshots/fingerprints de produto nem tornam agenda obrigatória para produto.
**Where**: `apps/api/prisma/schema.prisma`; registro declarativo mínimo em `apps/api/src/shared/persistence/tenant.middleware.ts`; fixture anterior em `apps/api/tests/fixtures/service-business/`.
**Depends on**: T3
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-01, ONB-03, AGENDA-01, BOOK-07, HUM-03, RAG-01

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Schema/config: prisma validate e geração local; persistência e compatibilidade provadas na tarefa seguinte.
- [x] Gate Build passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Schema/config: prisma validate e geração local; persistência e compatibilidade provadas na tarefa seguinte.
**Gate**: Build: `pnpm --dir apps/api exec prisma validate` e geração local do client; Build do cabeçalho. Schema puro usa validação/compilação reais, sem teste raiz artificial. O contrato existente de alinhamento tenant também deve passar; T5 prova a persistência/migração e T6 as negativas de isolamento. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t4 define additive service persistence models`

### T5: Write the compatible expansion migration

**What**: Migração expansiva aplica sobre fixture anterior sem perder comprador/carrinho/pagamento/pedido/estoque; classificação de legado ambíguo exige resolução explícita, sem atribuir profissional fictício; não apagar tabelas antigas.
**Where**: `apps/api/prisma/deploy-migrations/20261114000000_service_business_capability/migration.sql` (executável), com mirror byte-idêntico em `prisma/migrations`; bootstrap/testes MJS locais em `apps/api/tests/service-migration*`.
**Depends on**: T4
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: REG-04, ONB-04, QA-03

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Integração service-migration.integration.spec.mjs: fixture anterior, unicidade/FK, reexecução do processo de migração e consultas antigas preservadas.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Integração service-migration.integration.spec.mjs: fixture anterior, unicidade/FK, reexecução do processo de migração e consultas antigas preservadas. O runtime compartilhado usa o mesmo deploy SQL real, incluindo CHECK/EXCLUDE, e recusa drift.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 --test-name-pattern "^T5$" ./tests/service-migration.integration.spec.mjs` e repetir T2 após o ajuste do bootstrap SQL. Teste raiz T5 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t5 write the compatible expansion migration`

### T6: Scope new models to the authenticated tenant

**What**: Modelos novos entram na proteção e queries por ID estrangeiro são negadas sem leak; FKs compostas e testes reais comprovam ausência de efeitos no outro tenant.
**Where**: `apps/api/src/shared/persistence/tenant.middleware.ts`
**Depends on**: T5
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: EDGE-01, ATEND-08, RAG-07

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Contratos unit existentes + integração service-tenant.integration.spec.mjs: todos os modelos com leitura/mutação/updateMany e rollback. HTTP adversarial acompanha cada controller posterior no próprio commit.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Os 12 contratos unit existentes de tenant.middleware.spec.ts e integração service-tenant.integration.spec.mjs comprovam os onze modelos novos com Prisma/ALS/SQL reais, FKs e rollback. Nenhum endpoint artificial é criado; as negativas HTTP continuam obrigatórias em cada endpoint futuro.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test ./src/shared/persistence/tenant.middleware.spec.ts` e `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-name-pattern "^T6$" ./tests/service-tenant.integration.spec.mjs`. O seletor artificial no unit existente foi corrigido para executar seus 12 casos; o root T6 seleciona a integração real. Nenhum skipped; os checks finais por ID continuam obrigatórios, incluindo HTTP quando os controllers existirem.
**Commit**: `feat(service-business): t6 scope new models to the authenticated tenant`

### T7: Define the canonical business policy resolver

**What**: Resolver modo/política/version/habilitação; validar configuração explícita, duração e mudança incompatível; desligar nova admissão não desliga reconciliação existente; produto conserva comportamento padrão.
**Where**: `apps/api/src/modules/merchant/domain/service-business-policy.ts`
**Depends on**: T6
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-02, ONB-03, ONB-04, REG-01, REG-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit service-business-policy.spec.ts: produtos, serviços, legado, quatro combinações, limites e in-flight durante desativação.
- [x] Gate Quick API passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit service-business-policy.spec.ts: produtos, serviços, legado, quatro combinações, limites e in-flight durante desativação.
**Gate**: Quick API: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-name-pattern "^T7$" ./src/modules/merchant/domain/service-business-policy.spec.ts` e `pnpm --dir apps/api exec tsc --noEmit --strict --skipLibCheck --module NodeNext --target ES2022 src/modules/merchant/domain/service-business-policy.ts src/modules/merchant/domain/service-business-policy.spec.ts`. Funcao de dominio pura nao requer HTTP/DB artificial; T8/T9 mantem Full e o fim da fase mantem Build completo. Nenhum skipped; checks finais por ID continuam obrigatorios.
**Commit**: `feat(service-business): t7 define the canonical business policy resolver`

### T8: Persist the exclusive mode during signup

**What**: Signup valida exatamente products ou services e persiste com tenant; não inferir modalidade pelo segmento; integração respeita cadastros legados.
**Where**: `apps/api/src/modules/auth/application/register-merchant.use-case.ts`
**Depends on**: T7
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-01, REG-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + onboarding HTTP/DB: service-business-onboarding.integration.spec.mjs, modo inválido/ausente, duplicata e novo login.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + onboarding HTTP/DB: service-business-onboarding.integration.spec.mjs, modo inválido/ausente, duplicata e novo login.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./src/modules/auth/application/register-merchant.use-case.spec.ts ./src/modules/auth/application/auth.use-cases.spec.ts ./src/modules/auth/application/tenant-onboarding.spec.ts ./src/modules/auth/application/recovery-template-signup.spec.ts ./src/modules/auth/application/oauth-callback.use-case.spec.ts` e `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-name-pattern "^T8$" ./tests/service-business-onboarding.integration.spec.mjs`, com build API checked/atestado fresco e typecheck. Estado/resposta/rollback reais nas duas rotas settings, OAuth preliminar, flags forjados, conflitos e CAS; zero skipped. Os checks finais por ID continuam obrigatorios.
**Commit**: `feat(service-business): t8 persist the exclusive mode during signup`

### T9: Expose mode and policy in the authenticated profile

**What**: Mapper canônico devolve modalidade/policyVersion/capabilities sem segredos; integrar o leitor de perfil existente usando o mapper, preservando campos de produto.
**Where**: `apps/api/src/modules/merchant/application/merchant-business-profile.mapper.ts`
**Depends on**: T8
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-01, ONB-02, REG-01

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit mapper + integração de perfil após novo login; schema/consumidor compatíveis com resposta anterior.
- [x] Gate Build passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit merchant-business-profile.mapper.spec.ts e HTTP/DB service-business-profile.integration.spec.mjs; integração de perfil após novo login; schema/consumidor compatíveis com resposta anterior.
**Gate**: Build: executar **Build** do cabecalho, unit mapper e regressao dos contratos da fase; HTTP/DB em `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-name-pattern "^T9$" ./tests/service-business-profile.integration.spec.mjs`. Reexecutar os gates T2/T5/T6/T7/T8 contra o mesmo build checked, os contratos de infraestrutura T2/T3 e browser T3 local. Nao unir roots diferentes sob um filtro que registre skips: o HTTP T9 tem arquivo proprio. Todos os casos devem executar, zero skipped; os checks finais por ID continuam obrigatorios. Baseline amplo preexistente continua registrado separadamente, sem alterar expectativas para forcar verde.
**Commit**: `feat(service-business): t9 expose mode and policy in the authenticated profile`

### T10: Add the exclusive signup choice

**What**: Escolha acessível O que sua empresa vende?, exclusiva, com persistência no payload/tipos e retomada; segmento/plano separados; não habilitar agenda de produto.
**Where**: `apps/dashboard/src/auth/SignupWizard.tsx`
**Depends on**: T9
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-01, ONB-02

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Vitest SignupWizard.business-mode.spec.tsx e browser signup: render, seleção, payload, erro e reload.
- [x] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Vitest SignupWizard.business-mode.spec.tsx e browser signup: render, seleção, payload, erro e reload.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/auth/SignupWizard.spec.tsx -t "^T10$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T10$"` Teste raiz T10 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t10 add the exclusive signup choice`

**Evidence**: task-10-evidence.json. Vitest25/25 (T10:1/1 and24 existing transport cases), browser1/1, zero failures/skips in the final gate. Local screenshots in captures/task10-signup-products.running.png and task10-signup-services.running.png. Real owned AppModule/SQL; pending OAuth is synthetic and no provider exchange is claimed.

### T11: Expose appointment policy configuration

**What**: Componente HTTP de política autentica empresa/ator, aplica modo services, expectedVersion e validação; retorno permite distinguir não configurado, conflito e salvo.
**Where**: `apps/api/src/modules/merchant/presentation/http/service-business-policy.controller.ts`
**Depends on**: T10
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-03, ATEND-08, EDGE-02

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] HTTP/DB service-business-policy-http.integration.spec.mjs: happy/invalid/foreign/forbidden/stale; provas co-localizadas com controller.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB service-business-policy-http.integration.spec.mjs: happy/invalid/foreign/forbidden/stale; provas co-localizadas com controller.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T11$" ./src/modules/merchant/presentation/http/service-business-policy.controller.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T11 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t11 expose appointment policy configuration`

**Evidence**: task-11-evidence.json. Unit4/4 and final native11/11, zero skips, actual AppModule/SQL. API typecheck/build0. First native attempt passed10 business cases but failed natural-exit cleanup; unchanged rerun passed including ACK/exit0/owned removal. No production shutdown fix is claimed.

### T12: Guard business mode changes

**What**: Mudança audita e recusa registros incompatíveis sem apagar histórico; mantém tratamento de eventos e tentativas financeiras já iniciadas. Além do helper puro T7, consultar checkouts e pagamentos canônicos ativos/pending e recusar a troca incompatível antes de escrever. O helper isolado não autoriza mudança de modalidade.
**Where**: `apps/api/src/modules/merchant/application/change-business-mode.use-case.ts`
**Depends on**: T11
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-04, REG-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + service-business-mode-http.integration.spec.mjs: catálogo/pagamento/appointment ativos, erro transacional e mudança válida.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + service-business-mode-http.integration.spec.mjs: catálogo/pagamento/appointment ativos, erro transacional e mudança válida.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T12$" ./src/modules/merchant/application/change-business-mode.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T12 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t12 guard business mode changes`

### T13: Normalize the canonical About write

**What**: Descrição pública existente de até 1.200 caracteres valida em todos os escritores; omitir preserva, string vazia limpa; gravação/outbox canônicos atômicos; inválido não altera nada.
**Where**: `apps/api/src/modules/merchant/application/update-merchant-theme.use-case.ts`
**Depends on**: T12
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-05, RAG-11

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + service-company-about-write.integration.spec.mjs pelas duas APIs existentes e alias: string/limite/objeto/merge/clear/rollback.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + service-company-about-write.integration.spec.mjs pelas duas APIs existentes e alias: string/limite/objeto/merge/clear/rollback.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T13$" ./src/modules/merchant/application/update-merchant-theme.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T13 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t13 normalize the canonical about write`

### T14: Preserve About in company API responses

**What**: Mapper compartilhado lê descrição existente e campos públicos; integrar respostas de ambas APIs sem renomear armazenamento, omitir segredos e manter campos anteriores.
**Where**: `apps/api/src/modules/merchant/application/company-settings.mapper.ts`
**Depends on**: T13
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-05, RAG-11

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] company-settings.mapper.spec.ts + service-company-about-read.integration.spec.mjs: save/reopen/clear nas duas APIs e alias, can?rios e contato p?blico expl?cito.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: company-settings.mapper.spec.ts + service-company-about-read.integration.spec.mjs: save/reopen/clear nas duas APIs e alias, can?rios e contato p?blico expl?cito.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T14$" ./src/modules/merchant/application/company-settings.mapper.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T14 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t14 preserve about in company api responses`

### T15: Roundtrip About through the existing company form

**What**: Tipo, hidratação e payload mantêm descrição/público nos Dados da empresa; salvar/reabrir/limpar não sobrescreve campos concorrentes omitidos.
**Where**: `apps/dashboard/src/pages/store-settings/useStoreSettingsPage.ts`
**Depends on**: T14
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-05, RAG-11

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] useStoreSettingsPage.spec.ts: API fixture, carregamento, clear, erro e nova leitura.
- [x] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: useStoreSettingsPage.spec.ts: API fixture, carregamento, clear, erro e nova leitura.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/pages/store-settings/useStoreSettingsPage.spec.ts -t "^T15$"` Teste raiz T15 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t15 roundtrip about through the existing company form`

### T16: Render About in company data

**What**: Campo Sobre a empresa com limite/descrição de publicação no formulário atual, acessível; fotos de local application em artifacts/company-about.running.png no browser de aceitação.
**Where**: `apps/dashboard/src/pages/store-settings/store-settings-page.tsx`
**Depends on**: T15
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-05, QA-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] store-settings-page.about.spec.tsx e browser QA-02: foco, limite, salvar/reabrir, feedback de erro.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: store-settings-page.about.spec.tsx e browser QA-02: foco, limite, salvar/reabrir, feedback de erro.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/store-settings/store-settings-page.spec.tsx -t "^T16$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T16$"` Teste raiz T16 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t16 render about in company data`

### T17: Guard new catalog writes by business mode

**Status**: Complete - unit6/6, AppModule HTTP/DB12/12, catalog/ERP60/60 and normal owned checkout48/48. API types/build0, zero skipped, close ACK/natural exit0/owned cleanup. Supplemental product-types setup failure stays pending with root; see task-17-evidence.json.

**What**: Na fronteira canônica de create/update/publicação/import, resolver modalidade do tenant e recusar novas ofertas incompatíveis; cobrir todos os escritores reais, inclusive public API e caminhos diretos. Preservar produtos físicos/digitais aprovados e snapshots/processamento de ofertas históricas; legado ambíguo exige classificação explícita, sem invalidar pedido/pagamento já iniciado.
**Where**: `apps/api/src/modules/catalog/infrastructure/repositories/prisma-product.repository.ts`
**Depends on**: T9
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-02, ONB-04, REG-01, REG-02, REG-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] HTTP/DB onboarding/coexistence: signup seguido de create/update/import/publicação via cada entrada real, ambos modos; histórico/carrinho/pagamento de produto preservados. Se houver escritor que evita o repositório, incorporá-lo ao mesmo guard antes de concluir a tarefa.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB onboarding/coexistence: signup seguido de create/update/import/publicação via cada entrada real, ambos modos; histórico/carrinho/pagamento de produto preservados. Se houver escritor que evita o repositório, incorporá-lo ao mesmo guard antes de concluir a tarefa.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T17$" ./src/modules/catalog/infrastructure/repositories/prisma-product.repository.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T17 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t17 guard new catalog writes by business mode`

### T18: Persist professionals without login coupling

**Status**: Complete - unit4/4 and owned DB/middleware7/7, zero failed/skipped; checked build0 and owned cleanup. See task-18-evidence.json.

**What**: CRUD canônico tenant-scoped, perfil/publicação/vínculo e desativação com histórico; profissional não exige usuário de login.
**Where**: `apps/api/src/modules/catalog/infrastructure/repositories/prisma-service-professional.repository.ts`
**Depends on**: T17
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-01, ATEND-02, EDGE-01

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Repository integration service-professionals.integration.spec.mjs: create/edit/deactivate, vínculos/constraints/foreign e rollback.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Repository integration service-professionals.integration.spec.mjs: create/edit/deactivate, vínculos/constraints/foreign e rollback.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T18$" ./src/modules/catalog/infrastructure/repositories/prisma-service-professional.repository.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T18 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t18 persist professionals without login coupling`

### T19: Expose professional management

**Status**: Complete - unit3/3, actual AppModule HTTP/DB6/6, zero failed/skipped; checked build0/2498, close ACK/natural exit0 and owned cleanup. See task-19-evidence.json.

**What**: Um controller de recurso com rotas tipadas de listar/criar/editar/desativar; aplica permissão explícita e modo, paginação/limites; emite eventos públicos após persistência.
**Where**: `apps/api/src/modules/catalog/presentation/http/service-professionals.controller.ts`
**Depends on**: T18
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-02, ATEND-08, ONB-02

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] HTTP real de cada rota com happy/invalid/foreign/products/forbidden, preservando histórico.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP real de cada rota com happy/invalid/foreign/products/forbidden, preservando histórico.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T19$" ./src/modules/catalog/presentation/http/service-professionals.controller.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T19 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t19 expose professional management`

### T20: Validate professional and service associations

**What**: Resolver vínculo e duração da oferta canônica service; categoria reutiliza ProductCategory e nunca produz capacidade duplicada ou preço novo.
**Where**: `apps/api/src/modules/catalog/domain/services/professional-service-link.ts`
**Depends on**: T19
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-01, ATEND-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit professional-service-link.spec.ts + DB: profissional/oferta/categoria estrangeiros, despublicados e categorias compartilhadas.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit professional-service-link.spec.ts + DB: profissional/oferta/categoria estrangeiros, despublicados e categorias compartilhadas.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T20$" ./src/modules/catalog/domain/services/professional-service-link.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T20 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t20 validate professional and service associations`

### T21: Save recurring professional availability

**What**: Um comando salva grade/fuso/vigência versionados com validação de intervalos/limites, autorização e evento público apropriado; não reescreve compromissos existentes.
**Where**: `apps/api/src/modules/catalog/application/save-professional-availability.use-case.ts`
**Depends on**: T20
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-04, AGENDA-01, RAG-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + service-availability.integration.spec.ts: DST/fuso, intervalo inválido, versão, histórico, concorrência e eventos.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + service-availability.integration.spec.ts: DST/fuso, intervalo inválido, versão, histórico, concorrência e eventos.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T21$" ./src/modules/catalog/application/save-professional-availability.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T21 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t21 save recurring professional availability`

### T22: Save one-off times and unavailability blocks

**What**: Um comando tipado one_off/block usa lock de profissional; avulso não sobrepõe bloqueio/confirmado; bloqueio não cancela compromisso e remove oferta pública.
**Where**: `apps/api/src/modules/catalog/application/save-availability-exception.use-case.ts`
**Depends on**: T21
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-05, ATEND-09, EDGE-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + HTTP/DB service-availability.integration.spec.ts: corrida com confirmação, intervalos adjacentes, outro tenant e rollback.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + HTTP/DB service-availability.integration.spec.ts: corrida com confirmação, intervalos adjacentes, outro tenant e rollback.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T22$" ./src/modules/catalog/application/save-availability-exception.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T22 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t22 save one-off times and unavailability blocks`

### T23: Resolve canonical professional availability

**What**: Unir grade/avulsos e subtrair bloqueios/ocupações por profissional; datas primeiro, slots da data, duração/fuso; distinguir indisponível/vazio/stale; janela e volume limitados.
**Where**: `apps/api/src/modules/catalog/domain/services/professional-availability.ts`
**Depends on**: T22
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-02, AGENDA-03, AGENDA-05, AGENDA-06, ATEND-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] professional-availability.spec.ts + service-availability.integration.spec.ts: dois serviços/recurso, profissionais paralelos, limites/fuso e falha.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: professional-availability.spec.ts + service-availability.integration.spec.ts: dois serviços/recurso, profissionais paralelos, limites/fuso e falha.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T23$" ./src/modules/catalog/domain/services/professional-availability.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T23 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t23 resolve canonical professional availability`

### T24: Expose date and slot reads

**What**: Controller apresenta queries datas e slots com contexto confiável e limite; política/version/clock; leituras de canais/manual chamam mesma função.
**Where**: `apps/api/src/modules/catalog/presentation/http/service-availability.controller.ts`
**Depends on**: T23
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-02, AGENDA-03, AGENDA-06, ATEND-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP real dates/slots: happy/empty/error/stale/products/foreign; query budget e paginação.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP real dates/slots: happy/empty/error/stale/products/foreign; query budget e paginação.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T24$" ./src/modules/catalog/presentation/http/service-availability.controller.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T24 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t24 expose date and slot reads`

### T25: Expose recurring and exception availability writes

**What**: Controller de gravação da grade recorrente e exceções one_off/block com DTOs, autenticação/modo/role/expectedVersion e comandos canônicos; endpoints explícitos para o painel, sem regras no cliente. Leituras anteriores não substituem essas rotas de escrita.
**Where**: `apps/api/src/modules/catalog/presentation/http/service-availability-management.controller.ts`
**Depends on**: T24
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-04, ATEND-05, ATEND-08, ATEND-09, ATEND-10

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP real/DB: salvar/editar grade, avulso e bloqueio; happy/invalid/products/foreign/forbidden/stale/overlap e corrida com confirmação; erro faz rollback e as três leituras refletem a mudança.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP real/DB: salvar/editar grade, avulso e bloqueio; happy/invalid/products/foreign/forbidden/stale/overlap e corrida com confirmação; erro faz rollback e as três leituras refletem a mudança.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T25$" ./src/modules/catalog/presentation/http/service-availability-management.controller.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T25 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t25 expose recurring and exception availability writes`

### T26: Admit appointments under a shared resource lock

**What**: Única função transacional de admissão revalida tenant/profissional/oferta/política/capacidade [start,end); locks ordenados, comando idempotente e snapshot; duas tabelas não decidem capacidade independentemente.
**Where**: `apps/api/src/shared/bookings/service-appointment-admission.service.ts`
**Depends on**: T25
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-05, BOOK-03, BOOK-08, QA-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] DB service-booking.integration.spec.ts: manual/compradores/webhook concorrentes, overlaps com início diferente, adjacência e rollback/outbox.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DB service-booking.integration.spec.ts: manual/compradores/webhook concorrentes, overlaps com início diferente, adjacência e rollback/outbox.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T26$" ./src/shared/bookings/service-appointment-admission.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T26 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t26 admit appointments under a shared resource lock`

### T27: Apply optional versioned holds

**What**: Habilitado usa duração da política e clock do servidor com proprietário; desligado não cria/exige lease; expiry só libera provisório e nunca confirmed.
**Where**: `apps/api/src/shared/bookings/service-slot-holds.service.ts`
**Depends on**: T26
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-01, BOOK-02, BOOK-03, ONB-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + Redis/DB service-booking.integration.spec.ts: tempo controlado, retry, proprietário alheio e quatro combinações.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + Redis/DB service-booking.integration.spec.ts: tempo controlado, retry, proprietário alheio e quatro combinações.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T27$" ./src/shared/bookings/service-slot-holds.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T27 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t27 apply optional versioned holds`

### T28: Prepare service checkout without changing products

**What**: Ramo services usa seleção/policyVersion canônicas com hold opcional; campos de serviço opcionais não mudam fingerprint/carrinhos/pagamentos físicos existentes; produto não exige profissional.
**Where**: `apps/api/src/modules/checkout/application/use-cases/start-checkout.use-case.ts`
**Depends on**: T27
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-04, BOOK-03, EDGE-02, REG-01, REG-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + service-booking.integration.spec.ts + baseline produto: mesmo cart hash, retomada, frete/totais/métodos anteriores preservados.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + service-booking.integration.spec.ts + baseline produto: mesmo cart hash, retomada, frete/totais/métodos anteriores preservados.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T28$" ./src/modules/checkout/application/use-cases/start-checkout.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T28 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t28 prepare service checkout without changing products`

### T29: Prepare payment with or without a hold

**What**: Online service suporta hold on/off e resume; at_attendance não chama PSP; pagamento de produtos mantém guardas, troca de método e idempotência anteriores.
**Where**: `apps/api/src/modules/payment/application/create-payment-intent.use-case.ts`
**Depends on**: T28
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-03, BOOK-05, REG-02, REG-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + HTTP/DB: seleção/política stale, pending/approved/unknown, Pix↔cartão produtos, nenhum provider real nos testes locais.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + HTTP/DB: seleção/política stale, pending/approved/unknown, Pix↔cartão produtos, nenhum provider real nos testes locais.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T29$" ./src/modules/payment/application/create-payment-intent.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T29 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t29 prepare payment with or without a hold`

### T30: Confirm a local-payment appointment

**What**: Comando de confirmação usa admissão e política, confirma vaga com saldo pendente sem PaymentIntent aprovado ou cobrança; resposta e outbox atômicos.
**Where**: `apps/api/src/modules/checkout/application/confirm-service-appointment.use-case.ts`
**Depends on**: T29
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-04, BOOK-08, EDGE-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-booking.integration.spec.ts: política on/off, duplicata, corrida, mudança de política, nenhum pagamento/provider/evento de estoque físico.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-booking.integration.spec.ts: política on/off, duplicata, corrida, mudança de política, nenhum pagamento/provider/evento de estoque físico.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T30$" ./src/modules/checkout/application/confirm-service-appointment.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T30 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t30 confirm a local-payment appointment`

### T31: Create a manual appointment atomically

**What**: Identidade mínima e política iguais ao comprador; avulso fora da grade explícito integra mesma transação da admissão; online permanece pendente até evidência/capacidade; falha não deixa avulso órfão.
**Where**: `apps/api/src/modules/operations/application/create-manual-service-appointment.use-case.ts`
**Depends on**: T30
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-06, ATEND-10, BOOK-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + HTTP/DB: manual×buyer, avulso+appointment rollback, fora de política, duplicata, cliente estrangeiro e online/no atendimento.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + HTTP/DB: manual×buyer, avulso+appointment rollback, fora de política, duplicata, cliente estrangeiro e online/no atendimento.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T31$" ./src/modules/operations/application/create-manual-service-appointment.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T31 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t31 create a manual appointment atomically`

### T32: Record explicit attendance transitions

**What**: Uma máquina auditada controla início/conclusão/ausência por operador e versão; não usa pagamento/relógio como presença; execução não quita financeiro.
**Where**: `apps/api/src/modules/operations/application/transition-service-appointment.use-case.ts`
**Depends on**: T31
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-07, KPI-06, BOOK-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + service-booking.integration.spec.ts: todas transições permitidas/negadas, local pendente, duplicata e foreign.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + service-booking.integration.spec.ts: todas transições permitidas/negadas, local pendente, duplicata e foreign.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T32$" ./src/modules/operations/application/transition-service-appointment.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T32 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t32 record explicit attendance transitions`

### T33: Cancel an appointment through authorized operations

**What**: Cancelamento por operador vinculado à solicitação/política libera somente vaga própria e registra auditoria; financeiro só reflete devolução real, sem restock físico de serviço.
**Where**: `apps/api/src/modules/operations/application/cancel-service-appointment.use-case.ts`
**Depends on**: T32
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-09, BOOK-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP/DB: authorized/forbidden, repetição, versão antiga, política, provider unknown e nenhum efeito em outro appointment.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB: authorized/forbidden, repetição, versão antiga, política, provider unknown e nenhum efeito em outro appointment.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T33$" ./src/modules/operations/application/cancel-service-appointment.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T33 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t33 cancel an appointment through authorized operations`

### T34: Reschedule without losing the original slot

**What**: Destino e origem sob locks ordenados/transação; conflito preserva original; nova condição/preço exige aceite apropriado e não duplica cobrança.
**Where**: `apps/api/src/modules/operations/application/reschedule-service-appointment.use-case.ts`
**Depends on**: T33
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-09, AGENDA-05

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] DB concorrência/reverse-reschedule, destino ocupado/desativado, policy change e rollback mantém original.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DB concorrência/reverse-reschedule, destino ocupado/desativado, policy change e rollback mantém original.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T34$" ./src/modules/operations/application/reschedule-service-appointment.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T34 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t34 reschedule without losing the original slot`

### T35: Adapt approved service orders to the appointment authority

**What**: Online aprovado usa admissão única e projeção compatível ServiceReservation; todos escritores legados de serviço passam pela mesma autoridade; guarda financeira/estoque de produto intactas.
**Where**: `apps/api/src/shared/persistence/order-fulfillment.ts`
**Depends on**: T34
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-05, BOOK-08, BOOK-10, REG-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-booking.integration.spec.ts + product-stock-regression.integration.spec.ts: paid guard, retry, mixed tenants e snapshot histórico.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-booking.integration.spec.ts + product-stock-regression.integration.spec.ts: paid guard, retry, mixed tenants e snapshot histórico.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T35$" ./src/shared/persistence/order-fulfillment.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T35 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t35 adapt approved service orders to the appointment authority`

### T36: Reconcile late payment without a false appointment

**What**: PSP aprovado sem vaga mantém evidência e cria regularização visível, sem confirmar/cobrar novamente; evento pendente segue processado mesmo sem novas admissões habilitadas.
**Where**: `apps/api/src/modules/payment/application/reconcile-service-payment.use-case.ts`
**Depends on**: T35
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-06, BOOK-08, REG-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-booking.integration.spec.ts: pagamento tardio, lease vencido, concorrência, webhook repetido, status unknown e disable in-flight.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-booking.integration.spec.ts: pagamento tardio, lease vencido, concorrência, webhook repetido, status unknown e disable in-flight.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T36$" ./src/modules/payment/application/reconcile-service-payment.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T36 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t36 reconcile late payment without a false appointment`

### T37: Record an audited attendance receipt

**What**: Valor em centavos/moeda, forma/operador/instante e idempotencyKey; registro local distinto de PSP, não altera comparecimento nem duplica recebimento.
**Where**: `apps/api/src/modules/operations/application/record-attendance-receipt.use-case.ts`
**Depends on**: T36
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-07, BOOK-08, KPI-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP/DB: amount inválido, overpayment não suportado, foreign/forbidden, retry e saldo/financeiro independentes.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB: amount inválido, overpayment não suportado, foreign/forbidden, retry e saldo/financeiro independentes.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T37$" ./src/modules/operations/application/record-attendance-receipt.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T37 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t37 record an audited attendance receipt`

### T38: Project service events through the existing outbox

**What**: Consumidor correlaciona evento/versão/agendamento com notificação; replay idempotente, sem shipped/inventory_sale físico; falha de canal não desfaz reserva.
**Where**: `apps/api/src/modules/notifications/application/service-appointment-events.consumer.ts`
**Depends on**: T37
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-08, BOOK-10, EDGE-03, REG-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Integration: DB/outbox+fake transport, evento duplicado, ordem tardia, falha de mídia e nenhuma saída física.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Integration: DB/outbox+fake transport, evento duplicado, ordem tardia, falha de mídia e nenhuma saída física.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T38$" ./src/modules/notifications/application/service-appointment-events.consumer.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T38 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t38 project service events through the existing outbox`

### T39: Present service confirmation and pending payment truthfully

**What**: Resumo formatado com profissional/serviço/data/hora/fuso/valor e financeiro real; mídia opcional primeiro, texto preservado; não usar frase de pedido enviado.
**Where**: `apps/api/src/modules/whatsapp-channel/domain/ui/service-appointment-confirmation.ts`
**Depends on**: T38
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-10, EDGE-03, QA-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit presenter + channel integration: formato em tons configurados, texto sem mídia e snapshots de confirmação não paga/paga/regularização.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit presenter + channel integration: formato em tons configurados, texto sem mídia e snapshots de confirmação não paga/paga/regularização.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T39$" ./src/modules/whatsapp-channel/domain/ui/service-appointment-confirmation.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T39 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t39 present service confirmation and pending payment truthfully`

### T40: Expose the buyer booking commands

**What**: Controller de seleção/preparação/confirmação do comprador usa sessão autenticada e comandos canônicos, versões/idempotência; aplica modo e limitações sem PSP implícito. Rotas de produto existentes não mudam.
**Where**: `apps/api/src/modules/checkout/presentation/http/service-booking.controller.ts`
**Depends on**: T39
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-04, BOOK-03, BOOK-04, BOOK-05, EDGE-01, EDGE-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP/DB service-booking.integration.spec.ts: rotas reais happy/invalid/foreign/expired/stale/duplicate, local e online, e respostas honestas de capacidade.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB service-booking.integration.spec.ts: rotas reais happy/invalid/foreign/expired/stale/duplicate, local e online, e respostas honestas de capacidade.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T40$" ./src/modules/checkout/presentation/http/service-booking.controller.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T40 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t40 expose the buyer booking commands`

### T41: Expose authorized appointment operations

**What**: Controller administrativo de lista/detalhe/manual/transição/cancelar/remarcar/recebimento liga comandos auditados, filtra tenant/profissional/categoria/período e exige modo/permissão esperados; sem regras de agenda no browser.
**Where**: `apps/api/src/modules/operations/presentation/http/service-appointments.controller.ts`
**Depends on**: T40
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-06, ATEND-07, ATEND-08, BOOK-07, BOOK-09

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP/DB service-administration.integration.spec.ts: cada rota happy/invalid/foreign/forbidden/conflict/duplicate e política online/no atendimento; trilha e rollback.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB service-administration.integration.spec.ts: cada rota happy/invalid/foreign/forbidden/conflict/duplicate e política online/no atendimento; trilha e rollback.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T41$" ./src/modules/operations/presentation/http/service-appointments.controller.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T41 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t41 expose authorized appointment operations`

### T42: Resolve service selection from text or voice

**What**: Resolver usa IDs/estado atuais; data/profissional ambíguos pedem escolha, pergunta lateral preserva seleção; não transforma transcrição em autorização de pagar.
**Where**: `apps/api/src/modules/catalog/domain/services/service-selection.ts`
**Depends on**: T41
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-07, AGENDA-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-selection.spec.ts + service-channel-journey.integration.spec.ts: homônimos, data relativa/fuso, transcrição ambígua e mudança de assunto.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-selection.spec.ts + service-channel-journey.integration.spec.ts: homônimos, data relativa/fuso, transcrição ambígua e mudança de assunto.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T42$" ./src/modules/catalog/domain/services/service-selection.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T42 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t42 resolve service selection from text or voice`

### T43: Connect storefront tools to canonical scheduling

**What**: Handlers tipados de serviço chamam leitores/admissão e apresentam seleção, erros e política; registram ferramentas via composição; fluxos de produto continuam no handler anterior.
**Where**: `apps/api/src/modules/storefront/infrastructure/tool-handlers/service-booking.handlers.ts`
**Depends on**: T42
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-02, AGENDA-03, AGENDA-04, REG-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + HTTP/DB tool-dispatch: serviços e produtos, payload inválido/foreign, nenhum slot/promessa vindo de embedding.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + HTTP/DB tool-dispatch: serviços e produtos, payload inválido/foreign, nenhum slot/promessa vindo de embedding.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T43$" ./src/modules/storefront/infrastructure/tool-handlers/service-booking.handlers.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T43 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t43 connect storefront tools to canonical scheduling`

### T44: Render native date and slot controls

**What**: Controles nativos datas→slots e resumo respeitam limites/paginação/Menu principal, fuso/duração, seleção stale/sem vaga/erro, sem poluir menu de produtos.
**Where**: `apps/api/src/modules/whatsapp-channel/domain/ui/service-booking-controls.ts`
**Depends on**: T43
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-02, AGENDA-03, AGENDA-06, QA-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + capturas da aplicação local: service-channel-journey.integration.spec.ts, native action IDs e paginação com muitas datas/slots.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + capturas da aplicação local: service-channel-journey.integration.spec.ts, native action IDs e paginação com muitas datas/slots.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T44$" ./src/modules/whatsapp-channel/domain/ui/service-booking-controls.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T44 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t44 render native date and slot controls`

### T45: Render the storefront service picker

**What**: Componente data/horário/profissional consome autoridade API, não calcula vaga; mostra pending/empty/error/conflict e resumo; não aparece em produto.
**Where**: `apps/widget_v2/src/components/checkout/ServiceBookingPicker.tsx`
**Depends on**: T44
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-02, AGENDA-03, AGENDA-04, REG-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Browser local 390/1440, teclado e foco; spec de componente conforme runner existente reconciliado em T1 e e2e service-local.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Browser local 390/1440, teclado e foco; spec de componente conforme runner existente reconciliado em T1 e e2e service-local.
**Gate**: Browser: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T45$"` + contract/unit correspondente e Build. Teste raiz T45 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t45 render the storefront service picker`

### T46: Route WhatsApp service actions without replacing commerce

**What**: Dispatcher de serviço valida token/estado/profissional/policyVersion e ações de texto/voz; produto permanece no adapter aprovado, sem campo obrigatório novo no carrinho.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-service-booking.service.ts`
**Depends on**: T45
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-04, AGENDA-07, BOOK-04, REG-01, REG-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-channel-journey.integration.spec.ts: dois tenants/ambos modos, texto/voz, checkout lateral e atualização segura de menu.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-channel-journey.integration.spec.ts: dois tenants/ambos modos, texto/voz, checkout lateral e atualização segura de menu.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T46$" ./src/modules/whatsapp-channel/application/services/whatsapp-service-booking.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T46 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t46 route whatsapp service actions without replacing commerce`

### T47: Wire the scheduling adapters into the existing application

**What**: Um componente Nest registra providers/controllers/adapters já implementados, guardas e outbox; imports sem ciclos; nova admissão depende de capability e migração dos escritores.
**Where**: `apps/api/src/modules/catalog/service-scheduling.module.ts`
**Depends on**: T46
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-08, REG-01, REG-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Construction + real HTTP startup/DB: nenhuma conexão externa implícita, produtos funcionam com agenda desabilitada, service route/permissions.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Construction + real HTTP startup/DB: nenhuma conexão externa implícita, produtos funcionam com agenda desabilitada, service route/permissions.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T47$" ./src/modules/catalog/service-scheduling.module.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T47 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t47 wire the scheduling adapters into the existing application`

### T48: Persist the channel handoff binding

**What**: Binding tenant/config/sessão/ticket e modo/epoch separado de lifecycle, CAS/idempotência; buscar sessão ativa não apaga checkout nem pausa.
**Where**: `apps/api/src/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.ts`
**Depends on**: T25
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-03, EDGE-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] DB handoff integration: próximo inbound, restart, duplicata, binding estrangeiro e corrida com sessão renovada.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DB handoff integration: próximo inbound, restart, duplicata, binding estrangeiro e corrida com sessão renovada.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T48$" ./src/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T48 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t48 persist the channel handoff binding`

### T49: Create or reuse a WhatsApp support handoff

**What**: Ticket e binding duráveis antes de confirmar encaminhamento; origem WhatsApp confiável em vez de widget hardcoded; booking/policy link opcionais, cart preservado.
**Where**: `apps/api/src/modules/support/application/support-handoff.service.ts`
**Depends on**: T48
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-02, HUM-03, BOOK-09

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP/DB whatsapp-human-handoff.integration.spec.ts: botão/texto/voz durante checkout, repetição, falha transacional e tenant.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB whatsapp-human-handoff.integration.spec.ts: botão/texto/voz durante checkout, repetição, falha transacional e tenant.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T49$" ./src/modules/support/application/support-handoff.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T49 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t49 create or reuse a whatsapp support handoff`

### T50: Route incoming human-mode messages to support

**What**: Entrada deduplicada vai ao ticket ativo autenticado sem LLM/ação de carrinho enquanto waiting_human/human; preserva conteúdo/voice transcript autorizado e histórico.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-human-message-router.ts`
**Depends on**: T49
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-03, HUM-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] DB/HTTP incoming duplicates, texto/voz, sem geração/cobrança/cart mutation; erro não perde entrada.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DB/HTTP incoming duplicates, texto/voz, sem geração/cobrança/cart mutation; erro não perde entrada.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T50$" ./src/modules/whatsapp-channel/application/services/whatsapp-human-message-router.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T50 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t50 route incoming human-mode messages to support`

### T51: Fence every automatic WhatsApp dispatch

**What**: Verificar epoch antes da geração e de cada envio/retomada, inclusive apresentação preparada parcial; integrar boundary único de dispatch existente sem alterar produto em modo ai.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-ai-dispatch-fence.ts`
**Depends on**: T50
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: EDGE-04, HUM-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Race integration: takeover durante LLM, depois de preparar media, entre mensagens e após retry; zero auto-send posterior.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Race integration: takeover durante LLM, depois de preparar media, entre mensagens e após retry; zero auto-send posterior.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T51$" ./src/modules/whatsapp-channel/application/services/whatsapp-ai-dispatch-fence.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T51 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t51 fence every automatic whatsapp dispatch`

### T52: Claim a conversation with compare-and-set

**What**: Apenas operador autorizado do tenant assume ticket WhatsApp disponível; claim atômico impede dupla posse e conserva auditoria.
**Where**: `apps/api/src/modules/support/application/claim-whatsapp-conversation.use-case.ts`
**Depends on**: T51
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, ATEND-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP/DB claims simultâneos, re-claim idempotente, operador sem permissão e outro tenant.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB claims simultâneos, re-claim idempotente, operador sem permissão e outro tenant.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T52$" ./src/modules/support/application/claim-whatsapp-conversation.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T52 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t52 claim a conversation with compare-and-set`

### T53: Queue an operator message atomically

**What**: Persistir message/clientMessageId e outbox na mesma transação, canal destino do binding; gravação aparece queued e não read; caminhos de suporte existentes preservados.
**Where**: `apps/api/src/modules/support/application/send-ticket-message.use-case.ts`
**Depends on**: T52
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, HUM-05

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] DB/HTTP: duplicate, foreign ticket, closed ticket, outbox rollback e suporte widget anterior.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DB/HTTP: duplicate, foreign ticket, closed ticket, outbox rollback e suporte widget anterior.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T53$" ./src/modules/support/application/send-ticket-message.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T53 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t53 queue an operator message atomically`

### T54: Deliver the operator outbox to the original thread

**What**: Enviar pelo canal/config/thread autenticados, respeitar janela/conexão; correlacionar providerMessageId; falha/unknown distintos, retry sem duplicação cega.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-support-outbox.consumer.ts`
**Depends on**: T53
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-05, HUM-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Integration fake provider determinístico: accepted/error/timeout/window/offline/duplicate; nenhum destinatário vindo livre do cliente.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Integration fake provider determinístico: accepted/error/timeout/window/offline/duplicate; nenhum destinatário vindo livre do cliente.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T54$" ./src/modules/whatsapp-channel/application/services/whatsapp-support-outbox.consumer.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T54 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t54 deliver the operator outbox to the original thread`

### T55: Preserve delivery and read receipts

**What**: Mapear queued/accepted/delivered/read/failed/unknown com correlação e eventos fora de ordem; callback autenticado e monotonicidade, aceite não é leitura.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-support-delivery.service.ts`
**Depends on**: T54
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-05, HUM-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP callback/DB: read antes de delivered, duplicata, outro tenant/providerId, assinatura inválida e unknown reconciliado.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP callback/DB: read antes de delivered, duplicata, outro tenant/providerId, assinatura inválida e unknown reconciliado.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T55$" ./src/modules/whatsapp-channel/application/services/whatsapp-support-delivery.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T55 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t55 preserve delivery and read receipts`

### T56: Close the active human case and resume once

**What**: Fechar ticket e mudar modo/epoch + retorno outbox atomicamente; só vínculo ativo; ticket antigo/duplicata não retoma outro caso nem reenvia cobrança.
**Where**: `apps/api/src/modules/support/application/close-whatsapp-conversation.use-case.ts`
**Depends on**: T55
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-06, EDGE-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] whatsapp-human-handoff.integration.spec.ts: double close, old ticket, crash/retry, novo handoff concorrente e checkout produto preservado.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: whatsapp-human-handoff.integration.spec.ts: double close, old ticket, crash/retry, novo handoff concorrente e checkout produto preservado.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T56$" ./src/modules/support/application/close-whatsapp-conversation.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T56 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t56 close the active human case and resume once`

### T57: Add a fixed human action to the main menu

**What**: Falar com atendente visível no principal para products/services, respeitando capacidade/paginação; menus de produto continuam só ações pertinentes e Menu principal.
**Where**: `apps/api/src/modules/whatsapp-channel/domain/ui/buyer-hub.ts`
**Depends on**: T56
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-01, HUM-02, REG-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] buyer-hub.spec.ts + handoff integration por botão/texto/voz, limites nativos e menus já aprovados.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: buyer-hub.spec.ts + handoff integration por botão/texto/voz, limites nativos e menus já aprovados.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T57$" ./src/modules/whatsapp-channel/domain/ui/buyer-hub.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T57 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t57 add a fixed human action to the main menu`

### T58: Expose a channel-scoped conversation queue

**What**: Controller lista/detalha fila WhatsApp e ações ligam comandos existentes, servidor filtra tenant/canal/role; DTO inclui estados verdadeiros sem credenciais.
**Where**: `apps/api/src/modules/support/presentation/http/whatsapp-conversations.controller.ts`
**Depends on**: T57
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, HUM-08, HUM-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP/DB cada rota: pagination/claim/send/close, forbidden/foreign, offline/empty/error e suporte anterior.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB cada rota: pagination/claim/send/close, forbidden/foreign, offline/empty/error e suporte anterior.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T58$" ./src/modules/support/presentation/http/whatsapp-conversations.controller.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T58 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t58 expose a channel-scoped conversation queue`

### T59: Separate conversation and configuration permissions

**What**: Regra explícita service-attendance e WhatsApp conversas para operador autorizado; Staff não recebe tokens/templates/config; plano não substitui autorização/modo.
**Where**: `apps/dashboard/src/lib/auth/permissions.ts`
**Depends on**: T58
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, HUM-08, ATEND-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] permissions.spec.ts: role×mode×capability×plan e fallback de rota desconhecida negado onde sensível.
- [ ] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: permissions.spec.ts: role×mode×capability×plan e fallback de rota desconhecida negado onde sensível.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/lib/auth/permissions.spec.ts -t "^T59$"` Teste raiz T59 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t59 separate conversation and configuration permissions`

### T60: Load and reconcile the conversation queue

**What**: Hook reusa APIs/WS suporte, server filter/cursor, reconcilia clientMessageId e status sem duplicação; loading/empty/error/unknown distintos.
**Where**: `apps/dashboard/src/pages/whatsapp-seller/useWhatsAppConversations.ts`
**Depends on**: T59
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, HUM-05, HUM-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] useWhatsAppConversations.spec.ts: concorrência de claim, mensagens repetidas, reconnect, erro e sem vazamento por tenant.
- [ ] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: useWhatsAppConversations.spec.ts: concorrência de claim, mensagens repetidas, reconnect, erro e sem vazamento por tenant.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/pages/whatsapp-seller/useWhatsAppConversations.spec.ts -t "^T60$"` Teste raiz T60 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t60 load and reconcile the conversation queue`

### T61: Present the bound support conversation

**What**: Reusar SupportChatDrawer/UI: assumir/responder/encerrar, histórico e entrega fiel, modo humano/retorno claros; não inventar recebido/lido.
**Where**: `apps/dashboard/src/pages/whatsapp-seller/components/WhatsAppConversationDrawer.tsx`
**Depends on**: T60
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, HUM-05, HUM-06, QA-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + browser local drawer: queued/unknown/failed/read, keyboard/focus, capture artifacts/whatsapp-conversations.running.png.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + browser local drawer: queued/unknown/failed/read, keyboard/focus, capture artifacts/whatsapp-conversations.running.png.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/whatsapp-seller/components/WhatsAppConversationDrawer.spec.tsx -t "^T61$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T61$"` Teste raiz T61 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t61 present the bound support conversation`

### T62: Mount Conversations inside WhatsApp

**What**: Aba Conversas no módulo existente para ambos modos, permissions por aba e URL; Conexão/Modelos/Consumo preservados e sem central RAG.
**Where**: `apps/dashboard/src/pages/whatsapp-seller/WhatsAppSellerPage.tsx`
**Depends on**: T61
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-08, HUM-04, REG-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] WhatsAppSellerPage.conversations.spec.tsx + browser direct tab/refresh/back/role, screenshot da tab e erro.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: WhatsAppSellerPage.conversations.spec.tsx + browser direct tab/refresh/back/role, screenshot da tab e erro.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/whatsapp-seller/WhatsAppSellerPage.spec.tsx -t "^T62$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T62$"` Teste raiz T62 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t62 mount conversations inside whatsapp`

### T63: Project only approved public business fields

**What**: Union tipada de company/hours/professional/service/faq/policy e allowlist por fonte; origem/version/hash/publication; nada de paciente, operador, credenciais, chat, pagamento ou bloqueio privado.
**Where**: `apps/api/src/modules/graph-rag/domain/public-business-source.ts`
**Depends on**: T13, T18
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-01, RAG-07, RAG-10, RAG-11

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] public-business-source.spec.ts + business-rag.integration.spec.ts com canários privados em cada entidade e três negócios.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: public-business-source.spec.ts + business-rag.integration.spec.ts com canários privados em cada entidade e três negócios.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T63$" ./src/modules/graph-rag/domain/public-business-source.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T63 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t63 project only approved public business fields`

### T64: Queue source work durably with canonical writes

**What**: Registro idempotente de trabalho/outbox por fonte/version e retry após falha; escritores canônicos usam transação existente, não depender só de evento em memória.
**Where**: `apps/api/src/modules/graph-rag/application/public-source-work.service.ts`
**Depends on**: T63
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-01, RAG-03, RAG-11

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] DB business-rag.integration.spec.ts: gravação com worker fora, crash, retry, duplicata e rollback de fonte/trabalho.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DB business-rag.integration.spec.ts: gravação com worker fora, crash, retry, duplicata e rollback de fonte/trabalho.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T64$" ./src/modules/graph-rag/application/public-source-work.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T64 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t64 queue source work durably with canonical writes`

### T65: Connect reconciliation to the actual source writers

**What**: Assinaturas/reconciliador cobrem os escritores reais já ligados ao contrato de outbox nas tarefas anteriores, incluindo políticas/FAQ/company/profissional/serviço; não depender de seed ou evento inexistente.
**Where**: `apps/api/src/modules/graph-rag/application/graph-sync.service.ts`
**Depends on**: T64, T25
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-01, RAG-02, RAG-11

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Integration altera cada formulário/API real e encontra trabalho/fonte atual; cron retry/offline/retirada, sem sleeps frágeis.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Integration altera cada formulário/API real e encontra trabalho/fonte atual; cron retry/offline/retirada, sem sleeps frágeis.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T65$" ./src/modules/graph-rag/application/graph-sync.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T65 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t65 connect reconciliation to the actual source writers`

### T66: Index source versions idempotently

**What**: Worker ordena versões, grava projeção/hash/model e marca resultado; versão velha não sobrepõe nova, falha mantém retry e erro observável; batches limitados.
**Where**: `apps/api/src/modules/graph-rag/application/graph-projection.service.ts`
**Depends on**: T65
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-01, RAG-03, RAG-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] DB+Neo4j local: concorrência, duplicate/out-of-order, worker crash, embedding fake, source save continua válido.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DB+Neo4j local: concorrência, duplicate/out-of-order, worker crash, embedding fake, source save continua válido.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T66$" ./src/modules/graph-rag/application/graph-projection.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T66 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t66 index source versions idempotently`

### T67: Backfill and retire public source projections

**What**: Backfill tenant-scoped de dados existentes e tombstones ao retirar/publicar; retomável/versionado e sem reativar texto antigo, sem central manual.
**Where**: `apps/api/src/modules/graph-rag/application/reconcile-public-sources.use-case.ts`
**Depends on**: T66
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-02, RAG-03, RAG-10

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] business-rag.integration.spec.ts: backfill/restart/delete/unpublish/recreate e worker offline, stale vector não vira fonte ativa.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: business-rag.integration.spec.ts: backfill/restart/delete/unpublish/recreate e worker offline, stale vector não vira fonte ativa.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T67$" ./src/modules/graph-rag/application/reconcile-public-sources.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T67 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t67 backfill and retire public source projections`

### T68: Revalidate evidence independently of graph availability

**What**: Checar tenant/publicação/version/hash canônicos tanto graph quanto fallback; ausência/contradição/indisponibilidade distintas; retirada invalida evidência imediatamente.
**Where**: `apps/api/src/modules/knowledge-base/application/use-cases/revalidate-public-source.service.ts`
**Depends on**: T67
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-02, RAG-04, RAG-06, RAG-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + DB: stale hash/foreign/private, graph on/off, conflicting source e canonical outage sem falso nenhum produto.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + DB: stale hash/foreign/private, graph on/off, conflicting source e canonical outage sem falso nenhum produto.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T68$" ./src/modules/knowledge-base/application/use-cases/revalidate-public-source.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T68 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t68 revalidate evidence independently of graph availability`

### T69: Keep provenance through the knowledge reader

**What**: KnowledgeChunk e auditoria conservam sourceType/id/version/hash/model/publication; adaptar tipo compartilhado e consumidores estritamente necessários sem vazar conteúdo privado.
**Where**: `apps/api/src/modules/knowledge-base/infrastructure/graph-knowledge.reader.ts`
**Depends on**: T68
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-04, RAG-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Reader contract + business-rag.integration.spec.ts: metadata end-to-end até resposta auditada, tenant e fonte exata.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Reader contract + business-rag.integration.spec.ts: metadata end-to-end até resposta auditada, tenant e fonte exata.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T69$" ./src/modules/knowledge-base/infrastructure/graph-knowledge.reader.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T69 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t69 keep provenance through the knowledge reader`

### T70: Extend parameterized Cypher templates for services

**What**: Templates aprovados unem serviço/profissional/conhecimento público com parâmetros tenant, limite/timeout; gateway Community privado mantém rejeição de escrita e Cypher livre; disponibilidade continua ferramenta operacional.
**Where**: `apps/api/src/modules/graph-rag/domain/graph-query.ts`
**Depends on**: T69
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-05, RAG-08, EDGE-05

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit gate + Neo4j/gateway local: queries avançadas, cross-tenant, escrita/subquery/procedure/arbitrary text rejeitados.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit gate + Neo4j/gateway local: queries avançadas, cross-tenant, escrita/subquery/procedure/arbitrary text rejeitados.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T70$" ./src/modules/graph-rag/domain/graph-query.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T70 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t70 extend parameterized cypher templates for services`

### T71: Compose grounded knowledge with live service tools

**What**: Consulta combina evidência pública e preço/agenda canônicos com fonte; ambíguo esclarece, conflito/erro não inventa; decisões profissionais individuais vão ao humano; fonte não executa ferramenta.
**Where**: `apps/api/src/modules/knowledge-base/application/use-cases/query-knowledge.use-case.ts`
**Depends on**: T70
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-05, RAG-06, RAG-09, RAG-10, EDGE-05

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] business-rag.integration.spec.ts: preço/área/profissional/data compostos, vaga ocupada após embedding, injection, fonte ausente e três segmentos.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: business-rag.integration.spec.ts: preço/área/profissional/data compostos, vaga ocupada após embedding, injection, fonte ausente e três segmentos.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T71$" ./src/modules/knowledge-base/application/use-cases/query-knowledge.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T71 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t71 compose grounded knowledge with live service tools`

### T72: Evaluate the same RAG across three business fixtures

**What**: Runner de avaliação usa fixtures marcadas neurologia/salão/consultoria, casos positivos/negativos/contraditórios e métricas de fonte/ferramenta; falha em qualquer crítico bloqueia ativação, sem modelos/provedores reais por default.
**Where**: `apps/api/tests/business-rag-evaluation.mjs`
**Depends on**: T71
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: QA-04, RAG-09, RAG-10

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] business-rag-evaluation.spec.mjs: crítico errado não passa por média alta, ground truth por negócio, coverage e relatório com revisão.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: business-rag-evaluation.spec.mjs: crítico errado não passa por média alta, ground truth por negócio, coverage e relatório com revisão.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T72$" ./tests/business-rag-evaluation.spec.mjs` Teste raiz T72 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t72 evaluate the same rag across three business fixtures`

### T73: Type the service administration API client

**What**: Cliente tipado para contratos implementados, expectedVersion/idempotencyKey; não recalcula vagas/saldo nem envia tenant livre; erros discriminados e nenhum token de conexão.
**Where**: `apps/dashboard/src/api/endpoints/service-attendance.ts`
**Depends on**: T72
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-attendance.api.spec.ts: requests/DTOs, invalid/forbidden/conflict/network e retries somente seguros.
- [ ] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-attendance.api.spec.ts: requests/DTOs, invalid/forbidden/conflict/network e retries somente seguros.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/api/endpoints/service-attendance.spec.ts -t "^T73$"` Teste raiz T73 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t73 type the service administration api client`

### T74: Manage service administration view state

**What**: Hook de período/profissional/categoria/aba e ações serializadas com loading/empty/error/conflict; não otimiza confirmação de vaga/pagamento antes do servidor.
**Where**: `apps/dashboard/src/pages/service-attendance/useServiceAttendancePage.ts`
**Depends on**: T73
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-06, ATEND-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] useServiceAttendancePage.spec.ts: stale responses, filtro/URL/refresh, rollback visual e erro de comando.
- [ ] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: useServiceAttendancePage.spec.ts: stale responses, filtro/URL/refresh, rollback visual e erro de comando.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/useServiceAttendancePage.spec.ts -t "^T74$"` Teste raiz T74 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t74 manage service administration view state`

### T75: Create the service-only Atendimento page shell

**What**: Agenda/Profissionais/Categorias/Disponibilidade/Configurações com componentes existentes, filtros e guard de modo; capturas artifacts/atendimento.running.png desktop/mobile.
**Where**: `apps/dashboard/src/pages/service-attendance/ServiceAttendancePage.tsx`
**Depends on**: T74
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-08, QA-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] ServiceAttendancePage.spec.tsx + browser local: tab/deep link, produto negado, loading/empty/error e acessibilidade.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: ServiceAttendancePage.spec.tsx + browser local: tab/deep link, produto negado, loading/empty/error e acessibilidade.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/ServiceAttendancePage.spec.tsx -t "^T75$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T75$"` Teste raiz T75 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t75 create the service-only atendimento page shell`

### T76: Manage professionals in Atendimento

**What**: Lista/form de profissional público, fuso/serviços/estado; desativar preserva compromissos e mostra impacto, sem criar login implícito.
**Where**: `apps/dashboard/src/pages/service-attendance/components/ProfessionalsPanel.tsx`
**Depends on**: T75
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-02, AGENDA-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] ProfessionalsPanel.spec.tsx + browser create/edit/deactivate, validação e erro/foreign negado pela API.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: ProfessionalsPanel.spec.tsx + browser create/edit/deactivate, validação e erro/foreign negado pela API.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/components/ProfessionalsPanel.spec.tsx -t "^T76$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T76$"` Teste raiz T76 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t76 manage professionals in atendimento`

### T77: Reuse service categories in Atendimento

**What**: Painel reutiliza ProductCategory/API existente e associa ofertas service; não duplica tabela/preço/capacidade, mantém categorias de produtos isoladas por modo/tenant.
**Where**: `apps/dashboard/src/pages/service-attendance/components/ServiceCategoriesPanel.tsx`
**Depends on**: T76
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] ServiceCategoriesPanel.spec.tsx + browser categorias, vínculos, vazio/erro e leitura por dois profissionais sem capacidade extra.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: ServiceCategoriesPanel.spec.tsx + browser categorias, vínculos, vazio/erro e leitura por dois profissionais sem capacidade extra.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/components/ServiceCategoriesPanel.spec.tsx -t "^T77$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T77$"` Teste raiz T77 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t77 reuse service categories in atendimento`

### T78: Edit availability and blocks from one panel

**What**: Grade/fuso/avulso/bloqueio com preview canônico; conflito confirmado bloqueia salvar sem cancelar; descontinuar escrita independente do ServiceScheduleEditor quando nova autoridade ativa.
**Where**: `apps/dashboard/src/pages/service-attendance/components/AvailabilityPanel.tsx`
**Depends on**: T77
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-04, ATEND-05, ATEND-09

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] AvailabilityPanel.spec.tsx + browser recorrente/avulso/bloco/conflito/fuso e paridade de slots nos três leitores.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: AvailabilityPanel.spec.tsx + browser recorrente/avulso/bloco/conflito/fuso e paridade de slots nos três leitores.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/components/AvailabilityPanel.spec.tsx -t "^T78$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T78$"` Teste raiz T78 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t78 edit availability and blocks from one panel`

### T79: Create a manual booking with explicit one-off time

**What**: Cliente/serviço/profissional/data/slot e opção avulso explícita, resumo/política; submit idempotente; não marcar online pago/confirmado sem prova.
**Where**: `apps/dashboard/src/pages/service-attendance/components/ManualAppointmentDrawer.tsx`
**Depends on**: T78
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-06, ATEND-10

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] ManualAppointmentDrawer.spec.tsx + browser double submit, fora da grade, conflito, pagamento local/online e rollback.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: ManualAppointmentDrawer.spec.tsx + browser double submit, fora da grade, conflito, pagamento local/online e rollback.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/components/ManualAppointmentDrawer.spec.tsx -t "^T79$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T79$"` Teste raiz T79 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t79 create a manual booking with explicit one-off time`

### T80: Operate an appointment and its separate finances

**What**: Detalhe e ações autorizadas início/conclusão/ausência/cancelar/remarcar/registrar recebimento, financeiro separado e trilha; conflitos/regularização claros.
**Where**: `apps/dashboard/src/pages/service-attendance/components/AppointmentDetailDrawer.tsx`
**Depends on**: T79
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-07, BOOK-07, BOOK-09

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] AppointmentDetailDrawer.spec.tsx + browser transições pendentes de pagamento, recibo local e remarcação falha preserva original.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: AppointmentDetailDrawer.spec.tsx + browser transições pendentes de pagamento, recibo local e remarcação falha preserva original.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/components/AppointmentDetailDrawer.spec.tsx -t "^T80$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T80$"` Teste raiz T80 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t80 operate an appointment and its separate finances`

### T81: Configure merchant-owned hold and payment policy

**What**: Controle explícito hold ligado/desligado/duração e online/no atendimento com versão e validação; sem default oculto, aviso sobre novas seleções/políticas existentes.
**Where**: `apps/dashboard/src/pages/service-attendance/components/AppointmentPolicyPanel.tsx`
**Depends on**: T80
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ONB-03, EDGE-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] AppointmentPolicyPanel.spec.tsx + browser quatro combinações, falha de versão e persistência após reload.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: AppointmentPolicyPanel.spec.tsx + browser quatro combinações, falha de versão e persistência após reload.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/components/AppointmentPolicyPanel.spec.tsx -t "^T81$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T81$"` Teste raiz T81 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t81 configure merchant-owned hold and payment policy`

### T82: Separate Atendimento from the existing Suporte navigation

**What**: Nova chave service-attendance apenas services, support rotulada Suporte preservando FAQ/chamados; foco de catálogo Serviços; plano/modo/role independentes e histórico preservado.
**Where**: `apps/dashboard/src/shell/nav-config.ts`
**Depends on**: T81
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, HUM-08, KPI-01, REG-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] nav-config.business-mode.spec.ts: produtos/serviços, planos/roles, sem menu de agenda em produto e suporte/conversas acessíveis.
- [ ] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: nav-config.business-mode.spec.ts: produtos/serviços, planos/roles, sem menu de agenda em produto e suporte/conversas acessíveis.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/shell/nav-config.spec.ts -t "^T82$"` Teste raiz T82 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t82 separate atendimento from the existing suporte navigation`

### T83: Guard and mount the service route in the shell

**What**: Lazy render com guarda explícita, hash direto/reload/back/aba; produto não abre Atendimento por URL; rota antiga de suporte e WhatsApp continuam.
**Where**: `apps/dashboard/src/shell/DashboardShell.tsx`
**Depends on**: T82
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-08, REG-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] DashboardShell.service-attendance.spec.tsx + browser rotas diretas/refresh/back/capability denied e navegação anterior.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DashboardShell.service-attendance.spec.tsx + browser rotas diretas/refresh/back/capability denied e navegação anterior.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/shell/DashboardShell.spec.tsx -t "^T83$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T83$"` Teste raiz T83 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t83 guard and mount the service route in the shell`

### T84: Prepare a resumable historical appointment backfill

**What**: Ferramenta dry-run por padrão inventaria reservas anteriores, requer mapeamento explícito de profissional, reexecutável sem duplicar; habilitação só com todos escritores migrados. Testes usam somente runtime próprio local.
**Where**: `apps/api/scripts/service-appointment-backfill.mjs`
**Depends on**: T83
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: REG-04, BOOK-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-migration.integration.spec.mjs: unresolved resource, partial/retry, dados antigos intactos, idempotência e backfill sem autorizar produção.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-migration.integration.spec.mjs: unresolved resource, partial/retry, dados antigos intactos, idempotência e backfill sem autorizar produção.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T84$" ./tests/service-migration.integration.spec.mjs` Teste raiz T84 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t84 prepare a resumable historical appointment backfill`

### T85: Read appointment and receipt facts for metrics

**What**: Queries paginadas/agregadas por tenant/período/profissional/categoria, coorte startsAt e eventos financeiros separadamente; snapshots e asOf, sem CompletedOrder=presença.
**Where**: `apps/api/src/modules/operations/infrastructure/prisma-service-metrics.repository.ts`
**Depends on**: T84
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: KPI-02, KPI-04, KPI-05, KPI-06

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-metrics.integration.spec.ts: dois profissionais/categorias, completed não pago, pago não compareceu, estorno, fuso e query budget.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-metrics.integration.spec.ts: dois profissionais/categorias, completed não pago, pago não compareceu, estorno, fuso e query budget.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T85$" ./src/modules/operations/infrastructure/prisma-service-metrics.repository.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T85 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t85 read appointment and receipt facts for metrics`

### T86: Calculate occupancy and financial metric definitions

**What**: União de intervalos por profissional, clipping, bloqueios, denominador sem duplicação; valores agendado/recebível/recebido e bases temporais explícitas; nulo/erro não zero.
**Where**: `apps/api/src/modules/operations/domain/service-metrics.ts`
**Depends on**: T85
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: KPI-02, KPI-03, KPI-04, KPI-06, KPI-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-metrics.spec.ts com valores exatos e property/edge: overlap, duração, midnight/DST, 0 denom, ausência/paid e partial.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-metrics.spec.ts com valores exatos e property/edge: overlap, duração, midnight/DST, 0 denom, ausência/paid e partial.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T86$" ./src/modules/operations/domain/service-metrics.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T86 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t86 calculate occupancy and financial metric definitions`

### T87: Expose coherent filtered service metrics

**What**: DTO de modalidade/fuso/moeda/asOf/período/filtros/bases/dataStatus, totais e detalhes coerentes; auth/tenant/mode no servidor.
**Where**: `apps/api/src/modules/operations/presentation/http/service-metrics.controller.ts`
**Depends on**: T86
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: KPI-01, KPI-05, KPI-07, ATEND-08

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] HTTP/DB service-metrics.integration.spec.ts: filtros combinados, range inválido, foreign/forbidden/products e partial/unavailable.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: HTTP/DB service-metrics.integration.spec.ts: filtros combinados, range inválido, foreign/forbidden/products e partial/unavailable.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T87$" ./src/modules/operations/presentation/http/service-metrics.controller.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T87 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t87 expose coherent filtered service metrics`

### T88: Load service metrics without changing product requests

**What**: Hook usa endpoint de serviços e filtros canônicos, preserva status/undef e previne resposta antiga sobrescrever filtro; não chama comércio para fingir métrica de serviço.
**Where**: `apps/dashboard/src/pages/overview/useServiceOverview.ts`
**Depends on**: T87
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: KPI-01, KPI-05, KPI-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] useServiceOverview.spec.ts: status/filtros/race/timezone e request por modalidade.
- [ ] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: useServiceOverview.spec.ts: status/filtros/race/timezone e request por modalidade.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/pages/overview/useServiceOverview.spec.ts -t "^T88$"` Teste raiz T88 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t88 load service metrics without changing product requests`

### T89: Present the service overview

**What**: Cards claros de agenda/realizados/ocupação/agendado/a receber/recebido, legenda de base/coorte, loading/empty/error/parcial e sem denominador; captura artifacts/service-overview.running.png.
**Where**: `apps/dashboard/src/pages/overview/components/ServiceOverviewPanel.tsx`
**Depends on**: T88
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: KPI-01, KPI-02, KPI-03, KPI-04, KPI-06, KPI-07, QA-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] ServiceOverviewPanel.spec.tsx + browser fixtures de valores conhecidos, mobile/desktop e erros, sem receita fabricada.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: ServiceOverviewPanel.spec.tsx + browser fixtures de valores conhecidos, mobile/desktop e erros, sem receita fabricada.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/overview/components/ServiceOverviewPanel.spec.tsx -t "^T89$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T89$"` Teste raiz T89 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t89 present the service overview`

### T90: Select the approved overview by business mode

**What**: Branch canônico services monta painel novo; products mantém layout, cálculos e requests anteriores; modo desconhecido não mostra números inventados.
**Where**: `apps/dashboard/src/pages/overview/OverviewPage.tsx`
**Depends on**: T89
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: KPI-01, REG-01, REG-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] OverviewPage.business-mode.spec.tsx + métricas regressão existentes e browser antes/depois da empresa produto.
- [ ] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: OverviewPage.business-mode.spec.tsx + métricas regressão existentes e browser antes/depois da empresa produto.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/overview/OverviewPage.spec.tsx -t "^T90$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T90$"` Teste raiz T90 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t90 select the approved overview by business mode`

### T91: Keep legacy analytics explicitly scoped to their business basis

**What**: Adapter dos leitores overview/timeseries/analytics seleciona read model correto pela modalidade, sem misturar coorte/fluxo ou timezone servidor; produtos usam repositórios anteriores.
**Where**: `apps/api/src/modules/checkout/application/service-overview-routing.ts`
**Depends on**: T90
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: KPI-01, KPI-05, KPI-07, REG-01

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Unit + service-metrics.integration.spec.ts: duas superfícies públicas de métricas, total/detail/series coerentes e baseline produto idêntico.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + service-metrics.integration.spec.ts: duas superfícies públicas de métricas, total/detail/series coerentes e baseline produto idêntico.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T91$" ./src/modules/checkout/application/service-overview-routing.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T91 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t91 keep legacy analytics explicitly scoped to their business basis`

### T92: Run physical stock regressions in owned storage

**What**: Harness executa concorrência/rollback/replay reais de inventory/stock/orders em DB próprio, sem skip/env remoto; serviço e produto em tenants distintos mesma revisão; assert movimento/outbox/estoque/totais.
**Where**: `apps/api/tests/product-stock-regression.integration.spec.ts`
**Depends on**: T91
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: REG-03, QA-03

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Node integration named REG-03 e QA-03: estoque debitado uma vez no produto, nunca no serviço, tenant/warehouse e guard financeiro preservados.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Node integration named REG-03 e QA-03: estoque debitado uma vez no produto, nunca no serviço, tenant/warehouse e guard financeiro preservados.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T92$" ./tests/product-stock-regression.integration.spec.ts` Teste raiz T92 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t92 run physical stock regressions in owned storage`

### T93: Record the two-channel buyer acceptance journey

**What**: E2E por gestos em storefront e fixture local WhatsApp com mesma API/DB: produto aprovado e serviço com políticas; prints de UI/erros e manifesto distingue local/preview/provider real. Testes derivados da spec, não screenshots que aprovam a si mesmos.
**Where**: `apps/dashboard/e2e/service-product-coexistence.spec.ts`
**Depends on**: T92
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: QA-02, REG-01, REG-02, REG-03, AGENDA-07

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] Playwright named REG-02 e QA-02, anexos visuais 390/1440 e persistência; provider real permanece gate separado de ativação.
- [ ] Gate Build passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Playwright named REG-02 e QA-02, anexos visuais 390/1440 e persistência; provider real permanece gate separado de ativação.
**Gate**: Build: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "T93$"` + contract/unit correspondente e Build. Teste raiz T93 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t93 record the two-channel buyer acceptance journey`

### T94: Guard activation and safe disablement

**What**: Readiness exige políticas/mapeamento/escritores/provas críticas e versão compatíveis; habilitar por tenant; desativar só nova entrada, não abandonar appointments/pagamentos/webhooks existentes.
**Where**: `apps/api/src/modules/merchant/application/service-activation-readiness.service.ts`
**Depends on**: T93
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: REG-04, ONB-02, QA-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-migration.integration.spec.mjs named REG-04 e readiness.spec.ts: requisito faltante bloqueia, produto jamais ativa, desligar com in-flight preserva processamento.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-migration.integration.spec.mjs named REG-04 e readiness.spec.ts: requisito faltante bloqueia, produto jamais ativa, desligar com in-flight preserva processamento.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T94$" ./src/modules/merchant/application/service-activation-readiness.service.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T94 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t94 guard activation and safe disablement`

### T95: Collect revision-bound acceptance evidence

**What**: Coletor valida cobertura dos 72 IDs, teste selecionado executado sem skip, revisão/API/frontend e origem local/provider de artifacts; gera matriz/report de evidências sem atribuir aceite remoto a mocks.
**Where**: `apps/api/tests/service-acceptance-report.mjs`
**Depends on**: T94, T97
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: QA-01, QA-02, QA-03, QA-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-acceptance-report.spec.mjs named QA-01: HEAD divergente/zero casos/skip/claim sem prova/critical falho/print preview mislabeled bloqueiam; relatório final só completo após check_proofs e verificação independente.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-acceptance-report.spec.mjs named QA-01: HEAD divergente/zero casos/skip/claim sem prova/critical falho/print preview mislabeled bloqueiam; relatório final só completo após check_proofs e verificação independente.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T95$" ./tests/service-acceptance-report.spec.mjs` Teste raiz T95 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t95 collect revision-bound acceptance evidence`

### T96: Persist a public service-name list only for service businesses

**What**: Expandir o JSON canônico company.serviceNames com lista simples pública; validar e normalizar nomes, preservar omissão e limpar com[]. Aplicar guard da modalidade sob lock nos três writers/aliases existentes, roundtrip por ambos getters, trabalho durável/invalidação transacional e retirada do contexto ao mudar para produtos, preservando JSON histórico e todos os dados de comércio.
**Where**: `apps/api/src/modules/merchant/application/company-settings-write.ts`; mappers/types/DTOs existentes estritamente necessários e o writer de troca de modalidade.
**Depends on**: T16
**Reuses**: company.description/merge/mapper/outbox de T13/T14, modalidade canônica T12 e runtime local T2; sem nova tabela, catálogo duplicado, preço ou agenda.
**Requirement**: ONB-06, RAG-11, REG-01

**Done when**:

- [ ] Lista pública validada persiste e reabre por todas as rotas equivalentes; omissão preserva,[] limpa, entrada inválida/foreign/product não altera fonte, trabalho, chunks ou demais dados.
- [ ] Retirada/troca para products remove a lista da apresentação/contexto e invalida sua evidência antiga sem apagar histórico; mudança e trabalho são atômicos com rollback comprovado.
- [ ] Unit + HTTP/DB reais locais passam, sem skipped, com checked build íntegro e commit próprio; sem ação remota.

**Tests**: company-service-names.spec.ts; service-company-service-names.integration.spec.mjs com services/products, três rotas, auth/tenant, merge/clear/limits, concorrência/rollback e modo/contexto.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T96$" ./src/modules/merchant/application/company-service-names.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/service-company-service-names.integration.spec.mjs`; checked API build quando a fonte muda. Check final ONB-06 permanece obrigatório.
**Commit**: `feat(service-business): t96 persist service names in company data`

### T97: Edit the service-name list in the existing company form

**What**: Controle acessível de nomes em Dados da empresa sóservices, com botão+ e editar/remover, foco/feedback, payload mínimo e reload/erro/retry. Usa company.serviceNames sem criar ofertas agendáveis. Capturas reais desktop/mobile e prova final da lista pública no RAG.
**Where**: `apps/dashboard/src/pages/store-settings/ServiceNamesField.tsx`; hook/form/types e fixture/browser existentes estritamente necessários.
**Depends on**: T96
**Reuses**: CompanyAboutField, useStoreSettingsPage, perfil businessMode, componentes existentes e browser local T3; UI de produtos e catálogo comercial preservados.
**Requirement**: ONB-06, QA-02, REG-01

**Done when**:

- [ ] Serviços: clicar+, editar/remover, salvar, reabrir, limpar e recuperar rascunho de falha funcionam com API/DB local real; oculto em products e nomes antigos não vazam para novo modo.
- [ ] Unit e browser com gestos reais passam; capturas desktop/mobile mostram o controle e a condição de modalidade; nenhum teste anterior removido/relaxado.
- [ ] Coletor final ONB-06 executa prova nativa de contexto público e browser, falha com zero/skipped e registra revisão/ambiente; gate e commit próprios.

**Tests**: ServiceNamesField.spec.tsx, hook tests e e2e/service-company-service-names.spec.ts; service-company-services-proof.mjs seleciona ONB-06 nativo e browserT97 sem confundir mocks com RAG/provider real.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/store-settings/ServiceNamesField.spec.tsx -t "^T97$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-company-service-names.spec.ts --grep "T97$"`; tipos/build afetados e check final ONB-06 obrigatórios.
**Commit**: `feat(service-business): t97 edit service names in company settings`

## Checks

Um check por critério, cada nome de teste é exatamente o ID citado (um teste raiz por ID; subcasos exercitam as condições desse critério). `--test-name-pattern`/`--grep` seleciona esse teste; zero matches/skip falha no coletor, não conta como prova. Arquivos são planejados e escritos com as tarefas responsáveis. Os testes de integração usam runtime próprio T2, DB/HTTP/Redis e grafo local quando exigido. QA-02 produz capturas da aplicação local, não fotos alegadas de produção. Provas locais não concluem aceitação Meta/PSP real.

**C1** - WHEN a empresa conclui o signup THEN the system SHALL persistir exatamente uma modalidade comercial, `products` ou `services`, selecionada em "O que sua empresa vende?". (ONB-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ONB-01$" ./tests/service-business-onboarding.integration.spec.mjs`
Tasks: T4, T8, T9, T10.

**C2** - WHILE a modalidade é `products` the system SHALL ocultar as ações de agendamento e recusar tentativas de executá-las pela API, preservando a navegação atual de produtos. (ONB-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ONB-02$" ./tests/service-business-onboarding.integration.spec.mjs`
Tasks: T7, T9, T10, T17, T19, T94.

**C3** - WHEN uma empresa de serviços configura atendimento THEN the system SHALL exigir a escolha explícita de bloqueio temporário, duração positiva em minutos quando habilitado, e pagamento `online` ou `at_attendance`. (ONB-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ONB-03$" ./tests/service-business-onboarding.integration.spec.mjs`
Tasks: T4, T7, T11, T27, T81.

**C4** - IF uma troca de modalidade conflita com ofertas ativas ou agendamentos existentes THEN the system SHALL recusar a troca com a indicação do conflito, sem excluir nem converter registros. (ONB-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ONB-04$" ./tests/service-migration.integration.spec.mjs`
Tasks: T5, T7, T12, T17.

**C5** - WHEN a empresa edita Dados da empresa THEN the system SHALL permitir salvar e reabrir o campo "Sobre a empresa" usando a descrição pública canônica, sem duplicar seu armazenamento. (ONB-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ONB-05$" ./tests/service-business-onboarding.integration.spec.mjs`
Tasks: T13, T14, T15, T16.

**C6** - WHEN a empresa publica um serviço agendável THEN the system SHALL vincular sua duração e profissionais a recursos de agenda da própria empresa. (AGENDA-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^AGENDA-01$" ./tests/service-availability.integration.spec.ts`
Tasks: T4, T18, T20, T21, T76.

**C7** - WHEN o comprador abre um serviço THEN the system SHALL apresentar datas com disponibilidade atual para o serviço e profissional selecionados. (AGENDA-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^AGENDA-02$" ./tests/service-availability.integration.spec.ts`
Tasks: T23, T24, T43, T44, T45.

**C8** - WHEN o comprador escolhe uma data THEN the system SHALL mostrar somente os slots disponíveis dessa data, informando início, duração e fuso do atendimento. (AGENDA-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^AGENDA-03$" ./tests/service-availability.integration.spec.ts`
Tasks: T23, T24, T43, T44, T45.

**C9** - WHEN o comprador seleciona um horário THEN the system SHALL revalidar o slot e mostrar serviço, profissional, data, hora e valor antes da confirmação. (AGENDA-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^AGENDA-04$" ./tests/service-availability.integration.spec.ts`
Tasks: T28, T40, T42, T43, T45, T46.

**C10** - IF dois serviços do mesmo profissional disputam intervalos sobrepostos THEN the system SHALL permitir no máximo um agendamento confirmado nesse intervalo. (AGENDA-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^AGENDA-05$" ./tests/service-availability.integration.spec.ts`
Tasks: T23, T26, T34.

**C11** - IF a agenda está vazia, desatualizada ou indisponível THEN the system SHALL informar o estado correspondente sem criar horário ou declarar indisponibilidade total a partir de uma falha de leitura. (AGENDA-06, AC 6)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^AGENDA-06$" ./tests/service-availability.integration.spec.ts`
Tasks: T23, T24, T44.

**C12** - WHEN texto ou áudio descreve uma data ou profissional ambíguo THEN the system SHALL pedir a escolha explícita entre as opções atuais antes de reservar ou cobrar. (AGENDA-07, AC 7)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^AGENDA-07$" ./tests/service-channel-journey.integration.spec.ts`
Tasks: T42, T46, T93.

**C13** - WHERE bloqueio temporário está habilitado the system SHALL reservar provisoriamente o intervalo pelo tempo configurado, exibindo seu vencimento pelo relógio do servidor. (BOOK-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-01$" ./tests/service-booking.integration.spec.ts`
Tasks: T27.

**C14** - WHEN uma reserva provisória vence ou é abandonada THEN the system SHALL liberar somente o bloqueio provisório correspondente, sem liberar um agendamento já confirmado. (BOOK-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-02$" ./tests/service-booking.integration.spec.ts`
Tasks: T27.

**C15** - WHERE bloqueio temporário está desabilitado the system SHALL revalidar a capacidade no ato da confirmação, sem garantir a vaga durante a seleção. (BOOK-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-03$" ./tests/service-booking.integration.spec.ts`
Tasks: T26, T27, T28, T29, T40.

**C16** - WHERE pagamento é `at_attendance` the system SHALL confirmar o agendamento atomicamente com a ocupação do horário e registrar pagamento pendente, sem criar cobrança antecipada. (BOOK-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-04$" ./tests/service-booking.integration.spec.ts`
Tasks: T30, T40, T46.

**C17** - WHERE pagamento é `online` the system SHALL confirmar o agendamento somente após a confirmação financeira do provedor e a aquisição válida da vaga. (BOOK-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-05$" ./tests/service-booking.integration.spec.ts`
Tasks: T29, T35, T40.

**C18** - IF pagamento é aprovado após a vaga se tornar indisponível THEN the system SHALL manter o pagamento real registrado e sinalizar regularização para a empresa, sem confirmar vaga inexistente nem cobrar novamente. (BOOK-06, AC 6)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-06$" ./tests/service-booking.integration.spec.ts`
Tasks: T36.

**C19** - WHEN a empresa registra recebimento no atendimento THEN the system SHALL guardar valor, forma, operador e momento da quitação, sem apresentar esse registro como confirmação de um provedor externo. (BOOK-07, AC 7)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-07$" ./tests/service-booking.integration.spec.ts`
Tasks: T4, T37, T41, T80.

**C20** - IF mensagem, confirmação ou webhook é repetido THEN the system SHALL manter um único agendamento e uma única aplicação do mesmo evento financeiro. (BOOK-08, AC 8)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-08$" ./tests/service-booking.integration.spec.ts`
Tasks: T26, T30, T31, T32, T33, T35, T36, T37, T38, T84.

**C21** - WHEN o comprador solicita cancelar ou remarcar THEN the system SHALL encaminhar à central humana com o vínculo do agendamento e a política publicada da empresa. (BOOK-09, AC 9)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-09$" ./tests/service-booking.integration.spec.ts`
Tasks: T33, T34, T41, T49, T80.

**C22** - WHEN uma reserva de serviço é concluída THEN the system SHALL emitir confirmação com serviço, profissional, data, hora, fuso e situação financeira, sem tratá-la como produto enviado ou baixar estoque físico. (BOOK-10, AC 10)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^BOOK-10$" ./tests/service-booking.integration.spec.ts`
Tasks: T35, T38, T39.

**C23** - WHEN o comprador abre o Menu principal THEN the system SHALL apresentar a opção "Falar com atendente" sem ultrapassar o limite de opções de cada controle nativo. (HUM-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-01$" ./tests/whatsapp-human-handoff.integration.spec.ts`
Tasks: T57.

**C24** - WHEN o comprador pede atendente por botão, texto ou voz, inclusive durante o checkout, THEN the system SHALL abrir ou reutilizar um atendimento vinculado à empresa e conversa autenticadas antes de confirmar o encaminhamento. (HUM-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-02$" ./tests/whatsapp-human-handoff.integration.spec.ts`
Tasks: T49, T50, T57.

**C25** - WHILE o atendimento está aguardando ou sob atendimento humano the system SHALL pausar as respostas automáticas da IA sem perder carrinho, agendamento ou pagamento. (HUM-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-03$" ./tests/whatsapp-human-handoff.integration.spec.ts`
Tasks: T4, T48, T49, T50, T51.

**C26** - WHEN operador autorizado acessa a central do módulo WhatsApp THEN the system SHALL permitir consultar a fila, assumir uma conversa, responder e encerrar somente atendimentos de sua empresa. (HUM-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-04$" ./tests/whatsapp-human-handoff.integration.spec.ts`
Tasks: T52, T53, T58, T59, T60, T61, T62.

**C27** - WHEN operador envia resposta THEN the system SHALL persistir a mensagem e seu estado de entrega na conversa original, sem considerar aceite do provedor como leitura pelo comprador. (HUM-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-05$" ./tests/whatsapp-human-handoff.integration.spec.ts`
Tasks: T53, T54, T55, T60, T61.

**C28** - WHEN operador encerra o atendimento THEN the system SHALL restaurar o modo IA e informar a devolução uma única vez, mesmo com eventos repetidos. (HUM-06, AC 6)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-06$" ./tests/whatsapp-human-handoff.integration.spec.ts`
Tasks: T56, T61.

**C29** - IF a fila, a entrega ou a equipe está indisponível THEN the system SHALL informar o estado real, sem prometer atendimento imediato ou resposta já enviada. (HUM-07, AC 7)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-07$" ./tests/whatsapp-human-handoff.integration.spec.ts`
Tasks: T54, T55, T58.

**C30** - WHEN o operador abre o módulo WhatsApp THEN the system SHALL oferecer a aba "Conversas" para operar o atendimento humano existente sem exigir uma central separada para o RAG. (HUM-08, AC 8)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-08$" ./tests/whatsapp-human-handoff.integration.spec.ts`
Tasks: T58, T59, T60, T62, T82.

**C31** - WHEN cadastro público da empresa, profissional, serviço, horário de funcionamento, FAQ ou política é publicado ou alterado THEN the system SHALL registrar atualização idempotente da projeção de conhecimento com tenant, origem e versão. (RAG-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-01$" ./tests/business-rag.integration.spec.ts`
Tasks: T4, T21, T63, T64, T65, T66.

**C32** - WHEN uma fonte é retirada ou despublicada THEN the system SHALL impedir seu uso como evidência ativa e retirar sua projeção, sem recuperar texto antigo como resposta atual. (RAG-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-02$" ./tests/business-rag.integration.spec.ts`
Tasks: T65, T67, T68.

**C33** - IF embeddings ou grafo estão indisponíveis THEN the system SHALL conservar o cadastro canônico e registrar a indexação pendente para nova tentativa, sem desfazer o cadastro nem inventar uma resposta. (RAG-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-03$" ./tests/business-rag.integration.spec.ts`
Tasks: T64, T66, T67.

**C34** - WHEN o assistente compõe uma resposta factual THEN the system SHALL usar fontes públicas da empresa autenticada e conservar as referências de origem e versão para auditoria. (RAG-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-04$" ./tests/business-rag.integration.spec.ts`
Tasks: T66, T68, T69.

**C35** - WHEN a pergunta combina área de atuação, serviço, profissional, preço e disponibilidade THEN the system SHALL combinar recuperação semântica com leituras canônicas de serviço, preço e agenda, sem extrair confirmação financeira ou vaga de um embedding. (RAG-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-05$" ./tests/business-rag.integration.spec.ts`
Tasks: T70, T71.

**C36** - IF não há fonte suficiente ou há conflito entre fontes THEN the system SHALL explicitar a lacuna e pedir esclarecimento ou encaminhar ao humano, sem atribuir à empresa um serviço, credencial ou política não publicada. (RAG-06, AC 6)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-06$" ./tests/business-rag.integration.spec.ts`
Tasks: T68, T71.

**C37** - The system SHALL excluir credenciais, prontuários, dados pessoais privados e conversas de clientes do corpus público e das respostas a outros compradores. (RAG-07, AC 7)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-07$" ./tests/business-rag.integration.spec.ts`
Tasks: T6, T63, T68, T69.

**C38** - WHILE a recuperação usa Neo4j Community the system SHALL executar somente consultas parametrizadas e aprovadas no gateway privado, sem executar Cypher livre fornecido pelo modelo ou comprador. (RAG-08, AC 8)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-08$" ./tests/business-rag.integration.spec.ts`
Tasks: T2, T70.

**C39** - WHEN um cenário de segmento regulado exige diagnóstico, prescrição ou decisão profissional individual THEN the system SHALL encaminhar ao profissional e limitar a resposta informativa ao conteúdo publicado aplicável. (RAG-09, AC 9)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-09$" ./tests/business-rag.integration.spec.ts`
Tasks: T71, T72.

**C40** - WHEN uma nova empresa de um ramo de serviços é cadastrada THEN the system SHALL aplicar o mesmo fluxo de ingestão e consulta sem FAQ, nomes ou especialidades médicos hardcoded. (RAG-10, AC 10)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-10$" ./tests/business-rag.integration.spec.ts`
Tasks: T63, T67, T71, T72.

**C41** - WHEN a empresa mantém apresentação, políticas, profissionais e horários em seus cadastros normais THEN the system SHALL alimentar o contexto desses registros sem exigir duplicação de conteúdo em uma central de RAG. (RAG-11, AC 11)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-11$" ./tests/business-rag.integration.spec.ts`
Tasks: T13, T14, T15, T63, T64, T65.

**C42** - WHEN uma empresa de serviços abre a navegação administrativa THEN the system SHALL oferecer a página "Atendimento", negando sua gestão a empresas de produtos também nas rotas da API. (ATEND-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-01$" ./tests/service-administration.integration.spec.ts`
Tasks: T41, T47, T73, T74, T75, T82, T83.

**C43** - WHEN operador autorizado mantém profissionais THEN the system SHALL permitir cadastrar, editar e desativar profissionais da própria empresa, preservando o histórico de agendamentos. (ATEND-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-02$" ./tests/service-administration.integration.spec.ts`
Tasks: T18, T19, T76.

**C44** - WHEN operador mantém categorias de atendimento THEN the system SHALL vincular categorias e serviços publicados sem transformar categoria em recurso de capacidade. (ATEND-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-03$" ./tests/service-administration.integration.spec.ts`
Tasks: T20, T77.

**C45** - WHEN a empresa publica disponibilidade de um profissional THEN the system SHALL considerar grade, duração do serviço, fuso e indisponibilidades na mesma leitura usada pelo WhatsApp, storefront e agendamento manual. (ATEND-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-04$" ./tests/service-administration.integration.spec.ts`
Tasks: T21, T23, T24, T25, T78.

**C46** - WHEN operador cria um horário avulso THEN the system SHALL validá-lo no fuso do profissional e impedir sobreposição com intervalos confirmados ou bloqueados. (ATEND-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-05$" ./tests/service-administration.integration.spec.ts`
Tasks: T22, T25, T78.

**C47** - WHEN operador cria um agendamento manual THEN the system SHALL aplicar a mesma capacidade, política financeira, identidade de cliente e idempotência usadas no fluxo de autoatendimento. (ATEND-06, AC 6)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-06$" ./tests/service-administration.integration.spec.ts`
Tasks: T31, T41, T74, T79.

**C48** - WHEN operador inicia, conclui ou registra ausência de um atendimento THEN the system SHALL persistir a transição operacional explícita sem inferir quitação financeira ou comparecimento pelo pagamento. (ATEND-07, AC 7)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-07$" ./tests/service-administration.integration.spec.ts`
Tasks: T32, T41, T74, T80.

**C49** - IF um operador tenta gerir profissional, categoria, grade ou agendamento de outra empresa THEN the system SHALL recusar a operação sem expor o registro solicitado. (ATEND-08, AC 8)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-08$" ./tests/service-administration.integration.spec.ts`
Tasks: T6, T11, T19, T25, T41, T47, T52, T59, T73, T75, T83, T87.

**C50** - WHEN operador bloqueia uma indisponibilidade THEN the system SHALL retirar o intervalo da oferta pública sem cancelar ou sobrepor silenciosamente agendamentos confirmados. (ATEND-09, AC 9)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-09$" ./tests/service-administration.integration.spec.ts`
Tasks: T22, T25, T78.

**C51** - WHEN operador agenda fora da grade regular THEN the system SHALL permitir a criação explícita de horário avulso na mesma operação, sem sobreposição e sob a política de pagamento vigente. (ATEND-10, AC 10)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^ATEND-10$" ./tests/service-administration.integration.spec.ts`
Tasks: T25, T31, T79.

**C52** - WHEN a empresa abre o dashboard THEN the system SHALL selecionar os indicadores da modalidade comercial persistida, mantendo os indicadores atuais para produtos. (KPI-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^KPI-01$" ./tests/service-metrics.integration.spec.ts`
Tasks: T82, T87, T88, T89, T90, T91.

**C53** - WHEN o painel contabiliza agendamentos do período THEN the system SHALL contar cada agendamento uma vez por estado operacional, usando o início agendado no fuso da empresa como coorte declarada. (KPI-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^KPI-02$" ./tests/service-metrics.integration.spec.ts`
Tasks: T85, T86, T89.

**C54** - WHEN o painel calcula ocupação THEN the system SHALL dividir minutos ocupados confirmados pelos minutos ofertados únicos por profissional no período, sem duplicar capacidade de serviços que compartilham esse profissional. (KPI-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^KPI-03$" ./tests/service-metrics.integration.spec.ts`
Tasks: T86, T89.

**C55** - WHEN o painel mostra valores de serviços THEN the system SHALL separar valor agendado, valor a receber e recebimento confirmado, usando evidências financeiras próprias de pagamento online ou registro local. (KPI-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^KPI-04$" ./tests/service-metrics.integration.spec.ts`
Tasks: T37, T85, T86, T89.

**C56** - WHEN operador filtra período, profissional ou categoria THEN the system SHALL aplicar os mesmos limites de tenant e período aos totais e detalhamentos retornados pela API. (KPI-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^KPI-05$" ./tests/service-metrics.integration.spec.ts`
Tasks: T85, T87, T88, T91.

**C57** - WHEN o painel mostra concluídos ou ausências THEN the system SHALL usar somente os estados operacionais registrados, sem inferir conclusão por pagamento ou ausência pelo decurso do horário. (KPI-06, AC 6)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^KPI-06$" ./tests/service-metrics.integration.spec.ts`
Tasks: T32, T85, T86, T89.

**C58** - IF uma leitura de métricas falha ou o denominador de uma taxa não existe THEN the system SHALL distinguir dados indisponíveis de zero e mostrar taxa não calculável sem fabricar percentuais. (KPI-07, AC 7)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^KPI-07$" ./tests/service-metrics.integration.spec.ts`
Tasks: T86, T87, T88, T89, T91.

**C59** - WHEN uma empresa usa WhatsApp ou storefront THEN the system SHALL selecionar a jornada pela modalidade canônica da empresa, sem aplicar políticas de agenda, pagamento no atendimento ou controles de profissional à compra de produtos. (REG-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^REG-01$" ./tests/service-product-coexistence.integration.spec.ts`
Tasks: T7, T9, T17, T28, T43, T45, T46, T47, T62, T82, T83, T90, T91, T93.

**C60** - WHEN a nova jornada de serviços é validada THEN the system SHALL comprovar nos dois canais a preservação de catálogo, busca e comparação, detalhes e avaliações, carrinho e cross-sell, identidade e endereço, frete e checkout, incluindo Pix, cartão e troca do método de pagamento de produtos. (REG-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^REG-02$" ./tests/service-product-coexistence.integration.spec.ts`
Tasks: T3, T17, T28, T29, T46, T57, T90, T93.

**C61** - WHEN pagamentos de produtos e agendamentos de serviços são processados na mesma revisão THEN the system SHALL preservar totais, recibos, transições de pedido, eventos e baixa de estoque físico de produtos, impedindo que eventos de serviço produzam envio ou saída de estoque físico. (REG-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^REG-03$" ./tests/product-stock-regression.integration.spec.ts`
Tasks: T2, T29, T35, T38, T92, T93.

**C62** - WHEN a feature é migrada, habilitada ou desabilitada THEN the system SHALL preservar empresas e registros existentes, manter serviços novos desabilitados para empresas de produtos e conservar o processamento dos agendamentos e pagamentos já iniciados. (REG-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^REG-04$" ./tests/service-migration.integration.spec.mjs`
Tasks: T1, T3, T5, T7, T8, T12, T17, T36, T47, T84, T94.

**C63** - WHEN a feature é validada THEN the system SHALL produzir uma matriz que relacione cada critério ao comando e à evidência de seu resultado no mesmo HEAD. (QA-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^QA-01$" ./tests/service-acceptance-report.spec.mjs`
Tasks: T1, T95.

**C64** - WHEN o fluxo visual é demonstrado THEN the system SHALL fornecer prints das telas e conversas correspondentes, marcando separadamente prévias locais e capturas reais. (QA-02, AC 2)
Proof: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-product-coexistence.spec.ts --grep "QA-02$"`
Tasks: T3, T16, T39, T44, T61, T75, T89, T93, T95.

**C65** - WHEN os testes financeiros e de concorrência são executados THEN the system SHALL comprovar unicidade de reserva, estado financeiro verdadeiro e isolamento de tenant, sem depender apenas da mensagem da IA. (QA-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^QA-03$" ./tests/product-stock-regression.integration.spec.ts`
Tasks: T2, T5, T26, T92, T95.

**C66** - WHEN o RAG é avaliado THEN the system SHALL medir respostas apoiadas por fonte, tratamento de ausência/contradição e uso correto de ferramentas em três ramos, exigindo aprovação de todos os casos críticos antes da ativação. (QA-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^QA-04$" ./tests/business-rag-evaluation.spec.mjs`
Tasks: T72, T94, T95.

**C67** - IF um ID de profissional, empresa ou horário pertence a outro tenant THEN the system SHALL rejeitar a ação sem expor dados desse tenant. (EDGE-01, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^EDGE-01$" ./tests/service-boundary.integration.spec.ts`
Tasks: T6, T18, T22, T40.

**C68** - IF uma política muda durante uma reserva THEN the system SHALL exigir uma nova confirmação da condição comercial atual antes de criar cobrança ou reserva final. (EDGE-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^EDGE-02$" ./tests/service-boundary.integration.spec.ts`
Tasks: T11, T28, T30, T40, T81.

**C69** - IF a mídia de confirmação falha THEN the system SHALL preservar a entrega do texto e o estado canônico já confirmado. (EDGE-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^EDGE-03$" ./tests/service-boundary.integration.spec.ts`
Tasks: T38, T39.

**C70** - IF um operador assume enquanto uma resposta da IA está em processamento THEN the system SHALL impedir o envio dessa resposta automática após a mudança de modo. (EDGE-04, AC 4)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^EDGE-04$" ./tests/service-boundary.integration.spec.ts`
Tasks: T48, T51, T56.

**C71** - IF a fonte contém instruções para executar ferramentas ou revelar dados THEN the system SHALL tratá-la somente como conteúdo recuperado, sem conceder autoridade operacional. (EDGE-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^EDGE-05$" ./tests/service-boundary.integration.spec.ts`
Tasks: T70, T71.

**C72** - WHILE a modalidade canônica é `services` the system SHALL permitir adicionar pelo botão "+", editar, remover, salvar e reabrir uma lista de nomes de serviços em Dados da empresa e usar somente os nomes públicos salvos como contexto do RAG, ocultando e recusando sua edição para empresas de produtos e retirando esse contexto quando a modalidade mudar para produtos. (ONB-06, AC 1)
Proof: `pnpm --dir apps/api exec node ./tests/service-company-services-proof.mjs`
Tasks: T96, T97, T63, T72.

## Handoff

**Settled mid-build:** 2026-11-14 - user: "Aprovar o plano e iniciar implementação local". Aprovação recebida para os 71 critérios, 95 tarefas/13 fases, refinamentos posteriores e subagentes, preservando produtos nos dois canais. Publicação permanece etapa separada. Início por T1, sem alterar o workspace concorrente.
**Settled execution change:** 2026-11-14 - user: "por que esta demorando tanto? spawnar subagents". Preparos paralelos autorizados em checkouts isolados, preservando gates reais, dependências técnicas, commits atômicos e escopo local.
**Root parallel front:** T63-T71 public business RAG in N. T63 uses completed T13/T18; T65 also waits T25 to cover all actual new writers. Human handoff Phase7 may start after T25 rather than the unrelated buyer UI T47. Final coexistence requires every front; no criterion/gate is removed.
**Dispatched:** Revisores somente leitura service_agenda_plan, service_dashboard_plan, business_rag_plan e product_baseline_triage retornaram. service_batch_01 retornou Phase 1 T1–T9 completa e limpa em 15e6957d019e8d7c9001da7bc11b7c54fc269f24. Phase 2 T10–T16 está com service_company_ui em C:/tmp/zyon-service-company-ui-20261114 e Phase 3 T17–T25 com service_professional_agenda em C:/tmp/zyon-service-professional-agenda-20261114; ambos incorporaram T9. Novo despacho de service_batch_01: Phase 4 T26–T32 em C:/tmp/zyon-service-booking-admission-20261114, usando preparo T26 do root, com gates/commits dependentes somente após integrar ambas as fases verdes. Root mantém integração em C:/tmp/zyon-service-business-20261114. Nenhum Verifier/screens final despachado.
**Walked:** Nenhuma jornada da feature nova foi executada. Prints anteriores de produto não comprovam serviços. Capturas de proposta, se anexadas, terão rótulo de prévia local. Ao executar, registrar rota/gestos/dados/resultado e ambiente para cada Independent Test.

## Phase Execution Map

Phase 1 → {Phase 2 || Phase 3}; {T13, T18} → Phase 9 (T65 also waits T25); {Phase 2, Phase 3} → Phase 4 → Phase 5 → Phase 6; Phase 3 → Phase 7 → Phase 8; Phase 9 → Phase 10 → Phase 11 → Phase 12; {Phase 6, Phase 8, Phase 12} → Phase 13

95 tarefas em 13 fases; preparação paralela das fases 2/3 conforme solicitação posterior do usuário. Um commit por tarefa com testes co-localizados e gates prévios. Integrar/revalidar a base e preservar todos os critérios antes da fase seguinte dependente. Não juntar tarefas em um commit para economizar tempo. Check final de granulação e cruzamento dos diagramas via validate_tasks.py. Aprovações literais permanecem registradas.

Após última tarefa: Build, check_proofs no mesmo HEAD, verificador independente com três mutações e revisão das capturas/jornadas; corrigir achados com commits e rodada final de provas. Só declarar concluído após validate_verification. Ativação remota não integra este plano local e precisa prova do release servido.
