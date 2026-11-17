# Service Businesses, WhatsApp Conversations and Generic Business RAG Tasks

## Execution Protocol

Implementar com a skill **tlc-spec-driven**, seguindo Execute e Critical Rules. Se a skill não estiver disponível, parar. Um gate e um commit por tarefa; nenhuma tarefa aprovada por inferência.

**Design**: `.specs/features/whatsapp-service-booking-business-rag/design.md`
**Status**: In Progress
**Approved**: 2026-11-14 - user: "Aprovar o plano e iniciar implementação local"
**Date**: 2026-11-14
**Mutations**: 3

**Observed runtime prerequisite repair:** repeated105and54 setup failures occurred before business cases when the fresh Windows Get-NetTCPConnection subprocess exceeded its existing10s bound. T108 replaces only that collection implementation with fixed numeric native netstat output and keeps PID/exact established loopback tuple/live socket identity checks and deadline unchanged. Current81criteria/108tasks, no new business criterion. Harness MJS is outside productive compiler inputs, explicitly documented in service-test-artifacts.mjs43; prove it with portable parsing/error contracts, real Windows TCP capture, unchanged ownership/teardown contracts, then rerun the affected original consumers. No PowerShell deadline increase, ownership bypass, OS/global changes or new provider traffic.

**Discovered catalog repair (2026-11-16):** T105 actual browser captures exposed an existing unguarded Growth-only advanced-rules GET on the Starter fixture. Add CAT-05/C81/T107, current81criteria/107tasks. This enforces the existing hasFeature/API policy, without changing entitlement, price, business mode or backend permission. Keep105's four-control deliverable separate. Whole Phase16 ordering becomes105→107→106, each real gate and atomic commit. Exact network observation and original diagnostic captures remain evidence, never masked by raising the plan or deleting the toast.

**User-directed catalog refinement (2026-11-16):** user: "está sim mas trar checkbox por toggle e poder vincular um profissional a um serviço se ja nao tiver". CAT-03/CAT-04 and T105/T106 extend the local plan to80criteria/106tasks. The business-mode UI is accepted with these refinements; no final release approval. Toggle role/gesture expectations follow this explicit control change while all behavioral assertions remain. Existing professional productIds/expectedVersion is the sole association writer.

**Discovered implementation repair:** T104 retains the existing RAG-01/02/03 contract while reducing public projection planning/round-trip overhead after an actual reproduced client deadline failure. No new product decision, assertion change, warm-up or timeout increase. Current78criteria/104tasks; completed task counts remain unchanged until real gates pass. See task-104-plan.md.

**User-directed support/appointments addition (2026-11-16):** private fallback WhatsApp alerts and a separate service-only appointments Kanban are explicitly requested. HUM-09/HUM-10 and ATEND-11/ATEND-12 extend the current plan to78 criteria/103 tasks (T99-T103). User selected "WhatsApp, com link para a conversa (recomendado)". T57 additionally proves natural-language/model-tool handoff under the existing HUM-02 criterion. Original approvals remain unchanged; all work remains local and preserves product journeys. See support-appointments-addendum-20261116.md for the audited boundaries.

**User-directed catalog addition (2026-11-16):** user explicitly requested that service registration appear only for service companies and be removed from product-mode creation choices. CAT-01/CAT-02 and independently deliverable T98 extend the current local plan to74criteria/98tasks. This follows the same canonical business mode and T17 guard; no new domain state, product purchase behavior, remote action or production activation. The remaining two new requests are inventory/amendment work, with the channel confirmed as WhatsApp and concrete additions recorded in T99-T103.
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
T59 → T56 → T57 → T58 → T60 → T61 → T62
T59 → T60
T53 → T59
T9 → T59
```

### Phase 9: Public knowledge lifecycle and controlled retrieval

```
T63 → T64 → T65 → T66 → T67 → T68 → T69 → T70 → T71
```

### Phase 10: Generic evaluation and service administration

```
T73 → T74 → T75 → T76 → T77
T71 → T72
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
T92 → T93 → T94
```

### Phase boundaries

```
T9 → T10
T9 → T17
T25 → T26
T32 → T33
T39 → T40
T9 → T48
T55 → T56
T13 → T63
T18 → T63
T25 → T65
T71 → T72
T25 → T73
T59 → T73
T72 → T95
T41 → T79
T77 → T78
T84 → T85
T91 → T92
T16 → T96
T96 → T97
T97 → T95
T17 → T98
T98 → T95
T53 → T99
T99 → T100
T55 → T100
T62 → T100
T99 → T101
T100 → T101
T62 → T101
T41 → T102
T74 → T102
T102 → T103
T80 → T103
T83 → T103
T101 → T95
T103 → T95
T66 → T104
T104 → T69
T2 → T108
T108 → T70
T108 → T54
T108 → T105
T98 → T105
T105 → T106
T18 → T106
T106 → T95
T98 → T107
T107 → T105
T107 → T106
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

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] store-settings-page.spec.tsx e browser QA-02: foco, limite, salvar/reabrir, feedback de erro.
- [x] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: store-settings-page.spec.tsx e browser QA-02: foco, limite, salvar/reabrir, feedback de erro.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/store-settings/store-settings-page.spec.tsx -t "^T16$"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-company-about.spec.ts --grep "T16$"` Teste raiz T16 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
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

**Status**: Complete - unit7/7, owned DB/middleware4/4 and actual HTTP/AppModule4/4; checked build0/2500, zero failed/skipped and full cleanup. See task-20-evidence.json.

**What**: Resolver vínculo e duração da oferta canônica service; categoria reutiliza ProductCategory e nunca produz capacidade duplicada ou preço novo.
**Where**: `apps/api/src/modules/catalog/domain/services/professional-service-link.ts`
**Depends on**: T19
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-01, ATEND-03

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit professional-service-link.spec.ts + DB: profissional/oferta/categoria estrangeiros, despublicados e categorias compartilhadas.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit professional-service-link.spec.ts; service-professional-links.integration.spec.mjs and service-eligibility-http.integration.spec.mjs: foreign/unpublished/shared category, canonical duration/price, privacy canary, pagination and actual staff/anonymous guards.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T20$" ./src/modules/catalog/domain/services/professional-service-link.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T20 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t20 validate professional and service associations`

### T21: Save recurring professional availability

**Status**: Complete - unit5/5, owned DB/middleware5/5, zero failed/skipped; checked build0/2502 and full owned cleanup. See task-21-evidence.json.

**What**: Um comando salva grade/fuso/vigência versionados com validação de intervalos/limites, autorização e evento público apropriado; não reescreve compromissos existentes.
**Where**: `apps/api/src/modules/catalog/application/save-professional-availability.use-case.ts`
**Depends on**: T20
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-04, AGENDA-01, RAG-01

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + service-availability.integration.spec.ts: DST/fuso, intervalo inválido, versão, histórico, concorrência e eventos.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + service-availability.integration.spec.ts: DST/fuso, intervalo inválido, versão, histórico, concorrência e eventos.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T21$" ./src/modules/catalog/application/save-professional-availability.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T21 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t21 save recurring professional availability`

### T22: Save one-off times and unavailability blocks

**Status**: Complete - unit6/6, checked API build0/2503 and actual owned DB/tenant middleware8/8; no skips, owned cleanup0. Evidence: task-22-evidence.json.

**What**: Um comando tipado one_off/block usa lock de profissional; avulso não sobrepõe bloqueio/confirmado; bloqueio não cancela compromisso e remove oferta pública.
**Where**: `apps/api/src/modules/catalog/application/save-availability-exception.use-case.ts`
**Depends on**: T21
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-05, ATEND-09, EDGE-01

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + HTTP/DB service-availability.integration.spec.ts: corrida com confirmação, intervalos adjacentes, outro tenant e rollback.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit + HTTP/DB service-availability.integration.spec.ts: corrida com confirmação, intervalos adjacentes, outro tenant e rollback.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T22$" ./src/modules/catalog/application/save-availability-exception.use-case.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T22 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t22 save one-off times and unavailability blocks`

### T23: Resolve canonical professional availability

**Status**: Complete - unit15/15, checked API build0/2505 and actual owned DB/tenant middleware7/7; max8928 slots passed the ordinary transaction deadline, no skips and owned cleanup0. Evidence: task-23-evidence.json.

**What**: Unir grade/avulsos e subtrair bloqueios/ocupações por profissional; datas primeiro, slots da data, duração/fuso; distinguir indisponível/vazio/stale; janela e volume limitados.
**Where**: `apps/api/src/modules/catalog/domain/services/professional-availability.ts`
**Depends on**: T22
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-02, AGENDA-03, AGENDA-05, AGENDA-06, ATEND-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] professional-availability.spec.ts + service-availability.integration.spec.ts: dois serviços/recurso, profissionais paralelos, limites/fuso e falha.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: professional-availability.spec.ts + service-availability.integration.spec.ts: dois serviços/recurso, profissionais paralelos, limites/fuso e falha.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T23$" ./src/modules/catalog/domain/services/professional-availability.spec.ts` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T23 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t23 resolve canonical professional availability`

### T24: Expose date and slot reads

**Status**: Complete - unit3/3, checked API build0/2506 and real AppModule/HTTP/DB8/8; staff/admin(API plan), both route guards, errors/privacy, no skips and owned cleanup0. Evidence: task-24-evidence.json.

**What**: Controller apresenta queries datas e slots com contexto confiável e limite; política/version/clock; leituras de canais/manual chamam mesma função.
**Where**: `apps/api/src/modules/catalog/presentation/http/service-availability.controller.ts`
**Depends on**: T23
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-02, AGENDA-03, AGENDA-06, ATEND-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] HTTP real dates/slots: happy/empty/error/stale/products/foreign; query budget e paginação.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

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

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] HTTP real/DB: salvar/editar grade, avulso e bloqueio; happy/invalid/products/foreign/forbidden/stale/overlap e corrida com confirmação; erro faz rollback e as três leituras refletem a mudança.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

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

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] DB service-booking.integration.spec.ts: manual/compradores/webhook concorrentes, overlaps com início diferente, adjacência e rollback/outbox.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

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

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + Redis/DB service-booking.integration.spec.ts: tempo controlado, retry, proprietário alheio e quatro combinações.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit companions service-checkout-selection.spec.ts (7), professional-service-lease.spec.ts (6), admission regression (18); actual Redis/DB tests/service-holds.integration.spec.ts (11), plus canonical admission DB regression (17). Configured server expiry, retry, ownership/version refusal, persisted cart/buyer, fresh post-lock clock and all four policy combinations; no skipped cases.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./src/shared/bookings/service-checkout-selection.spec.ts ./src/shared/bookings/professional-service-lease.spec.ts ./src/shared/bookings/service-appointment-admission.service.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./tests/service-holds.integration.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./tests/service-booking.integration.spec.ts`. Execute all named roots without a name filter:31 unit and28 native total. One normal official checked API build and integral artifact admission; no standalone repeated typecheck. The original nonexistent single-wrapper path is replaced by its actual companions, preserving every case/assertion. Final criterion collectors below remain required.
**Commit**: `feat(service-business): t27 apply optional versioned holds`

### T28: Prepare service checkout without changing products

**What**: Ramo services usa seleção/policyVersion canônicas com hold opcional; campos de serviço opcionais não mudam fingerprint/carrinhos/pagamentos físicos existentes; produto não exige profissional.
**Where**: `apps/api/src/modules/checkout/application/use-cases/start-checkout.use-case.ts`
**Depends on**: T27
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: AGENDA-04, BOOK-03, EDGE-02, REG-01, REG-02

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + actual service-checkout.integration.spec.ts + existing product/WhatsApp regressions: same literal cart hashes, resume, shipping/totals/payment methods and trusted original authority preserved.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Fingerprint companion service-payment-cart-fingerprint.spec.ts (6) plus unchanged checkout/__tests__/start-checkout.use-case.spec.ts (8). Real AppModule/HTTP/DB service-checkout.integration.spec.ts (9): actual registered scheduled/unscheduled offers, canonical professional/policy/price, body-bypass/foreign/stale negatives, physical/digital/food preservation, exact merchant wait and approved history. Existing normal-checkout-payment.integration.mjs product baseline (48), plus all committed WhatsApp fence cases and one actual booking-writer coexistence case (26). Literal old cart hashes, quantities, resume, shipping/totals/payment methods and original authority are preserved.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./src/modules/checkout/domain/services/service-payment-cart-fingerprint.spec.ts ./src/modules/checkout/__tests__/start-checkout.use-case.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./tests/service-checkout.integration.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs ./tests/normal-checkout-payment.integration.mjs --local-disposable --prisma-loopback-exec` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-ai-dispatch-fence.integration.spec.mjs`. Execute all named roots without a name filter:14 unit and83 native total. One full official checked API build with integral artifact admission; no skipped cases or repeated standalone typecheck. Correct the nonexistent wrapper path to the actual unit companions while preserving every case/assertion. Final criterion collectors below remain required.
**Evidence**: task-28-evidence.json. Final14/14unit and83/83native (9HTTP,48product,26coexistence), zero failures/skips and natural owned cleanup0; official checked0/2538/input64339018/artifacte5fa3d58. First HTTP seed omissions and all environment refusals retained separately. Core expected27 was a counting error: all25 existing cases including root plus the new case execute26; no test removed or skipped.148 HTTP assertions and104 existing coexistence assertions preserved. Win32 publication normal path passed; rollback unexercised.

**Commit**: `feat(service-business): t28 prepare service checkout without changing products`

### T29: Prepare payment with or without a hold

**What**: Online service suporta hold on/off e resume; at_attendance não chama PSP; pagamento de produtos mantém guardas, troca de método e idempotência anteriores.
**Where**: `apps/api/src/modules/payment/application/create-payment-intent.use-case.ts`
**Depends on**: T28
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-03, BOOK-05, REG-02, REG-03

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + HTTP/DB: seleção/política stale, pending/approved/unknown, Pix↔cartão produtos, nenhum provider real nos testes locais.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: New component service-payment-policy.spec.ts plus the unchanged full create-payment-intent.use-case.spec.ts. Actual service-payment-http.integration.spec.ts (7) and service-payment-admission.integration.spec.ts (10) cover local refusal, online hold on/off, persisted ready/approved/uncertain state, canonical summary and missing-professional refusal, exact-PID first-send race, owned Redis missing/foreign/expired lease and scoped production embed/contact/origin/session/history. Existing product baseline48, original-authority cohort26 and T27 holds11 preserve financial method/idempotency behavior and generic local capacity checks. No real provider calls; controlled provider-port calls in the PG fixture are separately identified.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./src/shared/bookings/service-payment-policy.spec.ts ./src/modules/payment/application/create-payment-intent.use-case.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./tests/service-payment-http.integration.spec.ts ./tests/service-payment-admission.integration.spec.ts ./tests/service-holds.integration.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs ./tests/normal-checkout-payment.integration.mjs --local-disposable --prisma-loopback-exec` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-ai-dispatch-fence.integration.spec.mjs`. Execute all named roots, no skip-producing name filter. Expected102 native (7+10+11+48+26), with actual executed counts authoritative. One fresh official checked API build plus integral artifact admission; original criterion collectors below remain required.
**Evidence**: task-29-evidence.json. Final46unit/102native (7HTTP+10journal/Redis+11holds+48product+26coexistence),0fail/skip, natural owned cleanup0, normal official checked0/2541/sourcea9834688/artifact46ba988e and postapproval integral admission0. Explicit user-approved TTL candidate0473/patchbe49 only; all46 inherited journal/HTTP assertions and existing regressions preserved. Prior journal7pass/3fail and both build receipts retained; coherent discount/shipping discrepancy fixed in source. No live provider/charge or final feature acceptance.

**Commit**: `feat(service-business): t29 prepare payment with or without a hold`

### T30: Confirm a local-payment appointment

**What**: Comando de confirmação usa admissão e política, confirma vaga com saldo pendente sem PaymentIntent aprovado ou cobrança; resposta e outbox atômicos.
**Where**: `apps/api/src/modules/checkout/application/confirm-service-appointment.use-case.ts`
**Depends on**: T29
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: BOOK-04, BOOK-08, EDGE-02

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] service-booking.integration.spec.ts: política on/off, duplicata, corrida, mudança de política, nenhum pagamento/provider/evento de estoque físico.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unfiltered component scope/start-checkout/payment-policy24 (historical prealignment, not repeated). Actual own SQL confirmation10, AppModule embed confirmation7, confirmed resume2, original admission17, checkout9, holds11, payment HTTP7, journal10 and whole WhatsApp coexistence27 =100 TAP; normal product48 and widget product176 =324 current native checks. All pass, zero skipped/failed/cancelled. Confirmação local preserva política on/off, duplicata/corrida, capability/tenant/identidade, relógio pós-lock, rollback, replay imutável e ausência de cobrança/estoque físico.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./src/modules/embed/domain/embed-appointment-confirmation-scope.spec.ts ./src/modules/checkout/__tests__/start-checkout.use-case.spec.ts ./src/shared/bookings/service-payment-policy.spec.ts` + actual service-booking HTTP/DB companions named in Tests, including original admission/product preservation. The three actual component files replace the nonexistent single-wrapper path; expected24 component cases execute unfiltered, zero skipped. Actual owned SQL/Redis/HTTP confirmation, policy/race/idempotency/outbox/no-charge proofs and a fresh official checked API remain mandatory before Full completion. Record concrete native companions/counts before their execution; final criterion checks remain unchanged.
**Preparation checkpoint**: P baseline-only merge9c91773c03deaad2a70375d8f683e1bef1f9b59b has the exact committedRoot99e6a53bad2 tree before restoring ownT30. Prior alignment0b345b70 and24/24 component receipts remain retained, no repetition/transfer to alignedFull by inference. Current20WIP/tasks/baseblobs/patch and125oldpacket backups plus explicit21pathstash4fdf1c5b are retained in `.cache/t30-align-root99-20261116`; ownimplementation/test/fixturead6/sharedtypes bytes remain exact and Root99DI/schema/currentmetadata preserved. Actual prepared native files/commands remain pinned in `.cache/t30-full-preparation-20261116` and `.cache/phase4-root99-handover-preparation-20261116`: confirmation10, embedHTTP7, confirmedResume2, originalAdmission17, checkout9, holds11, paymentHTTP7, journal10 and wholeWhatsApp27 =100TAP; normal-product48 and widget-product176 are separately counted checks. Ownfresh checked build, natural owned cleanup and current-input/artifact admission remain required; no native/build/probe runs during alignment. Header `test:ai-security` script is absent and stock runner belongs to futureT92; these gaps remain explicit, no skip credited. This paragraph records the pre-execution boundary; the actual Full receipt below supersedes its pending state.
**Evidence**: task-30-evidence.json. Own ordinary checked API2553/capture+build+record0, inputc88a769d/artifact023fee86; session38697. Current Full session56799 returned naturally0 across all11 serial cohorts:100TAP+48normal+176widget=324,0fail/skip/cancel. Owned SQL/HTTP/Redis cleanup assertions passed; both product workers report cleanupErrors0/database removed/bridge closed/providerCalls0. No unchanged component/native cohort repetition or rebuild after alignment. Before completion metadata, all21 frozen source paths and325 earlier cache files remained byte-equal. T31/T32/T71 stay cache-only, header/final-verifier gaps stay explicit; runtime returned to Root.

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
**Depends on**: T9
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-03, EDGE-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] DB handoff integration: próximo inbound, restart, duplicata, binding estrangeiro e corrida com sessão renovada.
- [x] Gate Full passa: unit13/13 and native8/8, zero skipped, checked API build0/2507 sources, AppModule health/ready HTTP and owned cleanup. Existing assertions preserved; see task-48-evidence.json. Commit local próprio; sem push/deploy.

**Tests**: Unit T48 and existing session-anchor regressions; `apps/api/tests/whatsapp-handoff-binding.integration.spec.mjs` uses owned SQL/middleware and the canonical AppModule, including health/ready HTTP, restart, duplicate, foreign binding, rollback and controlled session-renewal race.
**Gate**: Full: protected Node runner for `./src/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.spec.ts` and `./src/modules/whatsapp-channel/application/use-cases/route-to-session.session-anchor.spec.ts`; checked API build and artifact; `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-handoff-binding.integration.spec.mjs` from apps/api. No skipped cases. T48 introduces persistence, not a new HTTP command: actual signed webhook intake/routing negatives remain mandatory in T49/T50; no artificial production route is added. All final criterion checks remain mandatory.
**Commit**: `feat(service-business): t48 persist the channel handoff binding`

### T49: Create or reuse a WhatsApp support handoff

**What**: Ticket e binding duráveis antes de confirmar encaminhamento; origem WhatsApp confiável em vez de widget hardcoded; booking/policy link opcionais, cart preservado.
**Where**: `apps/api/src/modules/support/application/support-handoff.service.ts`
**Depends on**: T48
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-02, HUM-03, BOOK-09

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Signed HTTP/DB companion proves button/text/authorized synthetic voice during checkout, replay, real outbox rollback, exact tenant/thread, and optional appointment ownership without financial/booking commands.
- [x] Gate Full passes: unit125/125; final nativeT49=12/12 and defaultT2=7/7; T48regression8/8 on the same artifact; zero skipped. Checked build0/2510, AppModule/auth/SQL and owned cleanup0. See task-49-evidence.json; local commit only, no push/deploy.

**Tests**: Dedicated `whatsapp-human-intake.service.spec.ts`, unchanged support/Meta/voice companions, provider-fixture contracts and signed HTTP/DB `tests/whatsapp-human-intake.integration.spec.mjs`: button/text/authorized synthetic voice during checkout, replay, actual outbox rollback, exact tenant/thread and ordinary post-sale speech. Repeat T48 native and default T2 owned-runtime gates after the harness extension.
**Gate**: Full: protected Node runner for the new intake unit, existing support-handoff/handle-meta-conversation/meta-audio-context units and `tests/service-whatsapp-provider-fixture.contract.spec.mjs`; checked API build and artifact; protected native runner for `tests/whatsapp-human-intake.integration.spec.mjs`, `tests/whatsapp-handoff-binding.integration.spec.mjs`, `tests/service-test-runtime.spec.mjs`. Zero skipped. The complete AppModule serves real signed webhook/auth/inbox/SQL. Explicit child-only sender/media DI fixtures and local submissions are separate from external provider delivery/transcription; auth/repositories are not overridden. Final criterion checks remain mandatory.
**Commit**: `feat(service-business): t49 create or reuse a whatsapp support handoff`

### T50: Route incoming human-mode messages to support

**What**: Entrada deduplicada vai ao ticket ativo autenticado sem LLM/ação de carrinho enquanto waiting_human/human; preserva conteúdo/voice transcript autorizado e histórico.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-human-message-router.ts`
**Depends on**: T49
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-03, HUM-02

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] DB/HTTP incoming duplicates, texto/voz, sem geração/cobrança/cart mutation; erro não perde entrada.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-human-message-router.spec.ts` and `apps/api/tests/whatsapp-human-message-router.integration.spec.mjs`: DB/HTTP incoming duplicates, texto/voz, sem geração/cobrança/cart mutation; erro não perde entrada. Existing T49 unit/native companions remain regressions. Additional fingerprint unit, compiled whatsapp-twilio-fingerprint.contract.spec.mjs and signed whatsapp-twilio-replay.integration.spec.mjs cover local ingest-time equivalence, immutable legacy payload/hash and strict provider/kind/field conflicts.
**Gate**: Full: protected Node runner for `./src/modules/whatsapp-channel/application/services/whatsapp-human-message-router.spec.ts` plus unchanged T49 unit companions and prisma-whatsapp-webhook-inbox.fingerprint.spec.ts; checked API build and artifact; protected Node runner for ./tests/whatsapp-twilio-fingerprint.contract.spec.mjs against that artifact; `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-human-message-router.integration.spec.mjs ./tests/whatsapp-human-intake.integration.spec.mjs ./tests/whatsapp-twilio-replay.integration.spec.mjs` from apps/api. Root T50 and every subcase execute, none skipped. The MJS companion uses real signed/authenticated HTTP, AppModule, inbox worker and SQL; the local sender/media fixtures do not prove provider delivery or real transcription. Final criterion checks remain mandatory.
**Commit**: `feat(service-business): t50 route incoming human-mode messages to support`

### T51: Fence every automatic WhatsApp dispatch

**What**: Verificar epoch antes da geração e de cada envio/retomada, inclusive apresentação preparada parcial; integrar boundary único de dispatch existente sem alterar produto em modo ai.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-ai-dispatch-fence.ts`
**Depends on**: T50
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: EDGE-04, HUM-03

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Race integration: takeover durante LLM, depois de preparar media, entre mensagens e após retry; zero new automatic request starts after committed takeover. Requests already initiated may complete later.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Original authority/context/immutable-response/Twilio identity and payment-continuation unit companions; `tests/whatsapp-ai-dispatch-fence.integration.spec.mjs`, `whatsapp-ai-dispatch-http.integration.spec.mjs` and `whatsapp-routing-transaction.integration.spec.mjs` and `whatsapp-ai-request-commit.integration.spec.mjs`. Actual transaction and request-start races, ASR permanent claims, own-context rollback/retry, legacy input retention, expired routing and a real service admission negative. Local adapter transports and the explicitly declared AppModule sender fixture never prove real Meta/PSP delivery.
**Gate**: Full: protected Node runner with the selected unit companions listed in task-51-evidence.json; official checked API build; with cwd apps/api, `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-routing-transaction.integration.spec.mjs ./tests/whatsapp-ai-dispatch-fence.integration.spec.mjs ./tests/whatsapp-ai-dispatch-http.integration.spec.mjs ./tests/whatsapp-ai-request-commit.integration.spec.mjs`. Repeat defaultT2/T48/T49/T50/Twilio and the existing17 T26 checks on that artifact. Product DB normal-checkout-payment and widget-cross-sell-checkout protected runners remain mandatory because checkout/payment writers changed. Zero skipped. The unchanged supplemental normal-adapter80 comparison (same11 failures before/after) is documented separately; it is not reported as a green general suite. No artificial missing root spec or name filter is used. Final criterion checks remain mandatory.
**Commit**: `feat(service-business): t51 fence every automatic whatsapp dispatch`

### T52: Claim a conversation with compare-and-set

**What**: Apenas operador autorizado do tenant assume ticket WhatsApp disponível; claim atômico impede dupla posse e conserva auditoria.
**Where**: `apps/api/src/modules/support/application/claim-whatsapp-conversation.use-case.ts`
**Depends on**: T51
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, ATEND-08

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] HTTP/DB claims simultâneos, re-claim idempotente, operador sem permissão e outro tenant.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Dedicated domain `src/modules/whatsapp-channel/domain/services/whatsapp-handoff-claim.spec.ts` (10 transition cases), unchanged handoff/support/controller/gateway unit companions, and `tests/whatsapp-operator-claim.integration.spec.mjs`. Actual human-auth HTTP/SQL covers concurrent claims, original/current replay, foreign/widget/closed/merged cases, valid service key rejection, atomic outbox rollback and generic widget preservation. No auth/repository override or provider request.
**Gate**: Full passed:31 units and real10 HTTP/DB cases, checked2529, zero fail/skip/provider/owned cleanup; see task-52-evidence.json. Commands: protected Node runner without a name filter for the dedicated claim unit and existing companions listed in task-52-evidence.json; official checked API build; from apps/api `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-operator-claim.integration.spec.mjs`. Every root/child executes, zero skipped. Actual AppModule includes the route/provider in this task; no artificial missing root spec or bypass. Final HUM-04/ATEND-08 checks remain mandatory as later send/console tasks complete their portions.
**Commit**: `feat(service-business): t52 claim a conversation with compare-and-set`

### T53: Queue an operator message atomically

**Status**: Complete local Full -31 selected units,13 real HTTP/Socket.IO/SQL tests, checked API build0/2542; zero fail/skip/provider and natural owned cleanup0. Exact test correction explicitly approved, then official13 repeated. See task-53-evidence.json. No transport/delivery/read claim; T54/T55 remain.

**What**: Persistir message/clientMessageId e outbox na mesma transação, canal destino do binding; gravação aparece queued e não read; caminhos de suporte existentes preservados.
**Where**: `apps/api/src/modules/support/application/send-ticket-message.use-case.ts`
**Depends on**: T52
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, HUM-05

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] DB/HTTP: duplicate, foreign ticket, closed ticket, outbox rollback e suporte widget anterior.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: `whatsapp-operator-authorization.spec.ts`, unchanged `auth/presentation/staff-access.spec.ts` and handoff/support/controller/gateway units (31 selected); dedicated `tests/whatsapp-operator-message.integration.spec.mjs` for real HTTP/WebSocket/SQL duplicate/conflict, trusted actor, foreign/widget/closed/alias/no-claim, atomic message/delivery/outbox rollback and widget behavior. Outbound provider delivery is T54, not a queue claim.
**Gate**: Full: protected Node unit runner without a name filter, selected files in task-53-evidence.json; official checked API build; from apps/api `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-operator-message.integration.spec.mjs`. Actual AppModule/auth/repositories/tenant SQL and operator Gateway, zero skipped. HTTP/Gateway server principal is separate from buyer DTO; no free recipient or source flag. Final HUM-04/HUM-05 checks remain mandatory after later transport/UI tasks.
**Commit**: `feat(service-business): t53 queue an operator message atomically`

### T54: Deliver the operator outbox to the original thread

**Status**: Complete local Full -128 selected units and55 real native tests (35new/13queue-preservation/7runtime), checked2547 inputa10478e3/artifact8b402eb9; zero fail/skip/cancel in the accepted gate and natural owned cleanup0. Final unchanged API9 passed with failure-only observers; previous failures/refusal remain in task-54-evidence.json. No causal diagnosis or relay repair, provider delivery/read, T55 or whole-feature completion claim.

**What**: Enviar pelo canal/config/thread autenticados, respeitar janela/conexão; correlacionar providerMessageId; falha/unknown distintos, retry sem duplicação cega.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-support-outbox.consumer.ts`
**Depends on**: T53, T108
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-05, HUM-07

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Integration fake provider determinístico: accepted/error/timeout/window/offline/duplicate; nenhum destinatário vindo livre do cliente.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Integration fake provider determinístico: accepted/error/timeout/window/offline/duplicate; nenhum destinatário vindo livre do cliente.
**Gate**: Full: protected Node unit runner without a name filter for the new operator connection/delivery, submission and dispatcher-lease companions plus existing context/dispatcher/provider/support regressions; official checked API build. From apps/api, `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-operator-delivery.integration.spec.mjs ./tests/whatsapp-operator-request.integration.spec.mjs ./tests/whatsapp-operator-adapter.integration.spec.mjs ./tests/whatsapp-operator-message.integration.spec.mjs ./tests/service-test-runtime.spec.mjs`. Actual AppModule/auth/HTTP/HMAC/Gateway/SQL and owned PG request-start/deferred-COMMIT checks; explicit local sender or scoped adapter transport only, no external delivery/read claim. Preserve the original T53 queued oracles by finite test-only deferral of that separate transport stage, never a production bypass. Every root/child executes, zero skipped. These concrete companions replace the proposed artificial missing root spec; final HUM-05/HUM-07 checks remain mandatory after T55 and the console tasks.
**Commit**: `feat(service-business): t54 deliver the operator outbox to the original thread`

### T55: Preserve delivery and read receipts

**Status**: Complete (local Full/Build, 2026-11-17). Current own Root e6a53bad2-based source: unfiltered53-file727/727 components, actual native173/173 in18wholefiles, compiledTwilio2, normal48/widget176, privacy7 and header9/9; own ordinary checked2552/inpute48c83ce/artifact7c492f64, APIlint/types0. Native/product/worker cleanup0 and final ownprocesses0. Historical failures/refusals, static-count wrapperd691FAILED, TS2322 and cache-env build failure are retained in task-55-evidence.json; later passes do not assign their cause. Original approved54dbd exact; public privacy and original-account/attempt fences preserved. T55 marked before its focused atomic commit; no provider/production/final-feature acceptance claim.

**What**: Mapear queued/accepted/delivered/read/failed/unknown com correlação e eventos fora de ordem; callback autenticado e monotonicidade, aceite não é leitura.
**Where**: `apps/api/src/modules/whatsapp-channel/application/services/whatsapp-support-delivery.service.ts`
**Depends on**: T54
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-05, HUM-07

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] HTTP callback/DB: read antes de delivered, duplicata, outro tenant/providerId, assinatura inválida e unknown reconciliado.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Focused `domain/services/whatsapp-operator-receipt.spec.ts`, unchanged delivery merge/authority companions, public-url and explicit fixture contracts, existing status/AI/order receipt regressions; actual signed callback AppModule/auth/HTTP/Socket.IO/SQL `tests/whatsapp-operator-receipt.integration.spec.mjs` and owned-PG `tests/whatsapp-operator-receipt-db.integration.spec.mjs`. Read-before-delivered, full-row duplicate/no-op preservation, original unknown/early/deferred-COMMIT settlement, durable no-start refusal, late history, exact tenant/config/account/ID/sender/recipient/signature/encoded query, complete evolving form and final realtime-outbox rollback; no provider delivery/read claim.
**Gate**: Build (end of Phase7): header **Build** commands and Phase7 component/native regression gates, including the unchanged T54 unit/native55 scope and original signed intake/routing/AI fences. Protected Node unit runner without a name filter for the concrete companions in Tests. Fresh official checked API build; from apps/api `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-operator-receipt.integration.spec.mjs ./tests/whatsapp-operator-receipt-db.integration.spec.mjs` plus the existing phase companions recorded in T48-T54. Every root/child executes, zero skipped. These concrete spec-derived companions replace the proposed artificial missing root spec; final HUM-05/HUM-07 checks and feature-level verification remain mandatory.
**Commit**: `feat(service-business): t55 preserve delivery and read receipts`

### T56: Close the active human case and resume once

**What**: Fechar ticket e mudar modo/epoch + retorno outbox atomicamente; só vínculo ativo; ticket antigo/duplicata não retoma outro caso nem reenvia cobrança.
**Where**: `apps/api/src/modules/support/application/close-whatsapp-conversation.use-case.ts`
**Depends on**: T55, T59
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

**What**: Falar com atendente visível no principal para products/services, respeitando capacidade/paginação; menus de produto continuam só ações pertinentes e Menu principal. Explicitly cover natural paraphrases through the LLM tool and authenticated voice, including during checkout. Preserve deterministic shortcuts, reject negation/quotation/hypothetical or ambiguous clinician requests, use only server-owned current turn, and prove the canonical buyer acknowledgement after tool-created handoff without weakening AI fences.
**Where**: `apps/api/src/modules/whatsapp-channel/domain/ui/buyer-hub.ts`
**Depends on**: T56
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-01, HUM-02, REG-02

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] buyer-hub.spec.ts + handoff integration por botão/texto/voz, limites nativos e menus já aprovados.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: buyer-hub.spec.ts + handoff integration por botão/texto/voz, limites nativos e menus já aprovados. Add real semantic tool-to-intake-to-buyer-ACK text/voice cases, negation/quote/ambiguity negatives and unchanged checkout/cart/binding snapshots; captured model transport is synthetic, actual intake/fences/SQL are real.
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
**Depends on**: T9, T53
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: HUM-04, HUM-08, ATEND-08

**Status**: Complete LOCAL QuickUI -75/75unfiltered in2files (5oldpermissions+15oldsubscriptioncompanions+55criterioncases),0skip/fail,natural0; oldfunctions/constants/testassertions byte-preserved. No route/tab/backend change. See task-59-evidence.json.

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] permissions.spec.ts: role×mode×capability×plan e fallback de rota desconhecida negado onde sensível.
- [x] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: permissions.spec.ts: role×mode×capability×plan e fallback de rota desconhecida negado onde sensível.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/lib/auth/permissions.spec.ts` plus any actual unchanged permission companion required by the existing file structure, selected unfiltered. Record concrete files/counts before execution; every new T59 criterion case and old permission case executes, zero skipped. No route/tab wiring or backend authorization change is granted by a client helper. Final criterion checks and phase-ending dashboard types/build/browser remain mandatory.
**Commit**: `feat(service-business): t59 separate conversation and configuration permissions`

### T60: Load and reconcile the conversation queue

**What**: Hook reusa APIs/WS suporte, server filter/cursor, reconcilia clientMessageId e status sem duplicação; loading/empty/error/unknown distintos.
**Where**: `apps/dashboard/src/pages/whatsapp-seller/useWhatsAppConversations.ts`
**Depends on**: T59, T58
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

**Status**: Complete - unit16/16, checked API build0/2500 productive sources and owned AppModule/SQL14/14, zero skipped, natural exit/cleanup0. See task-63-evidence.json. Embedding/index/retrieval and T96/T97 form/API remain later gates.

**What**: Union tipada de company/hours/professional/service/faq/policy e allowlist por fonte; origem/version/hash/publication; nada de paciente, operador, credenciais, chat, pagamento ou bloqueio privado.
**Where**: `apps/api/src/modules/graph-rag/domain/public-business-source.ts`
**Depends on**: T13, T18
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-01, RAG-07, RAG-10, RAG-11, ONB-06

**Done when**:

- [x] Seis fontes tipadas e reader canônico registrado no AppModule, com tenant/publicação/version/hash, sem preço/estoque/slots ou campos privados; serviceNames sóservices.
- [x] public-business-source.spec.ts16/16 e business-rag.integration.spec.mjs14/14 com canários privados, três negócios, retirada/retorno, variante ativa, legado e snapshots de produtos preservados.
- [x] Gate Full passou com build checked0/2500, ACK/natural exit0 e cleanup próprio, zero skips. Primeiro gate verde foi repetido após corrigir a publicação por variante encontrada na revisão. Sem push/deploy.

**Tests**: public-business-source.spec.ts + business-rag.integration.spec.mjs, com classes compiladas, PostgreSQL/middleware e AppModule reais próprios. Não cria endpoint HTTP artificial de leitura do corpus.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T63$" ./src/modules/graph-rag/domain/public-business-source.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag.integration.spec.mjs`, após captura/build/record do artefato checked. Teste raiz T63 cobre os subcasos e falha com skipped/zero; checks finais por ID continuam obrigatórios.
**Commit**: `feat(service-business): t63 project only approved public business fields`

### T64: Queue source work durably with canonical writes

**Status**: Complete - unit24/24 including T63, checked API build0/2504, queue native12/12 and T63 regression14/14 on the same artifact, zero skipped/cleanup0. Actual three settings writers retain their legacy durable signals; explicit canonical normalization and leases are proven. Full reconciliation/graph indexing remain T65/T66. See task-64-evidence.json.

**What**: Registro idempotente de trabalho/outbox por fonte/version e retry após falha; escritores canônicos usam transação existente, não depender só de evento em memória.
**Where**: `apps/api/src/modules/graph-rag/application/public-source-work.service.ts`
**Depends on**: T63
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-01, RAG-03, RAG-11

**Done when**:

- [x] Sinais dos três writers reais persistem com worker offline e normalizam pela fonte pública atual, preservando contrato legado e gerando revisão nova inclusive em A-B-A offline.
- [x] PostgreSQL/middleware reais provaram rollback fonte/work/chunks, falha de normalização sem perder cadastro salvo, dedup, claim concorrente, relógio/lease/CAS/stale/retry, escopo e snapshots de produtos.
- [x] Gate Full passou:24units,12native+14regressão, build checked0/2504 e cleanup0. Primeira negativa teve apenas wrapper incorreto de uma fixture nova para throw síncrono; corrigido sem alterar erro/asserções ou fonte API, rerun12/12 no mesmo artifact. Sem ação remota.

**Tests**: public-source-work.service.spec.ts e business-rag-work.integration.spec.mjs; repetir business-rag.integration.spec.mjs porque o reader canônico ganhou reutilização da transação para normalização. Proveniência/eventos de todos os demais writers e embedding/grafo ainda não têm aceite.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T64$" ./src/modules/graph-rag/application/public-source-work.service.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag-work.integration.spec.mjs ./tests/business-rag.integration.spec.mjs`, após captura/build/record checked. Nenhum skipped/zero; checks finais por ID continuam obrigatórios.
**Commit**: `feat(service-business): t64 queue source work durably with canonical writes`

### T65: Connect reconciliation to the actual source writers

**What**: Assinaturas/reconciliador cobrem os escritores reais já ligados ao contrato de outbox nas tarefas anteriores, incluindo políticas/FAQ/company/profissional/serviço; não depender de seed ou evento inexistente.
**Where**: `apps/api/src/modules/graph-rag/application/graph-sync.service.ts`
**Depends on**: T64, T25
**Status**: Complete -528unit/88native,0fail/skip; storefront and checkedAPI2521 passed, source0b205279/artifactc12d25b3, owned cleanup0. Evidence: task-65-evidence.md.
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-01, RAG-02, RAG-11

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Integration altera cada formulário/API real e encontra trabalho/fonte atual; cron retry/offline/retirada, sem sleeps frágeis.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: graph-sync.service.spec.ts; business-rag-writers.integration.spec.mjs with40 children across ordinary authenticated writers, controlled JSON races, publication rollback/replay, private canaries and legacy FAQ preservation. Unchanged T64, T63 and C96 companions remain regression gates. Additional business-rag-mixed-batch.integration.spec.mjs proves mixed counters/legacy/isolation and causal second-batch/chunk rollback against owned PG.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T65$" ./src/modules/graph-rag/application/graph-sync.service.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag-writers.integration.spec.mjs ./tests/business-rag-work.integration.spec.mjs ./tests/business-rag.integration.spec.mjs ./tests/service-company-service-names.integration.spec.mjs`, plus `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag-mixed-batch.integration.spec.mjs`, after normal frontend artifact preparation and checked API capture/build/record. Existing graph/catalog unit suites run fully, with no skips or weakened assertions. Teste raiz T65 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t65 connect reconciliation to the actual source writers`

### T66: Index source versions idempotently

**What**: Worker ordena versões, grava projeção/hash/model e marca resultado; versão velha não sobrepõe nova, falha mantém retry e erro observável; batches limitados.
**Where**: `apps/api/src/modules/graph-rag/application/public-business-index.worker.ts`
**Depends on**: T65
**Status**: Complete - checked API2528, pure603+5, actual SQL/Neo4j index14 and profile/preservation106 all green, zero skipped/provider/remaining owned resources. Full evidence in task-66-evidence.md.
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-01, RAG-03, RAG-04

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] DB+Neo4j local: concorrência, duplicate/out-of-order, worker crash, embedding fake, source save continua válido.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: DB+Neo4j local: concorrência, duplicate/out-of-order, worker crash, embedding fake, source save continua válido.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T66$" ./src/modules/graph-rag/application/public-business-projection.service.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag-index.integration.spec.mjs ./tests/business-rag-vector-profile.integration.spec.mjs` + integração HTTP/DB do arquivo nomeado em Tests. Teste raiz T66 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t66 index source versions idempotently`

### T104: Reduce bounded public projection write overhead

**What**: Submit root version/lock admission, old-chunk retirement and current-chunk upsert as one atomic parameterized statement, retaining the unchanged transaction deadline and all canonical worker guards. Resolve the reproduced cold-projection failure without warming tests, retries inside the graph adapter or timeout changes.
**Where**: `apps/api/src/modules/graph-rag/application/public-business-projection.service.ts`
**Depends on**: T66
**Status**: Complete locally;879components/51native/checked2543 allgreen, same2000ms/no warm-up. See task-104-evidence.json; final feature verification pending.
**Reuses**: Existing public-v1 schema/unique constraints, projection port, prepared public parameters, worker revision/lease/canonical admission, native Neo4j and old index/revalidation fixtures. No catalog/document namespace or provider change.
**Requirement**: RAG-01, RAG-02, RAG-03

**Done when**:

- [x] Applied/stale/withdrawn/unavailable outcomes and exact public fields remain intact; one atomic statement retains version compare-and-set, source-root write lock and tenant-scoped retirement/upsert.
- [x] Existing unchanged native index14 and canonical revalidation37 cases pass on both profiles under the same2000ms deadline, with no warm-up, skipped assertions or altered failure policy. A failed attempt remains recorded and cannot close the task.
- [x] New/old component cohort and fresh official checked API build pass on this source; preserve dirty69, mark104complete and stage only its source/tests/status for one atomic local commit.

**Tests**: New `public-business-projection.submit.spec.ts` root T104 (four outcome children), old preparation/worker/adapter contracts unchanged; actual `business-rag-index.integration.spec.mjs`, `business-rag-revalidation.integration.spec.mjs` and `business-rag-public-support-http.integration.spec.mjs` unchanged.
**Gate**: Full: unfiltered current combined graph/catalog/knowledge/support/storefront component cohort including the new graph companion; fresh unchanged official checked API build; existing owned index14 and revalidation37 commands through the current guarded launchers. Exact source/output binding, real SQL/Neo4j state, normal cleanup, no provider calls. Record actual executed counts and gate logs, not planned registrations.
**Commit**: `fix(service-business): t104 reduce public projection write overhead`

### T67: Backfill and retire public source projections

**What**: Backfill tenant-scoped de dados existentes e tombstones ao retirar/publicar; retomável/versionado e sem reativar texto antigo, sem central manual.
**Where**: `apps/api/src/modules/graph-rag/application/public-business-reconciler.ts`
**Depends on**: T66
**Status**: Complete locally - checked2531,614components and135actual native passed,0fail/skip/provider/naturalcleanup. See task-67-evidence.md; final feature proof and independent verification remain pending.
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-02, RAG-03, RAG-10

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] business-rag-backfill.integration.spec.mjs: backfill/restart/delete/unpublish/recreate e worker offline, stale vector não vira fonte ativa.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: business-rag-backfill.integration.spec.mjs: backfill/restart/delete/unpublish/recreate e worker offline, stale vector não vira fonte ativa.
**Gate**: Full: protected Node unit runner selects `src/modules/graph-rag/application/public-business-backfill.spec.ts` plus the unchanged sync/work/source companions; official checked API build; with cwd apps/api, `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag-backfill.integration.spec.mjs ./tests/business-rag-index.integration.spec.mjs` plus relevant unchanged source/work/writer preservation. All new cases execute, zero skipped and owned resources naturally closed. Final criterion checks remain mandatory; no artificial missing root or skip-producing name filter.
**Commit**: `feat(service-business): t67 backfill and retire public source projections`

### T68: Revalidate evidence independently of graph availability

**What**: Checar tenant/publicação/version/hash canônicos tanto graph quanto fallback; ausência/contradição/indisponibilidade distintas; retirada invalida evidência imediatamente.
**Where**: `apps/api/src/modules/knowledge-base/application/use-cases/revalidate-public-source.service.ts`
**Depends on**: T67
**Status**: Complete - Full639unit +51native(37new+14index), checked2541 input4c61abc6/artifact0c20cdc3; see task-68-evidence.json.
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-02, RAG-04, RAG-06, RAG-07

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit + DB: stale hash/foreign/private, graph on/off, conflicting source e canonical outage sem falso nenhum produto.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: `revalidate-public-source.service.spec.ts` plus unchanged KB reader/query/repository companions; `business-rag-revalidation.integration.spec.mjs` registers two actual PostgreSQL/pgvector profiles with Neo4j, fifteen scenarios each including exact-PID writer/read-lock wait. Core33 plus public-support HTTP4 =37native, plus unchanged index14 preservation, no skipped; proposal companions alone register zero and are not proof entries.
**Gate**: Full: protected Node unit runner selects the actual T68 root and unchanged KB/graph/catalog companions without a skip-producing global name filter; official checked API build; with cwd apps/api `node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag-revalidation.integration.spec.mjs ./tests/business-rag-public-support-http.integration.spec.mjs` plus unchanged business-rag-index.integration.spec.mjs preservation on the same artifact. All37 new native tests and14 index-preservation tests must execute,0skipped and natural owned cleanup0. Production DI is normal; fixed graph transport failure and deterministic model vectors are declared test boundaries, not real buyer/provider/T69audit/T70gateway proof. Final criterion checks remain required.
**Commit**: `feat(service-business): t68 revalidate evidence independently of graph availability`

### T69: Keep provenance through the knowledge reader

**What**: KnowledgeChunk e auditoria conservam sourceType/id/version/hash/model/publication; adaptar tipo compartilhado e consumidores estritamente necessários sem vazar conteúdo privado.
**Where**: `apps/api/src/modules/knowledge-base/infrastructure/graph-knowledge.reader.ts`
**Depends on**: T68, T104
**Status**: Complete locally;879components/83native/checked2543fa8c-1d61 allgreen after104repair. Actual HTTP response audit/privacy/coexistence proven,0skip/provider/naturalcleanup; see task-69-evidence.json. T70/T71and final feature verification remain pending.
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-04, RAG-07

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Reader/query/support/storefront contracts plus both native provenance companions demonstrate metadata through the actual persisted response audit, exact tenant/source/correlation, privacy and visible audit-write failure.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: New provenance contracts for graph reader, QueryKnowledge, response audit, Support consumer, Storefront consumer and public caller scope; unchanged old companions run without filters. Native `business-rag-support-provenance.integration.spec.mjs` (five tests) and `business-rag-storefront-provenance.integration.spec.mjs` (four) exercise actual HTTP/auth/Prisma/audit with declared model-only fixtures. Existing T68 admission, public HTTP and index companions remain required.
**Gate**: Full: the unfiltered component cohort through the existing guarded loader, a fresh complete checked API build with unchanged compiler settings, then `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag-support-provenance.integration.spec.mjs ./tests/business-rag-storefront-provenance.integration.spec.mjs` and the existing T68 native companions. No name filter, skipped case, stale artifact or undeclared provider override; record exact executed counts and owned cleanup. Final per-criterion proofs remain mandatory after the last task.
**Commit**: `feat(service-business): t69 keep provenance through the knowledge reader`

### T108: Collect bounded native Windows socket evidence without CIM startup

**What**: Trocar só a coleta Windows que dispara Get-NetTCPConnection por uma leitura numérica fresca de netstat.exe do sistema, com argv fixo, sem shell/DNS, mesmo timeout10000/maxBuffer1000000. Filtrar PID do próprio processo e Established, validar formato/portas/endpoints e reutilizar assertConstructionRedisNativePeer sem alterar suas negativas. Preservar referência de Socket e inspeção de estado antes/depois de await; erro/malformed/duplicata/peer diferente nunca concede ownership. Não registrar saídas globais/privadas do comando.
**Where**: `apps/api/tests/nest-construction-only.guards.mjs`
**Depends on**: T2
**Reuses**: Windows system netstat -ano, existing live Node/ioredis guard proofs, unchanged assertConstructionRedisNativePeer/captured socket WeakMap/teardown/ambient network traps. JS harness runs directly and is not a Nest compilation input.
**Requirement**: QA-01, QA-03

**Done when**:

- [x] Parser and command contracts reject malformed or foreign ownership, preserve duplicate ambiguity, use numeric established TCP and current PID only, keep fixed command/deadline/buffer, sanitize errors and never use stale output or a fallback that grants authority.
- [x] Real current Windows loopback sockets with blank getter simulation are corroborated by the OS and retain the exact captured socket through closure; new and all old construction/owned-client contracts pass without skips or assertion edits. A non-Windows collector refuses the unsupported operation; portable parser contracts still execute.
- [x] Full JS guard gate and syntax/build check pass, evidence records actual counts/durations/ownership and unchanged productive compiler inputs. Mark before one atomic local repair commit. Original105browser2/54API9 remain required in their own tasks; no green feature from this repair alone.

**Tests**: New `tests/windows-owned-tcp.contract.spec.mjs`, unchanged `tests/nest-construction-only.contract.spec.mjs` and `tests/storefront-journey-owned-clients.contract.mjs`; real local TCP/ioredis only, no Docker/provider or AppModule auth override. Native Windows branch is actually exercised here; non-Windows denial is a tested branch, not a skip.
**Gate**: Full JS build/contract: `pnpm --dir apps/api exec node --check ./tests/windows-owned-tcp.mjs`; `pnpm --dir apps/api exec node --check ./tests/nest-construction-only.guards.mjs`; `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/windows-owned-tcp.contract.spec.mjs ./tests/nest-construction-only.contract.spec.mjs ./tests/storefront-journey-owned-clients.contract.mjs`. No productive TypeScript/package/schema changes; whole checked API artifacts remain separately admitted by their unchanged inventories for affected consumers. Record parser/command files and exact source review before first run.
**Status**: Complete locally:30/30 old/new contracts,0skip/fail/cancel, both JS syntax checks and real Windows native socket proof passed. See task-108-evidence.json; original54/105 consumer reruns and final feature verification remain pending.

**Commit**: `fix(service-business): t108 collect bounded native socket evidence`

### T70: Extend parameterized Cypher templates for services

**What**: Templates aprovados unem serviço/profissional/conhecimento público com parâmetros tenant, limite/timeout; gateway Community privado mantém rejeição de escrita e Cypher livre; disponibilidade continua ferramenta operacional.
**Where**: `apps/api/src/modules/graph-rag/domain/public-business-query.ts`
**Depends on**: T69, T108
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: RAG-05, RAG-08, EDGE-05

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] Unit gate + Neo4j/gateway local: queries avançadas, cross-tenant, escrita/subquery/procedure/arbitrary text rejeitados.
- [x] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: Unit gate + Neo4j/gateway local: queries avançadas, cross-tenant, escrita/subquery/procedure/arbitrary text rejeitados.
**Gate**: Full: complete `src/modules/graph-rag/domain/public-business-query.spec.ts` plus unchanged old graph-query, graph-result consumers, gateway, adapter, runtime and public-evidence specs using the existing network guard/ready-prod-loader with concurrency1, without a skip-producing name filter; fresh official checked API and `tests/business-rag-public-query.integration.spec.mjs` against owned actual graph/SQL/gateway. See task-70-plan.md for the concrete path correction from the original legacy graph-query.spec.ts; old assertions remain. Tests T70 and all their children execute, zero skips; final criterion checks remain mandatory.
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
**Depends on**: T25, T59
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-08

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] service-attendance.api.spec.ts: requests/DTOs, invalid/forbidden/conflict/network e retries somente seguros.
- [x] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-attendance.api.spec.ts: requests/DTOs, invalid/forbidden/conflict/network e retries somente seguros.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/api/endpoints/service-attendance.spec.ts` plus recorded unchanged API-client companions, unfiltered and zero skipped. Derive exact professional/association/availability/policy/category DTOs and routes from the already implemented controllers; no speculative endpoints, free tenant field, client price/capacity authority or connection token. Appointment-operation wrappers are added only with their actual T41 contracts before T79/T80. All remaining feature/build/browser/proof gates and T72 evaluation remain mandatory.
**Commit**: `feat(service-business): t73 type the service administration api client`

### T74: Manage service administration view state

**What**: Hook de período/profissional/categoria/aba e ações serializadas com loading/empty/error/conflict; não otimiza confirmação de vaga/pagamento antes do servidor.
**Where**: `apps/dashboard/src/pages/service-attendance/useServiceAttendancePage.ts`
**Depends on**: T73
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-06, ATEND-07

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] useServiceAttendancePage.spec.ts: stale responses, filtro/URL/refresh, rollback visual e erro de comando.
- [x] Gate Quick UI passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: useServiceAttendancePage.spec.ts: stale responses, filtro/URL/refresh, rollback visual e erro de comando.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/useServiceAttendancePage.spec.ts src/api/endpoints/service-attendance.spec.ts src/api/http/client.spec.ts src/api/http/session-fetch.spec.ts src/api/endpoints/catalog.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx` unfiltered, zero skipped; recorded unchanged transport and legacy company-mode hook companions. No appointment operation before actual T41 contracts; remaining phase/browser/build/final gates stay mandatory.
**Commit**: `feat(service-business): t74 manage service administration view state`

### T75: Create the service-only Atendimento page shell

**What**: Agenda/Profissionais/Categorias/Disponibilidade/Configurações com componentes existentes, filtros e guard de modo; capturas artifacts/atendimento.running.png desktop/mobile.
**Where**: `apps/dashboard/src/pages/service-attendance/ServiceAttendancePage.tsx`
**Depends on**: T74
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-01, ATEND-08, QA-02

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] ServiceAttendancePage.spec.tsx + browser local: tab/deep link, produto negado, loading/empty/error e acessibilidade.
- [x] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: ServiceAttendancePage.spec.tsx + browser local: tab/deep link, produto negado, loading/empty/error e acessibilidade.
**Gate**: Browser: unfiltered affected component cohort `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/ServiceAttendancePanels.spec.tsx src/pages/service-attendance/ServiceAttendancePage.spec.tsx src/pages/service-attendance/useServiceAttendancePage.spec.ts src/api/endpoints/service-attendance.spec.ts src/api/endpoints/merchants.profile-identity.spec.ts src/api/endpoints/merchants.spec.ts src/api/http/client.spec.ts src/api/http/session-fetch.spec.ts src/api/endpoints/catalog.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx` plus `pnpm --dir apps/dashboard exec playwright test --config playwright.service-attendance-local.config.ts e2e/service-attendance-shell.spec.ts`. Read-only shell composition only; no category/professional CRUD, appointment/payment authority or global T82/T83 route wiring. Real AuthScreen/API/owned SQL for services OWNER, products OWNER and services STAFF, native desktop/mobile captures and closed-resource proof. Existing1024/2048 guards,60/600/30/10/5budgets and assertions unchanged; zero skipped. Remaining feature/build/final gates stay mandatory.
**Commit**: `feat(service-business): t75 create the service-only atendimento page shell`

### T76: Manage professionals in Atendimento

**What**: Lista/form de profissional público, fuso/serviços/estado; desativar preserva compromissos e mostra impacto, sem criar login implícito.
**Where**: `apps/dashboard/src/pages/service-attendance/components/ProfessionalsPanel.tsx`
**Depends on**: T75
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-02, AGENDA-01

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] ProfessionalsPanel.spec.tsx + browser create/edit/deactivate, validação e erro/foreign negado pela API.
- [x] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: ProfessionalsPanel.spec.tsx + browser create/edit/deactivate, validação e erro/foreign negado pela API.
**Gate**: Browser: unfiltered affected cohort `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/components/ProfessionalsPanel.spec.tsx src/pages/service-attendance/components/professional-form.spec.ts src/pages/service-attendance/ServiceAttendancePage.professionals.spec.tsx src/pages/service-attendance/ServiceAttendancePanels.spec.tsx src/pages/service-attendance/ServiceAttendancePage.spec.tsx src/pages/service-attendance/useServiceAttendancePage.spec.ts src/api/endpoints/service-attendance.spec.ts src/api/endpoints/merchants.profile-identity.spec.ts src/api/endpoints/merchants.spec.ts src/api/http/client.spec.ts src/api/http/session-fetch.spec.ts src/api/endpoints/catalog.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx` (expected150/13files, runner authoritative), affected lint14 and `pnpm --dir apps/dashboard exec playwright test --config playwright.service-professionals-local.config.ts e2e/service-professionals.spec.ts` (4cases/8native CRUD frames). Existing1024/2048 guards,1worker,no retries/skips,5/10/30/60/600budgets. Real AuthScreen/API/owned SQL, confirmed appointment/payment/users preservation, CAS conflict/foreign and Staff/products denial; Root actual current-frame review before mark/atomic commit.149historical proof predates one new disappearing-trigger focus regression; current150must run.
**Commit**: `feat(service-business): t76 manage professionals in atendimento`

### T77: Reuse service categories in Atendimento

**What**: Painel reutiliza ProductCategory/API existente e associa ofertas service; não duplica tabela/preço/capacidade, mantém categorias de produtos isoladas por modo/tenant.
**Where**: `apps/dashboard/src/pages/service-attendance/components/ServiceCategoriesPanel.tsx`
**Depends on**: T76
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: ATEND-03

**Done when**:

- [x] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [x] ServiceCategoriesPanel.spec.tsx + browser categorias, vínculos, vazio/erro e leitura por dois profissionais sem capacidade extra.
- [x] Gate Browser passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: ServiceCategoriesPanel.spec.tsx + browser categorias, vínculos, vazio/erro e leitura por dois profissionais sem capacidade extra.
**Gate**: Browser: unfiltered affected cohort `pnpm --dir apps/dashboard exec vitest run src/pages/service-attendance/ServiceAttendancePanels.spec.tsx src/pages/service-attendance/ServiceAttendancePage.spec.tsx src/pages/service-attendance/useServiceAttendancePage.spec.ts src/api/endpoints/service-attendance.spec.ts src/api/http/client.spec.ts src/api/http/session-fetch.spec.ts src/api/endpoints/catalog.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx src/api/endpoints/merchants.profile-identity.spec.ts src/api/endpoints/merchants.spec.ts src/pages/service-attendance/components/ProfessionalsPanel.spec.tsx src/pages/service-attendance/components/professional-form.spec.ts src/pages/service-attendance/ServiceAttendancePage.professionals.spec.tsx src/pages/service-attendance/components/ServiceCategoriesPanel.spec.tsx src/pages/service-attendance/components/service-category-form.spec.ts src/pages/service-attendance/ServiceAttendancePage.categories.spec.tsx` (expected187/16files, runner authoritative), affected lint15 and dedicated real `pnpm --dir apps/dashboard exec playwright test --config playwright.service-categories-local.config.ts e2e/service-categories.spec.ts` (expected4cases/8native frames, runner authoritative). Real AuthScreen/owned API/SQL: categories and canonical service links, empty/error, two professionals sharing one offer without extra capacity; preserve tenant/mode/Staff, price/variant/link/grade, keyboard/focus and native desktop/mobile evidence. Original1024/2048 guards,1worker,no retries/skips and5/10/30/60/600 remain. Old75control expectation changes only by reviewed05f65017 under Root interpretation of existing approvedATEND03/T77; no other old assertion weakened. No completion until whole gate and current Root visual review; final build/feature checks remain mandatory.
**Commit**: `feat(service-business): t77 reuse service categories in atendimento`

### T78: Edit availability and blocks from one panel

**What**: Grade/fuso/avulso/bloqueio com preview canônico; conflito confirmado bloqueia salvar sem cancelar; descontinuar escrita independente do ServiceScheduleEditor quando nova autoridade ativa. For canonical service businesses, align the existing catalog editor with professional-owned availability: retain modality/location/duration and direct availability to Atendimento instead of presenting legacy per-variant slots as another capacity authority. Preserve historical metadata and product flows; do not silently convert stored schedules.
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
**Depends on**: T78, T41
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

**What**: Nova chave service-attendance apenas services, support rotulada Suporte preservando FAQ/chamados; foco de catálogo Serviços; plano/modo/role independentes e histórico preservado. Add service-only Agendamentos as the primary Orders replacement while retaining separate Atendimento management and an authorized historical Orders path. Product Orders navigation remains unchanged; T103 owns the actual new board route.
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

**What**: Lazy render com guarda explícita, hash direto/reload/back/aba; produto não abre Atendimento por URL; rota antiga de suporte e WhatsApp continuam. Preserve the same mode/role/plan guard for the new appointments route mounted by T103; no mode guessed from product counts or segment labels.
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

### T96: Persist a public service-name list only for service businesses

**What**: Expandir o JSON canônico company.serviceNames com lista simples pública; validar e normalizar nomes, preservar omissão e limpar com[]. Aplicar guard da modalidade sob lock nos três writers/aliases existentes, roundtrip por ambos getters, trabalho durável/invalidação transacional e retirada do contexto ao mudar para produtos, preservando JSON histórico e todos os dados de comércio.
**Where**: `apps/api/src/modules/merchant/application/company-settings-write.ts`; mappers/types/DTOs existentes estritamente necessários e o writer de troca de modalidade.
**Depends on**: T16
**Reuses**: company.description/merge/mapper/outbox de T13/T14, modalidade canônica T12 e runtime local T2; sem nova tabela, catálogo duplicado, preço ou agenda.
**Requirement**: ONB-06, RAG-11, REG-01

**Done when**:

- [x] Lista pública validada persiste e reabre por todas as rotas equivalentes; omissão preserva,[] limpa, entrada inválida/foreign/product não altera fonte, trabalho, chunks ou demais dados.
- [x] Retirada/troca para products remove a lista da apresentação/contexto e invalida sua evidência antiga sem apagar histórico; mudança e trabalho são atômicos com rollback comprovado.
- [x] Unit + HTTP/DB reais locais passam, sem skipped, com checked build íntegro e commit próprio; sem ação remota.

**Tests**: company-service-names.spec.ts; service-company-service-names.integration.spec.mjs com services/products, três rotas, auth/tenant, merge/clear/limits, concorrência/rollback e modo/contexto.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T96$" ./src/modules/merchant/application/company-service-names.spec.ts` + `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/service-company-service-names.integration.spec.mjs`; checked API build quando a fonte muda. Check final ONB-06 permanece obrigatório.
**Status**: Complete locally: unit7/7, regression21/21, checked API build0/2506 and native17/17,0skip, actual AppModule/SQL/Next HTML and canonical reader, natural exit/owned cleanup/provider0. See task-96-evidence.json; T97 UI and final feature acceptance remain pending.
**Commit**: `feat(service-business): t96 persist service names in company data`

### T97: Edit the service-name list in the existing company form

**What**: Controle acessível de nomes em Dados da empresa sóservices, com botão+ e editar/remover, foco/feedback, payload mínimo e reload/erro/retry. Usa company.serviceNames sem criar ofertas agendáveis. Capturas reais desktop/mobile e prova final da lista pública no RAG.
**Where**: `apps/dashboard/src/pages/store-settings/ServiceNamesField.tsx`; hook/form/types e fixture/browser existentes estritamente necessários.
**Depends on**: T96
**Reuses**: CompanyAboutField, useStoreSettingsPage, perfil businessMode, componentes existentes e browser local T3; UI de produtos e catálogo comercial preservados.
**Requirement**: ONB-06, QA-02, REG-01

**Done when**:

- [x] Serviços: clicar+, editar/remover, salvar, reabrir, limpar e recuperar rascunho de falha funcionam com API/DB local real; oculto em products e nomes antigos não vazam para novo modo.
- [x] Unit e browser com gestos reais passam; capturas desktop/mobile mostram o controle e a condição de modalidade; nenhum teste anterior removido/relaxado.
- [x] Coletor final ONB-06 executa prova nativa de contexto público e browser, falha com zero/skipped e registra revisão/ambiente; gate e commit próprios.

**Tests**: service-names-field.spec.tsx, hook tests e e2e/service-company-service-names.spec.ts; service-company-services-proof.mjs seleciona ONB-06 nativo e browserT97 sem confundir mocks com RAG/provider real.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/store-settings/service-names-field.spec.tsx -t "T97"` + `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-company-service-names.spec.ts --grep "T97$"`; tipos/build afetados e check final ONB-06 obrigatórios. O arquivo focal contém dez gestos sob describeT97; selecionar o full title inclui seus filhos, sem filtro exato que gere zero casos.
**Status**: Complete locally:41 unit cases (10 field,4 hook,27 existing regressions), dashboard typecheck/build0 and fresh ONB-06 collector browser1/native17,0skip/0retry, provider/owned cleanup0. Desktop/mobile captures show the left-aligned plus control. See task-97-evidence.json; retrieval/provider/production and final feature verification remain pending.
**Commit**: `feat(service-business): t97 edit service names in company settings`

### T98: Match catalog creation controls to business mode

**What**: Aplicar a modalidade canônica ao cadastro: empresas de produtos veem tipos físico/digital/alimentação; empresas de serviços entram em "Novo serviço" com tipo service no primeiro render, reset e envio. Reutilizar os controles e a guardaT17; não converter silenciosamente registros carregados nem alterar compras/histórico.
**Where**: `apps/dashboard/src/pages/product-detail/components/ProductForm.tsx`
**Depends on**: T17
**Reuses**: Existing MerchantProfile/business-mode resolution, ProductForm/useProductForm/useProductDetailPage, CatalogPage, PageHeader/Button/tokens, catalog-business-mode API guard, current Vitest React DOM and local Playwright fixtures. Only necessary prop/default/entry-label wiring; no unrelated redesign.
**Requirement**: CAT-01, CAT-02, REG-02, QA-02

**Done when**:

- [x] Products/services creation gestures and reset/submit obey the current canonical mode; invalid/unknown/stale modes cannot introduce a forbidden type, and loaded history is not silently coerced.
- [x] Unfiltered old/new component contracts and actual local browser gestures prove both modes, payload and mode switching. Desktop/mobile captures are saved and shared with the user, labeled local; existing API guards and product purchase paths remain intact.
- [x] Dashboard typecheck/build plus the existing relevant lint/test gate and local Browser gate pass; record actual counts/paths, no skipped old tests or assertion changes; mark complete before one atomic local commit.

**Tests**: New `src/pages/product-detail/components/ProductForm.business-mode.spec.tsx` (root CAT-01), `src/pages/product-detail/hooks/useProductForm.business-mode.spec.ts` (root CAT-02), with necessary actual-page/hook companion for the submit payload; unchanged old product-detail/validation/service-schedule fixtures. New `e2e/service-catalog-business-mode.spec.ts` on existing `playwright.service-local.config.ts`, using synthetic local API/identity fixtures and actual click/type/reset/save gestures. No real provider/API deployment.
**Gate**: Browser plus UI build: `pnpm --dir apps/dashboard exec vitest run src/pages/product-detail/components/ProductForm.business-mode.spec.tsx src/pages/product-detail/hooks/useProductForm.business-mode.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx src/pages/product-detail-page.spec.ts src/pages/product-detail/utils/product-validation.spec.ts src/pages/product-detail/utils/service-schedule-validation.spec.ts` without a skip-producing name filter; `pnpm --dir apps/dashboard typecheck`; existing affected-file lint and dashboard build command; `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-catalog-business-mode.spec.ts`. Existing task-specific protected environment/resources/owned cleanup apply. Worker must record any concrete test-command adaptation before execution and preserve every old assertion.
**Commit**: `feat(service-business): t98 match catalog creation to business mode`

### Phase 14: Private support notification refinement

### T99: Persist the private support fallback recipient

**What**: Add a private per-merchant support-notification setting and authorized read/update/clear endpoint, separately from public FAQ settings and store configuration. Normalize explicit phone input; do not borrow company/budget/sender phones. Register schema and tenant protection together.
**Where**: `apps/api/src/modules/support/presentation/http/support-notification-settings.controller.ts`
**Depends on**: T53
**Reuses**: Existing support authorization, Prisma tenant conventions, phone normalization, audit and private-settings API patterns. Preserve SupportSetting/public-source persistence unchanged.
**Requirement**: HUM-09

**Status**: Complete LOCAL:51components,13actualHTTP/SQL, schema0/migration9, checked2550 and affected5-file lint0. No provider or production operations;100/101 remain separate.

**Done when**:

- [x] Actual authorized HTTP save/read/clear changes only the private setting. Anonymous/foreign/forbidden/invalid inputs perform no write or disclosure.
- [x] FAQ content/updatedAt, public source work/chunks and public storefront/RAG configuration remain identical, including when no FAQ row exists; FAQ saves preserve the private setting.
- [x] Full owned HTTP/SQL and schema/build/lint gates pass, old settings tests remain intact, then mark complete and create one local commit.

**Tests**: New `tests/support-notification-settings.integration.spec.mjs` root HUM-09 plus controller/domain tests; real owned SQL, public configuration/source canaries, concurrent FAQ/private saves and rollback.
**Gate**: Full plus schema build: unfiltered new controller/domain tests and old support-settings cohort; `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/support-notification-settings.integration.spec.mjs`; unchanged official checked API/schema build and lint. Record concrete component paths before execution. No production DB or provider.
**Commit**: `feat(service-business): t99 persist private support fallback recipient`

### T100: Queue and dispatch one staff alert per human case

**What**: Create a separate durable case/epoch alert in the canonical new-case transaction, then send a minimal staff WhatsApp notice with an authenticated Conversations link through the verified merchant channel. Preserve receipt identity, current recipient/config, eligibility and unknown-result semantics; ticket survives notification failure.
**Where**: `apps/api/src/modules/support/application/services/support-case-alert.consumer.ts`
**Depends on**: T99, T55, T62
**Reuses**: Existing canonical intake transaction, outbox, channel/config authority and delivery conventions; separate purpose from operator replies, buyer notices and orders. No fictitious orderId, new external account mapping or raw customer text in alerts.
**Requirement**: HUM-10, HUM-07

**Done when**:

- [ ] Committed new case produces exactly one alert; duplicate/replayed intake, rollback, another tenant and stale epoch cannot create or adopt an alert.
- [ ] Local captured transport proves recipient, minimal content/link and original verified channel. Unavailable/failed/unknown results retain truthful durable state; no uncertain automatic resend or delivery/read claim from acceptance.
- [ ] Full component/owned SQL-outbox gates and existing handoff/delivery regressions pass; old assertions intact; mark complete before one atomic commit.

**Tests**: New `tests/support-case-alert.integration.spec.mjs` root HUM-10 and consumer/receipt tests; actual owned SQL/outbox and strictly local provider capture, including rollback, config/recipient changes, missing window/template, uncertain commit and dedupe.
**Gate**: Full: unfiltered consumer/receipt and existing handoff/delivery cohorts; `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/support-case-alert.integration.spec.mjs`; unchanged official checked API build/lint. Record exact component selectors first; no provider call.
**Commit**: `feat(service-business): t100 alert staff on new human case`

### T101: Configure support alerts in the existing settings UI

**What**: Add private fallback phone save/clear controls to the existing support settings flow for both business modes, and show truthful alert availability/result in Conversations without publishing the phone to buyers or the RAG.
**Where**: `apps/dashboard/src/pages/support-settings/support-notification-settings.tsx`
**Depends on**: T99, T100, T62
**Reuses**: Existing settings form, validation/errors, typed private API, Conversations case detail and design-system controls; no new RAG administration page.
**Requirement**: HUM-09, HUM-10, QA-02

**Done when**:

- [ ] Actual save/clear/reload gestures persist the private recipient, preserve FAQ edits, obey role/tenant and display validation/forbidden/network states honestly.
- [ ] Conversations shows queued/accepted/unavailable/failed/unknown without equating acceptance with delivery; no repeated alert per incoming message.
- [ ] Unfiltered old/new components, dashboard build/typecheck and local desktop/mobile browser gestures/screenshots pass; mark complete before an atomic local commit.

**Tests**: New `src/pages/support-settings/support-notification-settings.spec.tsx` and `e2e/support-notification-settings.spec.ts`; old FAQ/settings/Conversations tests unchanged. Actual local authenticated API/persistence; no external sends.
**Gate**: Browser/UI build: `pnpm --dir apps/dashboard exec vitest run src/pages/support-settings/support-notification-settings.spec.tsx` plus old FAQ/settings/Conversations files recorded before execution; dashboard typecheck/local build; `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/support-notification-settings.spec.ts`.
**Commit**: `feat(service-business): t101 configure human support alerts`

### Phase 15: Appointments daily board

### T102: Map canonical appointments to coherent board views

**What**: Create a tested appointment-specific view model/query state for Kanban/list over the same authorized ServiceAppointment result. Preserve six operational statuses, separate financial states, timezone/range/professional/service filters, counts/pagination, allowed actions and expectedVersion.
**Where**: `apps/dashboard/src/pages/service-appointments/appointment-board.ts`
**Depends on**: T41, T74
**Reuses**: Typed service administration client/hook and Orders visual conventions; no TenantOrder fulfillment mapping, client-side capacity authority or implicit historical backfill.
**Requirement**: ATEND-11

**Done when**:

- [ ] Both views represent the exact same canonical appointment IDs and totals under the same filters. Order-only history cannot produce a card; multiple appointments per order remain distinct.
- [ ] Six statuses and payment badges remain independent; stale requests/actions cannot overwrite current state. Failed/conflicting commands retain original appointment/version/finance.
- [ ] Unfiltered new view-model/hook and existing Orders-board regressions pass with dashboard typecheck; mark complete before one atomic local commit.

**Tests**: New `src/pages/service-appointments/appointment-board.spec.ts` root T102 and related hook tests, covering more rows than one page, status/payment combinations, timezone boundaries, races and failed actions. Existing fulfillment-board tests unchanged.
**Gate**: Quick UI: `pnpm --dir apps/dashboard exec vitest run src/pages/service-appointments/appointment-board.spec.ts` plus old fulfillment-board and service-hook files recorded before execution; dashboard typecheck.
**Commit**: `feat(service-business): t102 model canonical appointments board`

### T103: Present the service-only appointments Kanban and list

**What**: Add Agendamentos with Kanban/list, detail/actions and filters, using the canonical view model. Replace only the service-business primary Orders menu entry, preserve separate Atendimento management and authorized historical Orders access, and enforce mode/role/plan across menu/direct URL/mobile/merchant switches.
**Where**: `apps/dashboard/src/pages/service-appointments-page.tsx`
**Depends on**: T102, T80, T83
**Reuses**: Orders layout/tokens, existing service detail commands, filters, drawers, keyboard/button controls, shell navigation/guards and local browser fixtures. No operational state inferred from payment/clock, no charge/refund from drag.
**Requirement**: ATEND-11, ATEND-12, REG-01, REG-02, QA-02

**Done when**:

- [ ] Actual browser list/Kanban/filter/detail/action gestures share IDs/counts and canonical versioned commands; conflicts retain prior data. Keyboard/mobile alternatives work without drag.
- [ ] Services see Agendamentos and separate Atendimento; products keep existing Orders and cannot open the service route. Plan/role restrictions, reload/back/direct URL/command palette/merchant switching hold; stored Orders history is unchanged.
- [ ] Old/new component regressions, dashboard build/typecheck and local authenticated browser gates pass; share genuine desktop/mobile screenshots and mark complete before an atomic local commit.

**Tests**: New `src/pages/service-appointments-page.spec.tsx`, `e2e/service-appointments-board.spec.ts` root ATEND-11 and `e2e/service-appointments-navigation.spec.ts` root ATEND-12, plus unchanged Orders/shell regressions. Real local API/SQL synthetic appointments and order-only historical sentinel; no PSP/provider.
**Gate**: Browser/UI build: unfiltered new page/view-model and existing Orders/shell/service-management files recorded before execution; dashboard typecheck/local build; `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-appointments-board.spec.ts e2e/service-appointments-navigation.spec.ts`.
**Commit**: `feat(service-business): t103 present service appointments kanban`

### Phase 16: Catalog interaction refinements

### T105: Replace catalog boolean checkboxes with toggles

**What**: Usar o ToggleSwitch existente nos controles booleanos do cadastro de produtos e serviços, com label/estado/foco acessíveis e a mesma regra de valor/payload. Não transformar seleção de itens em preferência booleana nem alterar disponibilidade canônica.
**Where**: `apps/dashboard/src/pages/product-detail/components/ProductForm.tsx`, `apps/dashboard/src/pages/product-detail/components/ServiceScheduleEditor.tsx`
**Depends on**: T98, T108, T107
**Reuses**: ToggleSwitch, ProductForm, existing catalog/service schedule fixtures and local screenshot runner. If another catalog boolean lives in ProductBlockEditor, include only its control and preserve the block payload.
**Requirement**: CAT-03, REG-02, QA-02

**Done when**:

- [ ] Toggles expose their actual accessible name and checked state, support pointer/keyboard and retain disabled behavior, defaults and validation for all affected product/service controls.
- [ ] Existing assertions remain, with only role/gesture updates directly required by the user's control change. Actual local desktop/mobile browser captures show the revised controls and saved/reopened state; no new API/domain writer.
- [ ] Unfiltered affected component tests, dashboard typecheck/lint/build and Browser gate pass, no skipped cases; task marked before its atomic local commit.

**Tests**: Existing catalog/service-schedule component files plus `src/pages/product-detail/components/ProductForm.toggles.spec.tsx` and `e2e/service-catalog-toggles.spec.ts`, verifying gestures and saved values rather than control invocation counts.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/product-detail/components/ProductForm.toggles.spec.tsx src/pages/product-detail/components/ProductForm.business-mode.spec.tsx src/pages/product-detail/hooks/useProductForm.business-mode.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx src/pages/product-detail-page.spec.ts src/pages/product-detail/utils/product-validation.spec.ts src/pages/product-detail/utils/service-schedule-validation.spec.ts`; `pnpm --dir apps/dashboard typecheck`; affected-file lint; `node scripts/service-local-build.mjs dashboard`; `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-catalog-toggles.spec.ts`. Add the concrete existing schedule control file to this unfiltered cohort if inventory finds a separate fixture. All source/resource/owned cleanup guards apply.
**Commit**: `feat(service-business): t105 use toggles in catalog forms`

### T107: Respect the existing advanced-rules entitlement in the editor

**What**: Usar o booleano da feature atual antes do GET de regras avançadas na PromotionSection. Planos sem acesso mantêm o bloqueio existente, sem consulta nem falso alerta; planos habilitados conservam carregamento/edição. Reutilizar cleanup de efeito para ignorar resposta antiga após mudança de plano/empresa/produto. Não alterar planos, assinaturas da fixture para ocultar falha, API, preços ou regras comerciais.
**Where**: `apps/dashboard/src/pages/product-detail/components/PromotionSection.tsx`
**Depends on**: T98
**Reuses**: usePlanFeatures/hasFeature("advancedRules"), current cancelled effect, authenticated catalog API and existing FeatureLock. Exact current HTTP failure is observed before productive repair; no new authorization model.
**Requirement**: CAT-05, QA-02

**Status**: Complete LOCAL -70/70 independent components, types0, seven-file lint0, official dashboard build0, actual3/3 browser plus nativecleanup0; six native captures visually reviewed PASS by Root before task mark. Failed attempts remain in task-107-evidence.json.

**Done when**:

- [x] Starter/unknown-no-feature never start advanced-rules GET, existing basic promotion behavior and lock remain; enabled plan loads the same rules and can still use the existing controls.
- [x] Merchant/product/plan changes cannot apply a stale advanced response or trigger an unsupported follow-up; product and service edit contexts remain separate and preserve existing server permissions.
- [x] New focused component gestures plus actual local browser/API observation prove no unwanted request/false alert for non-entitled companies, enabled access and unchanged server403. Full affected UI tests/types/lint/build and browser pass with readable local captures, zero skips; mark before one atomic local commit. Own API artifact is re-admitted when its inputs/outputs/generated client remain identical; no redundant rebuild or foreign artifact reuse.

**Tests**: New `src/pages/product-detail/components/PromotionSection.entitlement.spec.tsx` plus unchanged independently committed T98/catalog cohorts and `e2e/service-catalog-entitlements.spec.ts` using real local API/SQL and declared plan fixtures. Retain every prior gesture/payload assertion and expose the real network outcome; no response stubs to manufacture the production gate.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/product-detail/components/PromotionSection.entitlement.spec.tsx src/pages/product-detail/components/ProductForm.business-mode.spec.tsx src/pages/product-detail/hooks/useProductForm.business-mode.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx src/pages/product-detail-page.spec.ts src/pages/product-detail/utils/product-validation.spec.ts src/pages/product-detail/utils/service-schedule-validation.spec.ts`; dashboard typecheck, affected-file lint, `node scripts/service-local-build.mjs dashboard` and `pnpm --dir apps/dashboard exec playwright test --config playwright.service-entitlements-local.config.ts e2e/service-catalog-entitlements.spec.ts`. Dedicated config inherits the existing guards/reporters/timeouts and selects only107; its thin service-catalog-entitlements-setup.mjs wrapper calls shared setup with static catalogEntitlements:true. Default protected setup retains its old testMatch and creates no107companies. Tests/fixtures must be independently present at107commit, without importing uncommitted105fixtures. Record exact companions before execution, no old oracle weakening or provider traffic.
**Commit**: `fix(service-business): t107 honor advanced rules entitlement in editor`

### T106: Link existing professionals from the service editor

**What**: Mostrar profissionais vinculados e permitir adicionar/remover vínculos no serviço salvo, apenas em empresas de serviços, usando a API existente com paginação e expectedVersion. O novo cadastro explica que o serviço precisa ser salvo; após salvar, o operador chega ao vínculo sem recriar o serviço. Respeitar proprietário/admin, manter os outros productIds e mostrar erro parcial/conflito com recuperação explícita.
**Where**: `apps/dashboard/src/pages/product-detail/`, existing dashboard API client and new service-professional link component/hook only as required.
**Depends on**: T105, T107, T18
**Reuses**: GET/PATCH /merchants/:merchantId/service-professionals, productIds/expectedVersion CAS, existing authenticated client and canonical business mode. Reusable professional client supports later T76 rather than a second association authority.
**Requirement**: CAT-04, AGENDA-01, ATEND-02, REG-02, EDGE-01, QA-02

**Done when**:

- [ ] Service editor loads all pages truthfully, shows linked professionals and supports authorized save/unlink for active professionals of the current company; product mode does not request or show these controls. Empty/loading/error/staff states are explicit.
- [ ] Each update preserves other service links and uses its current expectedVersion. Conflicts stop stale overwrites; partial failures identify saved/failed links and permit retry without duplicate service creation. Tenant/mode/item changes cannot apply stale responses or updates to the new context.
- [ ] Component tests and real local API/browser gestures prove create-then-link, reopen/unlink, other-link preservation, forbidden/foreign/stale/error cases and responsive captures. Dashboard types/lint/build and Browser gate pass; task marked before one atomic local commit, zero provider/production actions.

**Tests**: `src/pages/product-detail/components/ServiceProfessionalLinks.spec.tsx`, necessary authenticated client/hook tests and `e2e/service-catalog-professionals.spec.ts` with actual local API/SQL and two companies. Existing catalog and professional API tests remain unchanged.
**Gate**: Browser: `pnpm --dir apps/dashboard exec vitest run src/pages/product-detail/components/ServiceProfessionalLinks.spec.tsx src/pages/product-detail/components/ProductForm.toggles.spec.tsx src/pages/product-detail/components/ProductForm.business-mode.spec.tsx src/pages/product-detail/hooks/useProductForm.business-mode.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx`; `pnpm --dir apps/dashboard typecheck`; affected-file lint; `node scripts/service-local-build.mjs dashboard`; `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-catalog-professionals.spec.ts e2e/service-catalog-business-mode.spec.ts`. Record necessary concrete companion paths before execution and preserve API guards, all old behavioral assertions and real resource admission.
**Commit**: `feat(service-business): t106 link professionals from service editor`

### Phase 17: Revision-bound final acceptance

### T95: Collect revision-bound acceptance evidence

**What**: Coletor valida cobertura de todos os critérios atuais da especificação (81 neste plano), teste selecionado executado sem skip, revisão/API/frontend e origem local/provider de artifacts; gera matriz/report de evidências sem atribuir aceite remoto a mocks. T108 native guard evidence and original affected consumer reruns remain distinct.
**Where**: `apps/api/tests/service-acceptance-report.mjs`
**Depends on**: T94, T97, T98, T101, T103, T106, T72
**Reuses**: Contratos e componentes da seção Code Reuse Analysis do design; runtime local T2 e runner existente, sem trocar a autoridade de produtos.
**Requirement**: QA-01, QA-02, QA-03, QA-04

**Done when**:

- [ ] Resultado descrito em What demonstrado; autorização/estado e negativas aplicáveis cobertos sem alterar comportamento aprovado de produto.
- [ ] service-acceptance-report.spec.mjs named QA-01: HEAD divergente/zero casos/skip/claim sem prova/critical falho/print preview mislabeled bloqueiam; relatório final só completo após check_proofs e verificação independente.
- [ ] Gate Full passa, contagem executada registrada e testes existentes preservados. Tarefa marcada e commit atômico próprio; sem push/deploy.

**Tests**: service-acceptance-report.spec.mjs named QA-01: HEAD divergente/zero casos/skip/claim sem prova/critical falho/print preview mislabeled bloqueiam; relatório final só completo após check_proofs e verificação independente.
**Gate**: Full: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^T95$" ./tests/service-acceptance-report.spec.mjs` Teste raiz T95 exercita o resultado desta tarefa e seus subcasos; pelo menos um executado, nenhum skipped. Os checks finais por ID abaixo continuam obrigatórios.
**Commit**: `feat(service-business): t95 collect revision-bound acceptance evidence`

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
Tasks: T4, T18, T20, T21, T76, T106.

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
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-ai-dispatch-fence.integration.spec.mjs ./tests/whatsapp-ai-dispatch-http.integration.spec.mjs ./tests/whatsapp-ai-request-commit.integration.spec.mjs ./tests/whatsapp-human-message-router.integration.spec.mjs`
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
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag.integration.spec.mjs ./tests/business-rag-work.integration.spec.mjs ./tests/business-rag-writers.integration.spec.mjs ./tests/business-rag-index.integration.spec.mjs`
Tasks: T4, T21, T63, T64, T65, T66, T104.

**C32** - WHEN uma fonte é retirada ou despublicada THEN the system SHALL impedir seu uso como evidência ativa e retirar sua projeção, sem recuperar texto antigo como resposta atual. (RAG-02, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^RAG-02$" ./tests/business-rag.integration.spec.ts`
Tasks: T65, T67, T68.

**C33** - IF embeddings ou grafo estão indisponíveis THEN the system SHALL conservar o cadastro canônico e registrar a indexação pendente para nova tentativa, sem desfazer o cadastro nem inventar uma resposta. (RAG-03, AC 3)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/business-rag-work.integration.spec.mjs ./tests/business-rag-index.integration.spec.mjs ./tests/business-rag-backfill.integration.spec.mjs`
Tasks: T64, T66, T67, T104.

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
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 ./src/modules/graph-rag/domain/public-business-query.spec.ts ./src/modules/graph-rag/gateway/public-business-transport.spec.ts ./tests/business-rag-public-query.integration.spec.mjs`
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
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 ./tests/whatsapp-ai-dispatch-fence.integration.spec.mjs ./tests/whatsapp-ai-dispatch-http.integration.spec.mjs ./tests/whatsapp-ai-request-commit.integration.spec.mjs`
Tasks: T48, T51, T56.

**C71** - IF a fonte contém instruções para executar ferramentas ou revelar dados THEN the system SHALL tratá-la somente como conteúdo recuperado, sem conceder autoridade operacional. (EDGE-05, AC 5)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test --test-concurrency=1 --test-name-pattern "^EDGE-05$" ./tests/service-boundary.integration.spec.ts`
Tasks: T70, T71.

**C72** - WHILE a modalidade canônica é `services` the system SHALL permitir adicionar pelo botão "+", editar, remover, salvar e reabrir uma lista de nomes de serviços em Dados da empresa e usar somente os nomes públicos salvos como contexto do RAG, ocultando e recusando sua edição para empresas de produtos e retirando esse contexto quando a modalidade mudar para produtos. (ONB-06, AC 1)
Proof: `pnpm --dir apps/api exec node ./tests/service-company-services-proof.mjs`
Tasks: T96, T97, T63, T72.

**C73** - WHILE a modalidade canônica é `products`, WHEN o operador abre o cadastro THEN the system SHALL oferecer apenas tipos físico/digital/alimentação, sem cadastrar serviço e preservando a guarda existente. (CAT-01, AC 1)
Proof: `pnpm --dir apps/dashboard exec vitest run src/pages/product-detail/components/ProductForm.business-mode.spec.tsx -t "^CAT-01"`
Tasks: T98.

**C74** - WHILE a modalidade canônica é `services`, WHEN o operador abre ou limpa o cadastro THEN the system SHALL mostrar "Novo serviço", manter tipo service no padrão/reset/envio e não converter silenciosamente um registro carregado. (CAT-02, AC 2)
  Proof: `pnpm --dir apps/dashboard exec vitest run src/pages/product-detail/hooks/useProductForm.business-mode.spec.ts src/pages/product-detail/hooks/useProductDetailPage.business-mode.spec.tsx`
Tasks: T98.

**C75** - WHEN an authorized operator saves or clears the private support fallback recipient THEN the system SHALL preserve public FAQ versions and keep the recipient outside public storefront/RAG data. (HUM-09, AC 1)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-09$" ./tests/support-notification-settings.integration.spec.mjs`
Tasks: T99, T101.

**C76** - WHEN a new human case is confirmed THEN the system SHALL queue one private staff WhatsApp alert per case/epoch and preserve truthful unavailable/unknown delivery state without moving the customer conversation. (HUM-10, AC 2)
Proof: `pnpm --dir apps/api exec node --import ./tests/test-network-guard.mjs --test --test-concurrency=1 --test-name-pattern "^HUM-10$" ./tests/support-case-alert.integration.spec.mjs`
Tasks: T100, T101.

**C77** - WHEN the operator opens Agendamentos THEN the system SHALL show coherent canonical appointment Kanban/list views with six operational statuses, separate finance, filters and versioned actions. (ATEND-11, AC 1)
Proof: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-appointments-board.spec.ts --grep "ATEND-11$"`
Tasks: T41, T74, T102, T103.

**C78** - WHEN a service business opens navigation THEN the system SHALL use Agendamentos as its primary Orders replacement, preserve separate Atendimento and historical orders, and deny the service route to product businesses. (ATEND-12, AC 2)
Proof: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-appointments-navigation.spec.ts --grep "ATEND-12$"`
Tasks: T82, T83, T103.

**C79** - WHEN o operador altera configuração booleana no cadastro THEN the system SHALL apresentar toggle acessível e preservar valor, validação e persistência. (CAT-03, AC 3)
Proof: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-catalog-toggles.spec.ts --grep "^CAT-03"`
Tasks: T105.

**C80** - WHEN a service business links professionals in the saved service editor THEN the system SHALL preserve tenant, other service links and version conflicts, without duplicate service creation or false partial success. (CAT-04, AC 4)
Proof: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-local.config.ts e2e/service-catalog-professionals.spec.ts --grep "CAT-04$"`
Tasks: T106, T76.

**C81** - WHERE current plan lacks advancedRules THEN the system SHALL retain the feature lock without requesting advanced rules or applying stale responses, while preserving entitled access. (CAT-05, AC 5)
Proof: `pnpm --dir apps/dashboard exec playwright test --config playwright.service-entitlements-local.config.ts e2e/service-catalog-entitlements.spec.ts --grep "^CAT-05"`
Tasks: T107.
Result: PASS LOCAL - actual3/3 plus nativecleanup0 at2026-11-16T21:13:11.003Z; independent70/components, types/lint/build and six native captures reviewed PASS. See task-107-evidence.json; no105/106/final-feature claim.

## Handoff

**Integrated T55:** Exact worker commit 5a10fad61 contributes authenticated receipts and relay startup repair. Gates727 components/173 native/2 compiled/224 products/privacy7 and all9 header checks passed on its own2552/e48c/7c49 artifact. Root keeps the71 model-script delta uncommitted beside the staged55 worker blob. Earlier failures remain recorded. Combined Root API requires a fresh checked build; no integration runtime or remote action claimed. M56 source-only; C sole runtime for105.

**Integrated local T77:** Cc1439c7b9 current187/16,lint15,current API admission and wholeBrowser4/eight native pictures passed with original quotas. Root reviewed five changed/new pictures and three byte-equal originals. Integrate25 exact C blobs plus scoped task/state metadata, preserving Root71 source work. User visual feedback remains pending; no105/106/78 or API/package/schema changes.


**Integrated local T76:** Cbf9a4043e (supersedes unintegrated c76b47184 encoding attempt) carries corrected service-binding toggles, current150 components/lint14/Browser4 and8 actual native pictures. Root reviewed five changed pictures and verified three other pictures byte-exact to already viewed states. Functional SQL/CAS/foreign/history/focus checks preserved. Root integrates24 exact C blobs and only two scoped metadata files, preserving all current71 sources/approvals/dependencies. User visual review is pending asynchronously; no fabricated approval/final screen-verifier claim. T77 remains next C source; M types/checked is the sole runtime.


**Root T76 corrected visual review passed:** Root viewed the four changed edit/service-binding desktop/mobile native pictures, plus changed inativo desktop. The other three current pictures are byte-exact to previously viewed originals. Labels and switches are aligned/readable, controls preserved and no native checkbox border remains. Corrected150/13+lint14+Browser4 natural0,51.7s,0skip/flaky,normal cleanup/knownC0 and sourcefreeze64948b73 support local T76 completion. This is incremental technical review, not fabricated user/final screen approval. C may mark76 and create its focused local atomic commit, excluding77/105/106/cache/unrelatedAPI. Aftercommit continue T77 source as wholePhase10 owner. No further C SUT now.

**Dispatched M corrected types/checked continuation:** C48942 returned normal all resources. M now has sole runtime for test-annotation-only correctedfreeze5a64bc62/830eda17: affected lint, original full types, then one ordinary fresh checked API under5168/default compiler policy. Original727 runtime/assertion-equivalent proof stays retained, no repeat merely for removed type annotations. Stop first error or after record and return before172native. P/C/Root source-only, metadata/git commits allowed. Root71 current source is not compiled/tested since the initial177 helper cohort; pending consumer/live additions must not inherit that gate.


**M type boundary / dispatched corrected C76:** M727/lint passed, but actual full types returned2 on new test-only getSingleMetric<Gauge>: installed generic expects a string. No checked capture/build/native started. All own processes closed. M may correct only that type argument/unused type import, preserving every7 test body/outcome and productive73740470; no permission question is needed for a type annotation repair with unchanged oracle. M remains source-only until next handover. C now receives sole runtime for adoptedToggle freeze64948b73: corrected150 components,lint14,list4,current own artifact admission and complete Browser4/eight new native pictures. Stop first error, preserve old receipts and same ratios/budgets/negatives. Root/P/M source-only. T30 already integrated17a8a6ed3; T76 remains open pending this visual verification.


**Root71 concrete source progress after T30 merge:** Root17a8a6ed3 now includes confirmed at-attendance core. New unexecuted71 source binds Storefront generated turns to openBusinessAnswer/captureBusinessKnowledge, original classifier first, paid initial12/global20, narrow company/hours only, last-copy final session fence and service-only audit before agent history. Server-only groundedBusinessContext removes old direct prompt facts without changing product prompts/body schemas/handlers. PublicBusinessLiveTools+8 new criterion tests resolve unique canonical variants, require linked-pair admission and register only a final read; synchronous renderer consumes current price/slots/public SQL labels. No booking/payment writer or body holdOwner authority. Actual native composition18 expected is only source, not a result. Factory/DI/audit/Support candidates and live envelope binding remain P cache work; Root imports refer to the agreed forthcoming ABI and current API artifact is stale. All new/affected components, fresh build, actual served/native tests and product regressions remain mandatory. Initial177 helper gate is historical for its exact earlier source, no current completion claim. C76 adopted4-pathToggle patch/sourcefreeze64948b73, no gate yet; M727/lint green, owns types/build window.


**Reviewed C76 toggle proposal for adoption:** Root read four-path patchb5d06557. Native checkbox->existing ToggleSwitch is the user's explicit control preference. The added click+aria-checked before/after assertions preserve or strengthen the original selected-state checks; all business payload/SQL/CAS/foreign/history/focus checks remain. C may verify originalfreeze62, back up/adopt only these4 candidates and prove inverse/other-file preservation. No runner while M21759 owns units/checked. Preserve150 functional tests and eight original native pictures; corrected gates/new8 captures still required before T76 close. Do not broaden global CSS or backend.


**Integrated local T30:** P7d0643cbf Full324 (100 actual native/48 ordinary products/176 widget), own checked2553/c88a769d/023fee86 and normal owned cleanup reviewed. Root integrates the exact20 nonshared-metadata blobs, scoped spec patch and T30 task section, preserving all Root71 dirty sources and current statuses/approvals/dependencies. This closes local at-attendance confirmation only; manual31, attendance32, lifecycle/payment and final independent validation remain open. No remote action.


**T76 visual review / C correction:** Root viewed all8 actual CRUD76 pictures after150 components/lint14/Browser4 green. Functional proof is retained, but service-membership controls are oversized native checkboxes with squeezed labels. User already requested "trar checkbox por toggle"; apply that to these rows using the existing ToggleSwitch and consistent label/control alignment. C prepares a minimal source/test-locator delta, preserving selected productIds, every old outcome/negative/CAS/history/focus assertion and backend payload. No T76 mark/commit until corrected affected gates and fresh8 pictures. This is direct execution of the user's control preference, not a new product decision; do not ask again. No global style rewrite.

**Reviewed M production startup repair / next runtime:** Root read relay proposal8358298f and the entire new real overlap native. Same repeat job gets immediately:true, creation moves to ApplicationBootstrap after current handler init, ready requires actual completed round. Existing cron/pacing/55s window/concurrency/DB claims/leases/idempotency and all old4relay/old54oracles stay exact. Prepare a revision that omits only the cache-only dependency-ABI test/import (it tests BullMQ rather than a feature); retain it as source research, not a productive test. New readiness3 plus old4 component outcomes and the actual two-relay PG/Redis effect/marker1 native are required. M may adopt those reviewed3 paths with before/inverse/preservation proof; original own artifact becomes stale. C has returned all resources; M receives next sole runtime for affected components/original55 unit gate, lint/type checks and one ordinary fresh own checked build, stopping on first failure and before any native until its next boundary. P/C/Root source-only; no old test warmup or oracle change.


**Dispatched C76 Full browser window after P30:** P returned all T30 Full324 green (100 actual native,48 ordinary products,176 widget), original own checked2553, natural0/normal cleanup, no further runner. P may close30 metadata/focused local commit and continues71 cache only. C now receives sole runtime for its frozen62 inputs8e5a832f and source-ready cabbd115: components150/13,lint14,list4,own artifactfa8c/1d61 admission,wholeBrowser4 with8 fresh native CRUD76 pictures. Original budgets, ratio/dimensions, old assertions and all negatives retained; stop at first error. These four cases prove owner create/edit/CAS/link/focus, deactivate/reactivate/history and product/Staff denial; no75 recapture. Root/P/M source-only. Root71 current helpers177 passed before new prompt/consumer source changes; those changes and served/live71 remain unexecuted and incomplete.


**Dispatched P30 Full continuation:** P ordinary fresh checked build completed natural0 with2553 sources,inputc88a769d/artifact023fee86, original5168 policy admitted6765. Source/receipt preservation remains required. P retains sole runtime for its already prepared whole T30 Full cohorts100 native +48 ordinary product +176 widget, with original guards/own artifact and no filters/skips; stop at first failure. Do not repeat the fresh build or unchanged component cohort without a changed input. Return actual counts/cleanup before31 runtime. C76 browser and M55 startup proposal remain source-only; Root71 prompt/consumer preparation also source-only. T30 stays open until Full, metadata and focused commit.


**Dispatched P Phase4 checked-build window:** Root initial71 components passed177/177 in22.94s,0fail/skip/cancel/todo, natural0; actual native/consumer/fresh build still pending. C browser76 is not ready yet (four owner/negative cases being written), M relay proposal remains source-only. P now receives sole runtime to run its already prepared ordinary fresh checked API gate for T30 with its frozen20 WIP, original resource/coverage/compiler policy and own artifact only. No consumer71 productive adoption during that build; cache source may continue. Stop/return after current ordinary preflight refusal or checked build record; no T30native/product/widget start until next boundary. Root/C/M source-only. No stale artifact or repeated unchanged cohort admits completion.


**Dispatched M startup analysis / Root71 components:** M65 stopped after19 executed(17pass2fail): receipt-db10green, old54 delivery9 had one15s terminal child failure plus parent. Actual queued/attempt0 and ready1/lastcompleted0 observation is retained; four files46 remain unexecuted. All owned resources returned normally. Root source inventory shows the real OutboxBullMqRelay schedules only a minute cron and declares Redis/worker readiness before any dispatcher round. This permits a startup waiting interval; it does not by itself prove every historical failure cause. M receives source-only review of the smallest ordinary production startup/readiness repair and existing installed BullMQ ABI, preserving job locking, dispatcher/idempotency and all old54oracles; do not apply another test warmup or productive change yet. Root receives sole runtime for T71 helper/legacy affected components via .cache/run-t71-gate.mjs components; no checked/native gate yet while consumers are still being prepared. C/P/M source-only.


**T71 initial productive source checkpoint:** Root630c25d0f satisfies70 dependency. Six reader/session/live files/specs adopted mechanically from reviewed cache packets; receipt .cache/t71-initial-adoption/receipt.json. One additional session criterion test and coverage metadata explicitly deny complete-catalog/live-value authority from selected quoted context. Native composition test apps/api/tests/business-rag-compose.integration.spec.ts prepares15children+root with actual owned SQL/Redis, real billing/canonical/session/admission and synthetic seeds; no executed result or served/model-quality claim. P prepares actual service-mode-only QueryKnowledge/Support/DI consumer, preserving product legacy provenance and paid gates; narrow existing_support_faq purpose only preserves already allowed FAQ. No general entitlement change. All71 files are unparsed/unexecuted while M owns65. C76 components149/lint8 passed; browser76 still source preparation. M12/12 passed normally and is now running65 focused files under its own unchanged2552 artifact. No other executor.


**Dispatched M55 native window after C149:** C returned149/149 components in13files,18.89s,0fail/skip and lint8 zero errors/warnings, no productive change during gate. M now receives sole runtime for the whole12 receipt file with adopted7c7e096d, original launchercd876d2b, own2552 artifact admission and all guards/budgets unchanged. If and only if all12 pass with normal cleanup, continue the remaining65 focused cases in their full six files, no name filters or repetition of724/build. Stop and report at any failure or after that65 cohort before the remaining94/compiled/product/frontend gates. Return actual counts/logs/cleanup, never combine previous green halves as a full pass. C/P/Root source-only while M owns runtime.


**Reviewed M readiness revision before adoption:** Root read candidate7c7e096d/new helper against6496fe36 and its reverse manifest0d6f1721. Only native fetch/stream transport errors in the closed list retry within the same110s setup, each request at most1500ms,200ms poll and600s outer; terminal15s/20ms and all12 business case bodies/oracles remain exact. Unknown errors, HTTP/body/metric contract failures are strict; actual ready1/current lastcompleted>0 response is required. Every diagnostic is best-effort protected and emits no raw exception/private values. M may back up/adopt precisely this fixture-only candidate and verify inverse/other-file/current-artifact preservation. No runner yet while C owns149/lint; Root grants no productive API or delivery retry, no past-cause claim.


**T70 Full passed / next runtime C:** Root native88080 returned natural0,13/13 with normal cleanup and zero provider calls; whole906 components, current checked2554 and12 existing ownership contracts are green. No earlier opaque failure cause is claimed. Root is closing70 locally. C receives sole runtime for the prepared T76 affected149 components and lint only, preserving all original assertions. Browser76 must be prepared and explicitly handed over separately. M/P/Root source-only during this window; no builds/native/OS probes elsewhere.


**Dispatched P concrete T71 integration preparation:** P may prepare source-only cache candidates for the actual QueryKnowledge/Storefront/Support consumer and DI seams, using existing canonical-reader/session drafts and Root live-reader. No productive adoption before T70Full, no new public capability or entitlement, no SUT/parser/build/probe. Return executable source candidates and criterion-derived tests with exact original source hashes, not another general design. Preserve all Phase4 WIP and earlier packets. Scope final freshness after the last model/copy/tool await and before history/audit/response, direct company/hours too; retain original channel/tenant authority and truthful partial coverage. Root remains Phase9 author/integrator. Root public native session88080 is sole active executor.


**Dispatched source preparation after T75 integration:** Root committed T75 locally as 41ebc9084, with the 23 exact tested C blobs and two scoped metadata files. C continues whole Phase 10 with T76 source/tests only. M receives source-only preparation of a bounded read-only transport readiness poll: transient fetch/stream failures may retry only inside the existing 110s setup allowance, preserving 1500ms per request, 200ms poll, outer 600s and the unchanged 15s post-enqueue oracle. HTTP/body/metric contract errors remain strict. Add best-effort sanitized observations that cannot replace the original error; no business command/message/dispatcher retry, timing increase or productive API change. Return candidate/review packet before adoption. P remains source-only with Phase 4 and T71 packets preserved. Root owns the next runtime window for existing ownership/cleanup contracts and the complete T70 native file after exact reviewed R2 adoption. No other SUT/build/browser/OS probe may run.


**Integrated local T75:** C commit6e283648 was reviewed after117/117 components, lint11, real Browser3 and eight native pictures. Root applies its23 nonshared-metadata blobs exactly and composes only the T75 task section plus current Handoff/state, preserving all Root approvals/dependencies/history and19 dirtyT70 source paths. The base page is complete locally; CRUD/global navigation/final acceptance remain later tasks. No production or final independent-screen approval is claimed.


**Dispatched P diagnostic revision review:** Root preserved rejected v1/f35882b4 and prepared separate source-only r2 packet .cache/t70-native-diagnostics-preparation-r2, patchb1c9bd3479658c44231119207df6ec077b9216c74e8d2a3a9c38bf4f6fc154c6. Both index and socket observations now cannot replace the original exception. The new stderr/runtime parser is removed entirely: runtime remains byte-exact. Only two MJS candidates remain; the original socket error instance/code/stack/message prefix are retained and may gain an explicitly sanitized enums/booleans suffix. No new stderr raw-buffer path, authority, guard acceptance, close behavior, TS/schema/query or budgets. All12 native case bodies/finally exact; forward/reverse git checks0. P may review only these deltas for the two findings and any new concrete issue, no import/parser/tests/adoption. Preserve all P work. M13952 currently owns the runtime; Root retains integration and later contracts/13native gating. No finalVerifier claim.


**Root T75 local gate review completed:** Root viewed all8 actual native pictures from C36268/e8aca7df, including the fully readable mobile grade with08:00?12:00 and the saved block. Desktop/mobile professional data and denied product/Staff states show intended content and isolation; mobile pictures are explicitly scrolled views. No image edit, UI/ratio/viewport/time change. Combined gate is117/117 components, lint11/list3, ownAPI2543/fa8c/1d61 admission and Browser3 natural0/0skip/0flaky, normalACK/disconnected/knownC0, frozen41SHA18dfb095. C may now finish T75 metadata/traceability and one focused local atomic commit, excluding105/106/76/77/cache/unrelatedAPI. This is Root's incremental technical review, not user approval or the final independent screen verifier. Actual global navigation/routes and CRUD remain their later tasks. After75commit C may implement T76 source from the reviewed cache as wholePhase10 owner; no SUT runner while another owner holds runtime.

**Dispatched M55 prepared-consumer native window:** C36268 has returned all runtime resources normally. M now receives sole runtime for the whole12-case receipt file with adopted6496fe36 preparation and original failure observer; exact2roots/10children,15s/20ms/outer600s and all payload/assertions unchanged. Use the existingcd876d2b launcher and own2552/fa15/7dfe artifact admission, original2048guard, no build/724repeat. Await actual consumer progress, no artificial dispatcher/warmup/send/clock/cron change. Return actual12 totals plus readiness observations and cleanup. Do not automatically start remaining65/94/2/product/frontend selections before the next boundary. Root/C/P source-only; C's metadata validators/git commit do not run SUT checks.


**Reviewed T55 real transport preparation:** Root read exact candidate6496fe36d3bbf242446393759b396f830d7848401a5949f0fecdd9fceaa87e60 against actual failed observations. Three setup-only changes import the existing boot constant and await read-only live metrics ready1/finite lastcompleted>0 before creating receipt cases/enqueue. Missing, invalid or nonprogressing transport still fails honestly. The precondition uses existing110s boot allowance inside the unchanged600s outer case; original15s terminal/20ms polling, all10children/two roots, assertions, messages, signatures and failure observer stay byte-exact. No dispatcher/job/warmup send, clock/cron, production source or existing timeout changes. This repairs a missing fixture readiness condition, not a changed expected application outcome. M may verify91128aa9, back up and adopt only this candidate, prove inverse identity and preserve old54dbd/a981 plus own2552 artifact. Source-only while C36268 runs; one whole12-case native gate still requires a later explicit runtime handover. No retrospective production cause or delivery proof is inferred.


**Dispatched C75 centered native recapture:** M55 diagnostic31234 completed natural1, two roots failed before children; each showed queued revision0, outbox pending/attempts0/no lease/no handler, IPCsend0, metrics ready1/lastcompleted0. Both fixtures closed normally and ownPIDs0; no further runner. No delivery/clock/cron cause is inferred beyond those facts. M prepares only a real-consumer readiness precondition within existing budgets, no message/dispatch/warmup action. Root read and verified camera patch d44dcb4b: one added instant center scroll of the SAME target after each native viewport change, preserving ratio1, dimensions, hit/overflow/banner, UI, all expectations and budgets. C may apply exactly after41hash/reverse checks, then owns sole runtime for lint/list3/ownAPI2543fa8c1d61/wholeBrowser3 with8actualpictures.117components unchanged remain valid. Root/M/P source-only; no T75 completion until true mobile body framing passes and Root views it.

**Dispatched P source-only diagnostic review:** P may inspect Root cache .cache/t70-native-diagnostics-preparation, patch f35882b4ef1d5172222ae849758892792e965737955d68d5e7ed50eb7fb6608b, without adopting or executing. Check actual-adapter operation observation preserves every result/exception/authority and all12case bodies, socket rejection still denies every unproven replacement, stderr diagnostic exact allowlist emits no private values and existing cleanup semantics/budgets remain. Three MJS candidates only, zero productiveTS/schema/query/guard changes. Report concrete gaps; this is incremental review, not final independent verification. Preserve P20T30WIP and all old/new71 packets. Root remains author/integrator and C holds runtime.


**Dispatched M55 whole-file failure diagnostic:** C75 recapture55362 ended natural1,2/3 pass/normal cleanup/knownCnodecmd0; entire-panel ratio1 returned0.9997545 near the mobile bottom edge. No threshold/viewport/UI change or T75 completion. Eight original images/run4667 remain archived; mobile grade was not newly saved. C is preparing only explicit centering of the SAME panel while keeping ratio1 and every original invariant, source-only. Root reviewed the exact M diagnostic launcher cd876d2b and its original2048/environment/artifact checks; it selects the whole12-case receipt file without a skip-producing filter. M now gets the only runtime for ONE invocation on own current2552/fa15/7dfe with adopted failure-only observer91128aa9. No source repair, cron/warmup, clock/deadline/oracle change,724repeat or rebuild. A failure must retain safeSQL/gauge/IPC observations and original error; a pass alone proves no retrospective cause. Return actual12 counts and normal owned cleanup before another selection. Root/C/P remain source-only.


**Dispatched C75 recapture after Root native failure:** Root70 actual13 results are11pass/2fail/0skip/natural1: child07 index drain returned canonical_unavailable after a withdrawal/republication; the parent also failed strict Redis socket identity during app cleanup. The underlying index error and replacement-socket cause were not captured; no source fix/guard relaxation or T70 completion follows. Runtime.close attempted worker termination and all owned graph/Redis/Postgres disposal; no disposal/bridge errors were appended, but API cleanup proof failed and must remain failed. Subsequent read-only exact Root workspace/runtime-worker filter found0; no process or global resource changed. Root has no active runner. C now receives sole runtime for frozen41SHA6e28c4a4 one-line grade panel capture change: affectedlint/list3/ownAPI2543 fa8c1d61 integral admission then originalBrowser3/8nativecaptures/normalcleanup. No117repeat, UI/assertion/budget change or image edits. Root must view grade mobile body before75mark/atomiccommit. Root/M/P source-only; M's exactfailure-only12 diagnostic is next safe opportunity, and Root70 diagnostics will preserve13/all original assertions/strictcleanup.


**Dispatched bounded T71 original-query addition fence preparation:** Root identified a concrete remaining seam in the unintegrated P canonical-reader proposal: recheck validates only selected slices/accepted pairs. After the last model await, a new public FAQ/service or newly valid originally requested pair can appear while existing selected hashes stay unchanged. An initial complete scoped list/absence could then ground a stale completeness/negative claim. P may prepare a separate cache-only revision retaining the immutable original bounded read request in the opaque selection and re-evaluating that SAME canonical selector inside the final existing merchant-scoped transaction solely to compare the selected identity/hash/pair set and completeness/cursor. A changed result must reject the old answer, never replace its references or authorize it by a new semantic search. Preserve old handles/tenant/pair/max20refs/max100identities/private-only-version behavior, billing, stored namespaces and gateway policy. Write criterion additions before revised draft code; preserve all old14/13case packets and20T30WIP byte-exact. Pair reads remain non-exhaustive; public text must never infer whole-catalog counts from a selected subset. No productive71 before70Full, no imports/parsers/tests/build/probe or nestedagents. Root retains integration/native proof; Root70native81149 is sole runtime.


**Reviewed T75 grade capture framing patch:** Root inspected and verified exact SHA6fed3d5bdb5831acf696b0d82b689fdb1a4e58efd6e9d0143bc576536b5ad44b. The sole line changes the grade capture target from the button to the exact Disponibilidade tabpanel. Existing helper now requires the whole panel visible at each native viewport; expected grade text, requests, SQL snapshots, filters/reload, dimensions, timing, helper and all other assertions are untouched. C may apply only this reviewed patch after checking frozen41 inputs and record direct/reverse identity. Keep all earlier8 images and run4667004e. This is source-only while Root70 checked62862 runs; no new C lint/browser/import/probe until explicit handover. After actual recapture Root must see mobile grade rows before T75 completion.


**Root actual8-picture review finding (before sending):** Root viewed all8 real C75nativePNGs with view_image, not headers/proposals. Professional desktop/mobile and four denied states are readable and show intended isolation. Desktopgrade shows actual08:00?12:00/block. Mobilegrade currently frames only Gradecadastrada/Consultargrade near bottom; rows are belowthefold, so that picture doesnotshow the claimed gradebody. This is captureframing insufficiency, not a provenUI/data failure. KeepT75open until actualnative recapture shows gradebody. C may prepare ONLY changing the grade capturetarget fromConsultargradebutton to exact Disponibilidade tabpanel; existing capture requires entiretarget inviewport/hit/overflow/banner, strengthening visible-state proof without changing productUI, dims,expectedgrade/API/SQL assertions or budgets. Preserve all8old captures/run4667004e and productivefreeze. No newcomponentrepeat; after separateRootruntimehandover affectedlint/list/currentownartifact/wholeBrowser3 and8nativeimages, then Root reviews replacementbody beforemark/atomiccommit. Root70checked62862 currentlysole; Csource-only. This review is incrementalauthor-side, finalfreshscreensreview remainsafterlasttask.


**Dispatched Root70 ordinary build window after C75green cleanup (before execution):** ActualC75browser67890passednatural0,3/3expected/0unexpected/0skip/0flaky, owner33.1s/products9.2/staff7.6;8nativePNGscaptured1440x1000/390x844, normalACK/disconnected/knownCnodecmd0/freeze41exact45cdbf4d. Fullpacket4667004e. Rootvisualreviewstillrequiredbefore75mark/commit. AllC API/DB/browser resourcesclosed materiallychanges priorresource state, so Root takes sole runtime for ONEunchangedordinary5168T70checked attempt after closure, without906repeat/sourcechanges. If true0/currentartifact, actualpublic13 followsoriginal2048; noNativeagainststale99artifact. If beforechildrefusal, retainreceiptandhandnextM55diagnosticwhole12(onowncurrent2552)slot, no busyretry. RootmayviewactualC8imagesduringownbuild; viewingartifacts isnotanotherSUTexecution. C/M/Premain source-only. C75localcommitaftervisualreviewwillnotmodifyN until compiler/nativeinputscloseandfocusedmergebackup.


**Reviewed M55 failure-only observation (before sending):** Root read source of existinghelper whatsapp-operator-delivery-diagnostics.mjs and exactcachecandidate91128aa92f8bba68f961e41914aae69ce18847c33441f2c2f0bbbc1e22000582. Oneimport plus catch onlyafter originalterminal15swaitfailure; logs sanitized exactcorrelation localIPCcount and existingparameterized scopedSQL/gauges, then rethrows originalerror. No assertion,payload,poll,15sbudget,callback,fixtureprovider/auth/repository,writer/scheduler/clock/retry/dispatch changes. M may back up/verifybefore6761d9d4, adopt onlythiscandidate, prove twoinsertionsremovedrecoverexactoriginal and hashalloldinputs now source-only duringC75. Existinghelper54 a981 remainsbyte-exact. NoAPIcompilerinputchange or rebuild is implied. ONE actualwhole12case nativefile on its owncurrentartifact may be run onlyafter nextexplicitRootruntimehandover; firstfailure7 and missingcausaldata retained. A laterpass alone doesnotestablishfirsttickcause; no productiverepair or deadlineincrease from speculation.


**Dispatched C75 semantic locator browser window (before sending):** M55firstnativefile endednatural1,TAP7/pass6/fail1/skip0, Meta setup originalreceiptnotsettled; Twilio fivechildren+rootpassed. No otherfocusedfile ran. BothownedruntimesclosedACK/disconnected/finallywithoutcleanupfailure; knownM38340/29208/directchildren0,proof1e2ecaf5. Cause unproven; M source/cachediagnosis only, no SUT/oraclechange or rerun/build. Root receives slot and now hands sole runtime to C75 frozen41SHA45cdbf4d after exactlyreviewedlocator34b25f40; run only affectedlint11/discovery3/currentownAPI2543fa8c1d61readmission/wholeoriginalBrowser3+actual8captures+cleanup.117componentsunchangedremainvalid; norepeat or extraresourceprobes, no times/guards/fixtureidentitychange. Complete75onlyactualgreen and Rootvisualreview then focusedcommit. Root/M/Psource-only whileC runs. M55remainsopen(currentartifact2552/fa15/7dfe unlesssourcechanged), leftoversfocused70/other94/2/product48+widget176/frontend6; failedsetupdoesnotproveprovider/permission/APIrootcause. Root70still906green/checkedrefused/native0; no70completion.


**Reviewed C75 mechanical locator binding (before sending):** Root read exactpatch34b25f405455c40d43763e466db10c5f36adef96c96fb6089f0f2ab77b541e9f after actual61509 trace showed a legitimate filter option plus list strong with the same professional name. It changes only two uses of the global text locator to one exact Profissionais tabpanel/text locator; identical expectedname/toBeVisible/capture and every other gesture, API/SQL/reload/403/focus/geometry/assertion/budget remain. No first/nth/force, no resultoraclechange, fixtureidentity or APIpermission change. The same strict locator still requires one visible matching element. C may verifybefore41,gitapplycheck/exactapply/reversecheck and refreeze this test-only source now, source-only whileM55 is sole executor. No117componentrepeat is justified by a browser locator-only change. Next explicit Cwindow requires affectedlint/discovery3/currentownartifact and wholeBrowser3/8actualcaptures/cleanup; no75completion or retryuntilhandover and actualsuccess/Rootvisualreview.


**Dispatched M55 actual native window (before sending):** Root70 newordinaryattempt at03:26:26 refused4418<5168 before anycapture/build/recordchild despite earlierC75actual7263;906currentcomponentsremainpassed, native13still0 and no70mark. NoRootrunneractive. A boundedread-only memory/process inventory identified no process with a matching owned workspace; no process/container/app was stopped, no OS setting changed. M55 now receives sole runtime for actualfocused77/7files thenremaining94/10files,compiledTwilio2,normal48/widget176 and remaining6frontendheader commands. First integrate-recheck own2552/fa15fb77/7dfe587e currentartifact, then original2048nativeadmission; no rebuild/724/types/lintrepeat absentchangedinputs. Allselectors/oracles/source frozen. Diagnose real failures preserving oldtests; wrongexpectationsrequireuserapproval. Finish55onlyactualFull/Buildgreen+atomiccommit; otherwise report currentactualstatus andcleanup at safe boundary, notprovisionaldone. C75 may prepare only exactsemantictabpanel locator/count1 repair after117/lint/currentartifact, no nextbrowser untilnewhandover. Root/P source-only whileMexecutes.


**Dispatched Root70 renewed ordinary window after measured change (before execution):** C75 sourcefreeze41 normalizer117/117 andlint11/discovery3/currentownAPIpassed. Actualbrowser61509 admitted7263 at03:21:36, later natural1/normalcleanup/disconnected and returnedslot; products/staff passed, owner authenticated and real administrative reads now pass, test stopped at duplicate-name strict selector (filter option and list strong). No positivegrade/captures/75completion claimed. C may only prepare a narrower actualtabpanel locator preserving same expected name, visibility, gestures, allassertions and budgets; this is mechanical locator binding, no status/expectedoutcome change, no permission widening or identityfake. Root now takes sole slot for ONE unchangedordinary5168 T70checked attempt on exact19sources after actualCcleanup; the measured2677?7263 change justifies new admission, not guarantee. No906repeat. If admitted buildnaturally0/currentrecord, run actualpublic13 under original2048 then close70onlyFullgreen. If refusalbeforechild, retainreceipt and give M55 its171/2/48/176/frontend6 currentownartifact window rather than loop. C/P/Msource-only duringRoot execution.


**Dispatched C75 current normalizer/browser window (before sending):** Root70 unchanged current-base full components906/906 natural0, zero skips/fail; ordinary checked refused2677<5168 at03:18:13 BEFORE capture/build/recordchild. OldRoot99artifact is stale; native13 remains0, no70mark/commit. Root returns sole runtime now to C75 for its frozen41 normalizer repair: run unfiltered117/10files,lint11,discovery3,integral own fa8c/1d61 APIartifactreadmission, actual unchangedBrowser3 and8viewportcaptures/normalcleanup. Preserve Staff approvedfe784003/owners200/all old oracles, thresholds/defaultheap/deadlines/105eight/107proofs. No fixtureidentity or performance bypass. Repair actual source failures normally, genuinely wrong assertions need specific approval. Return actual screenshots for Rootvisualreview before75taskmark/atomiccommit. M55 own checked2552/fa15fb77/7dfe587e current and frozen;171/2/48/176/frontend6 remain pending, it receives next actual runtime boundary. P30 stillpending324, allotheragents source-only.


**Next safe runtime boundary (recorded before sending):** M55 normal checked build64548 was admitted5226>=5168 and captured2552; do not interrupt its active runner. At its natural0/currentartifact boundary, return slot before new native selection so Root can complete restoredT70 actual Full/freshchecked/public13, releasing realT71 integration while M later executes55native. Root first revalidates tasks/current source freeze and current unfiltered906 component cohort once because the committed base added private99/schema/DI since historical70run; no changes/weakening of70test expectations or903oldcases. No template/API/gateway source edits while Root compiler runs. If ordinary5168 refusesbeforechild, retainreceipt and hand the slot to C75 normalizer117/lint11/browser3 using its unchangedownAPIartifact; no busy repeat or guard change. C75normalizer is eight productive lines+12newcases, freeze41SHA31777d74, not executed. Root four old75untracked files parked exact at.cache/t75-root-wip-park-before-c-commit-20261117T030605Z,manifest6aa376d9; do not restore over eventual actualC75commit.


**Dispatched whole Phase8 ownership transfer (before sending):** C has only cache-only11source proposals forT56?62; no productive phase8 task has started. To avoid a waiting implementation lane afterM55, whole nextPhase8T56?62 transfers to M/operator_delivery_resume after55Full/atomiccommit; C remains wholePhase10/T75?77/72 and Phase16/105?106 owner. M must read/adopt bounded existing C cache packet b46c1d40417213afc480b0c9821e18e18b215052676565dd464abda7219a595e plus Root source review .cache/t56-source-review-20261117/notes.md, deriving each gate before productive changes. Include actual resumeconsumer/final-start, fixed natural-language handoff, narrowStaffbootstrap preservingfullprofile403, actualConversations tab/browser/link at62; no RAGadmincenter. C freezes Phase8 cache for handover, no doubleauthoring. All actual runtime remains serial by explicit Root mutex; authoring can proceed source-only while a different lane runs. One gate and atomiccommit per task, no premature56implementation before55Full. M100 remains cache-only until99+55+62. This changes worker allocation only, not user scope or criteria.


**Dispatched P next-phase source preparation (before sending):** P retains Phase4T30?32 ownership and its exact backed-up WIP. While M55 is sole executor and C repairs UI source, P may prepare only ignored cache proposals for whole Phase5T33?39, with concrete tests-before-code for first T33 cancellation against canonical Appointment authority and existing operations/payment contracts. No productive task33 before32Full/commit. Map all real writers/locks/policy/refund facts/idempotency and preserve existing product Order/stock behavior. No new refund promise/provider call/order alias or business rule beyond approved spec. Return minimal source/test packet and exact missing wiring; no imports/parsers/tests/build/container/probe/nestedagents/remoteactions. Existing31/32/71 packets and20T30WIP remain byte-exact. This is preparation, not completion.


**Dispatched after actual C75 browser diagnosis (before sending):** C browser26292 closed natural1 with products-owner/staff2of3 passing; services-owner failed before administrative request. Actual wire GET/me owner200 exposes userId, SDK does not normalize to user_id required by T59/T73. This is productive DTO normalization defect, not invalid oracle. C may source-edit only actual merchant-profile normalization plus additive regressions and task75 metadata, preserving all old assertions/Staff403/owners identity and prior34 inputs except explicitly listed new changes. No fabricated fixture identity or broader permission. C returns sole runtime now and remains source-only until explicit handover. M55 receives sole runtime for fresh ordinary5168 checked API and remaining actual Full gates; reuse already-green unchanged724/typecheck/lint instead of repeating. No heap/threshold/deadline/coverage change, no stale artifact, no remote action. Root/P source-only. If build is refused before child, return slot/evidence promptly without routine repeat. Root70 remains exact-restored19 source awaiting its own build/native13.


**Dispatched resumed C75 native window (before sending):** M55 aligned e6a53bad2 and preserved all55/99bytes, current unfiltered union724/724 natural0, ownPrisma generation0, fullAPItypecheck0 and eslintsrc0. Its original checked build then refused2180<5168 BEFORE child; no new artifact/native, recorded c6f80abe. M's bounded registeredPID scan found0 and returned slot;55 stays open and source frozen. C now receives sole runtime to finish75 after applying specifically approvedfe784003 (applied/reverse0,3changed/31preserved,34freeze8687a625). Run only affected lint/syntax+list3, guarded own API readmission, actual three-case browser2048/captures8 and normal cleanup; unchanged103components need no blind repeat. No deadline/heap/guard changes or source-row/profile invention; fix actual UI/source failure normally and preserve all assertions. Complete75 only after actualBrowser green plus Root visual review of genuine captures, then focused commit. Root/M/P source-only meanwhile. M55 receives next compiler opportunity after C returns; Root70nineteen restoredexact but remains unexecuted under new99base.

**Settled C75 test-fixture correction, 2026-11-16:** user: "Corrigir somente teste e fixture (Recomendado)" (reply call_f4671d40a82d4cffbc6838aec5896005). Approval is limited to reviewed patch fe784003fd1b5f3853087bfeb426bef5526e17909b81d3c1b30a0b1e3c90af25: Staff's actual full-profile403 plus exact ProblemDetails code/detail and persisted user/tenant/role precondition; owner200, management/policy403, SQL snapshots, cases and budgets remain. Entry renders existing denial with me=null; no invented profile or API permission change. Old26d draft is not approved. C may verify/apply only this exact patch now, record the user's literal answer and preserve all other inputs. No runtime until M55 returns the sole slot; then required lint/browser is still mandatory, no75completion from this approval.

**Dispatched M55 alignment and Full (before sending):** Root99 is committed e6a53bad2 after51components/13realHTTP+SQL/checked2550/schema0/migration9/lint0, all actual runners closed. M now receives the next sole runtime window for55 after its bounded source alignment: backup/hash18WIP+base blobs/patch and old evidence, align its clean committed base with Root e6a53bad2, reapply only its55 delta through checked three-way context preserving99 private table/DI and all Root gates/approvals. No dependency/output borrowing. Preserve all original assertions; report any real merge ambiguity before mutation of its meaning. Validate tasks, plan and source/input manifests before runs. Changed-base concerns justify the unfiltered current union of frozen191 and30remaining component selectors, deduped by file, then one original checked full API, concrete77+94native171 in17files/compiledTwilio2/normal48/widget176 and phase header builds under original guards, all serial and no skips. Repair actual source failures normally; genuinely wrong assertions require specific approval. Complete55 only after actual Full/phase gates and one focused local commit, then return proof/cleanup. P/Root/C source-only meanwhile; C75 permission remains pending. Root can restore parked70 only in N, never mutate M.

**T99 complete before its atomic commit:**51/51components/8files, schema validate0 and migration9/9; original full checked2550/input9bcd1402/artifact848ace7b passed, then actual13/13HTTP+SQL/0skip/fail after route-specific fixture idempotency header correction (all13case bodies/assertions byte-exact). No productive implementation/oracle changed by the fixture repair. FAQ/public config/source/chunks unchanged by private writes, reverse FAQ save preserves phone, same-setting concurrency and real failed-audit privacy passed. Natural owned cleanup/provider0. Current53/108complete, no100/101 or feature-final claim. Root75four WIP paths remain untouched and unstaged;70nineteen remains parked until after this verified99commit, then restore with checked three-way merge preserving private99DI/schema. C75 awaits user approval of un-appliedfe784003patch, no runtime; P/M source packets returned. No remote actions.

**Current runtime / returned preparation:** Root99 standard checked PASS2550/input9bcd1402/artifact848ace7b, natural0 at02:02:21Z. First actual native13 ran all children,11pass/2fail including parent: only FAQ interoperation's missing Idempotency-Key transport failed400; private auth/scope/concurrency/rollback/failed-audit children passed. Reviewed route-specific wrapper now supplies mandatory UUID only to PUT/support/settings; all13case bodies/assertions byte-exact, no status/API/guard edits. Retry is active under Root sole runtime. C75 actual103components/lint9passed, first browser setup ran0cases/screens because Staff/full-profile precondition200 contradicts existing403 guard. Proposed fixture-only patch fe784003 is un-applied and awaiting the requested specific user approval; do not infer it. Root72 reporter-only18/18 passed in cache with three-business21scenario corpus; no71/72Full or model/provider proof. P71 new session/final-fence13-case packet86367AAA returned unexecuted; M100 concrete11new+7delta/27component+8PG packet9520b690 returned unexecuted. Both preserve ownWIPs. Root remains only runtime; no production/provider actions.

**Scoped Staff bootstrap discovery for58/62:** Preserve GET/merchants/me's current Staff403; its full owner/admin profile includes storeSettings and payment account metadata. The planned Staff Conversations journey needs a narrow authenticated context during58/62 wiring, using an explicit safe identity/name/canonical-mode projection and the same conversation authorization, never a fabricated frontend profile or broad Staff access to owner settings. Include actual HTTP/privacy/foreign-role proof in58 and actual login/deep-link proof in62. This refines their already-approved permission split; no new product scope or current API change. C75's full-profile403 negative remains valid when the later narrow bootstrap exists.

**Root runtime resumed after C75 setup failure:** C closed its owned runtime naturally with provider0/app ACK/no AggregateError and known node/cmd0. Its browser attempt ran zero cases/screens: the new fixture incorrectly expected Staff GET/me200 although the existing AuthGuard intentionally returns403. A fixture-only correction proposal is under review and will require the skill's specific test-correction approval; no API permission widening or fabricated profile. Root reclaims the single runtime slot. Root may first run the prepared pure72 reporter cases as a clearly partial cache-unit complement under1024/network guard, then attempt99 checked/native with normal admission if feasible. This does not bypass71Full or complete72. C remains frozen/no rerun until approval and next slot; M/P stay source-only.

**Root72 bounded reporter preparation:** While C runs75, Root prepares only ignored-cache evaluation corpus/reporter and criterion-derived tests for72, assisting its Phase10 owner. Reuse the existing AI-governance report's revision/dataset/contract-hash convention and the existing synthetic clinic/salon/consulting source fixture. The reporter compares concrete answer/provenance/tool observations with trusted fixture ground truth; it never accepts a self-reported passed flag or treats deterministic fixtures as provider/model accuracy. Missing/duplicate/foreign/stale/unexpected-tool/private data and any failed critical case must block the evaluation; report review items without raw prompts/answers/private data. Actual source/tool/HTTP observation adapter remains integration work after71Full. No productive72, test/import/parser/build/runtime/probe, new policy, namespace, entitlement or clinical advice; C75 retains the sole runtime slot.

**Technical dependency and M100 source dispatch (before sending):** The required authenticated Conversations link has no current consumer in WhatsAppSellerPage;62 implements that route/tab, so add62→100 without changing user behavior/scope. Keep101's existing62 dependency. Root inspected existing order-quota and marketplace-operational-alert senders plus the generic template port/catalog: an explicit merchant-owned notification recipient and active verified Meta channel/approved purpose-specific template are existing operational conventions. Do not invent a staff consent UI or borrow buyer consent/window; do not call configuration or template approval consent. M may prepare concrete100 domain/receipt/render/template-policy and consumer draft in ignored cache using the real private99 table, canonical new-case intake, existing generic Meta template policy and dedicated support_case_alert purpose, never fake orderId or reuse an order notification type. Merchant destination is explicitly configured by an authorized admin; delivery still needs current channel/purpose/account/template eligibility and final-start/attempt fence. Unavailable/unknown remain truthful and no uncertain resend. Production provider opt-in/approval is not inferred from local fixtures. Actual link composition waits62; no guessed route passed as verified. Root retains99 integration/gates, C75 sole runtime, M/P/Root source-only. M returns source/tests/map with no100mark or execution.

**Dispatched P bounded71 code preparation (before sending):** Phase4 handover packet returned B080CA41, actual100TAP+48product+176widget still pending. While C owns75 runtime, P may extend only its ignored existing71 preparation into concrete minimal grounding/composition helper code and criterion tests against actual Root63–69 contracts, parked70 ABI and existing canonical-reader proposal. Preserve20T30 WIP/31/32/T71 previous packets; Root retains Phase9 ownership, integration and gates. No new namespace, gateway allowlist, entitlement grant, ungrounded index claim, direct-source bypass, model-triggered source tool execution or price/slot authority. Enforce tenant/public scope, global20 refs and post-last-model/final-direct-context freshness; keep live facts canonical. Unindexed-company context must have honest canonical provenance, never fake public-v1 indexed evidence. No productive71 or imports/parsers/tests/build/native/browser/probes, nested agents or remote actions. Return exact interfaces/source map, tests-before-code packet and remaining wiring, not completion.

**Dispatched C75 runtime handover (before sending):** Root99 standard admission refused3954 before child; monitored run t99-supervisor-20261117T011144767008Z refused an observed515.999ms sampling gap (limit500), min4134/no reserve breach, forced only own verified Job and proved jobEmpty, no build attestation. Do not relax guards or blindly repeat. Root99 build/native remain pending. C now receives the sole runtime slot for75, first validating its own existing checked API inputs/outputs; if current, reuse it without rebuild/copy as allowed by the existing guards. Native authenticated local browser cases and actual screenshots are authorized under the user's complete-execution instruction. Preserve default105setup and all product assertions. Restrict75 to shell/navigation/guards and truthful read-only composition of existing data; do not implement77 category CRUD or76 early. Remaining75post-save focus is verified during later real76composition. Root/P/M remain source-only, no parallel runners or imports. C may complete75 only after its actual component/browser gates pass, then report result/owned cleanup before next runtime handover.

**Settled execution resumption, 2026-11-16:** user: "prossiga so finalize quando terminar todas as tarefas". Resume the approved complete local task queue, including previously deferred full builds/native/browser/proofs; do not stop at a partial milestone. This supersedes the prior window limited to smaller tests. Existing local-only authority, test integrity, product preservation and all final verification gates remain unchanged. Current52/108complete,56remaining; no new scope or production authorization.

**Dispatched resumed fronts (before sending):** Root owns T99 fresh standard checked API build (original5168 admission; observed8013MiB available commitment), then actual13HTTP/SQL and task99 finalization before restoring parked70. Existing M/operator_delivery_resume resumes whole Phase7, reconciling55 eighteen WIP/191 previous components and preparation for its remaining Full gate; P/relay_start_review resumes whole Phase4, preserving30 twenty WIP and31/32 packets; C/service_ui_resume resumes whole Phase10 (75–77), preserving105eight/107proofs and preparing actual75 browser/wiring with native authenticated API. M/P/C perform only source/diff/git preparation until Root hands over the sole runtime slot. No imports/tests/build/native/browser/container on the other fronts yet. Reuse existing completed contracts; no nested agents, remote deployment or assertion weakening. Every task gets its real gate and focused commit. Final fresh Verifier/screens are dispatched only after last task at commonHEAD.

**Returned C76/P32 source packets; no task completion:** All workers returned. C76 finalmanifest a3d6669c57d5a6131f04699310575dd9f08865818ab0090a072a7000ad176a54,5files SHA-verified,29expected/unexecuted; Published/Reactivate reuse ToggleSwitch, membership remainscheckbox, qualitative deactivation retains confirmed appointments/history. C productive25hashes unchanged. P32 finalmanifest A38748682647D0B8FECA243E2608999D9794D95F326E8CA0981528DDB66609FA,12expected/unexecuted covering18state/action combinations; explicit canonical-to-legacy state adapter, operator/version/CAS/replay/audit/outbox, no inherited Order proof/time/payment restrictions not specified for new agenda. P20T30WIP/T31/T71 preserved. Root T56 source review at.cache/t56-source-review-20261117/notes.md confirms four prior corrections in source, not execution; actual resume consumer/final-start remains pending. T99 reviewed HTTP13 companion passes syntax-only node --check0; actualHTTP13/build still pending. All known runners and worker turns closed. RootHEAD0bb048e4e,52/108complete;75/99WIP and70parked remain explicitly incomplete. Continue from deferred Full gates when appropriate; do not repeat unchanged51/93 cohorts without changes or new concern, do not claim production readiness or fabricate prints.

**Dispatched C76 bounded source revision (before sending):** Root read the five-file cache packet and confirmed the actual paginated catalog contract, omitted unchanged links and retained off-page selected IDs. Align the two boolean preferences Published/Reactivate with the existing ToggleSwitch and the user's prior toggle preference; keep service-membership multi-selection as checkboxes. Only ignored76 panel/spec and manifest/docs may change; preserve all payload/checked/permission/stale assertions and gestures, changing only the boolean control role required by the requested design. No productive76/75 edits or runtime; T75Browser barrier and real composed post-save focus/feedback remain pending.

**Dispatched P Phase4 next source preparation (before sending):** Existing relay_start_review may prepare only ignored-cache T32 explicit attendance transition command and criterion tests, after reading actual appointment states, authorization, CAS/transaction/event contracts and T31 draft. Preserve all20T30 WIP and T31/T71 packets. No productive32, task mark/commit, new financial/payment authority, implicit clock/payment attendance transition or invented route. T30Full/T31 barrier stays open. No import/parser/test/build/native/browser/resource probe until a later explicit handover. Root51/lint gates are closed; C owns76 cache-only. This is source preparation, not final Verifier work.

**Current checkpoint after approved73 fix and small99 gates:** RootHEAD0bb048e4e integrates73/74/fix as three focused local commits,52/108taskcomplete. T75 four source/plan/evidence paths adopted as WIP only; direct13dependencies matched C,manifestd22a2a85,actual93case gate belongs C worktree and browser/screens/types/build/route remain pending. Root99 current51/51components in8files,0skip/fail/natural0 at00:31:55Z/log3a00f788;5production-file lint0errors/1inheritedwarning at00:30:05Z/logd66a51f5. Original application test recovered exactly by removing the sole added case (60b7 before,96386 after), new controllera71ed2b8. Reviewed HTTP fixture receives only3 additive actualDB children, original9 recovered exactly,10→13total expected,UNEXECUTED;manifest84a79ba2/source4f7b21f9. Full fresh checked API/HTTP13 still pending, no99mark/commit. M source review returned with no concrete implementation defect and bounded coverage additions; no finalVerifier claim. C continues76cache-only under75Browser barrier. All actual runners closed; user wants code/small tests, no heavy retry/browser/memory question. No provider/production/foreign-resource actions.

**Dispatched M T99 additive proof preparation (before sending):** source review32e2e864 found three coverage gaps and no demonstrated implementation defect. M may prepare only ignored cache snippets for three additional actual owned HTTP/SQL children: concurrent recipient saves, non-null replacement/version/no-op, and recipient-free failed audit with unique correlation. Preserve all existing nine child cases byte-exact; no productive test/oracle change, import, runtime, build or browser. Root reviews/integrates additions; Full remains pending while user requested small tests. M55source/receipts unchanged.

**Root t73fix integration, local only:** Approved explicit-null parent correction aafc4ac00 integrated separately;49/49 actual focused client gate, only approved old assertion field plus new regression. Current combined T75 component-only cohort93/93 (11page+23hook+49client+10legacy),7files,0failed/skipped,natural0 at2026-11-17T00:15:05.896Z,25source SHA exact. T75 remains OPEN/uncommitted; browser/screens and full gates pending. Completed52/108. User requested code and small tests only; no new full build/browser or repeated memory question. All final gates remain required.

**Dispatched M T99 incremental source review (before sending):** existing operator_delivery_resume may read only eleven RootT99 source/test/migration paths and current support authorization/tenant boundaries, write ignored M cache findings. Focus concrete foreign read/write, role escalation, public source leakage, null/version/no-op/concurrency/rollback gaps; do not alter source/oracles, import/run tests/build/native/browser or probe resources. This is interim source review, not final independent feature verification; original author may identify gaps and Root decides corrections. Preserve all18 M55 WIP and55proofs.

**Root t74 integration, local only:** T74 originaladd8736 view-state integrated;81/81 QuickUI historical gate against original73. Synchronous profile/mode/context fences, serialized actual commands and server availability. Separate approved73 null-parent fix follows; no appointment authority or optimistic confirmation. Completed52/108. User requested code and small tests only; no new full build/browser or repeated memory question. All final gates remain required.

**Dispatched C Phase10 source preparation (before sending):** existing service_ui_resume retains whole Phase10 ownership; after93 component closure may prepare76 ProfessionalsPanel and criterion tests in ignored cache only, using actual73/74 contracts and existing design components. T75Browser dependency stays open, no productive76/mark/commit. Preserve105eight/75source/107proofs. No test/build/browser/API import/runtime until Root explicit handover. Root owns73/74/fix integration and private99 review. No nested agents or remote actions.

**Root t73 integration, local only:** T73 original53a5 client18 actual operations integrated;48/48 QuickUI, no speculative appointment endpoint. Explicit-null parent finding has a user-approved separate fix aafc4ac00, to be integrated after74. RootT99 eleven API paths and own plan/evidence remain byte-exact and unstaged. Completed51/108. User requested code and small tests only; no new full build/browser or repeated memory question. All final gates remain required.

**Approved SDK correction green / C75 lightweight component dispatch (before sending):** actualapprovedT73nullwirefixpassed49/49unfiltered4files(39new+10old),0skip/fail/natural0at00:09Z/admission1863; Cfixatomicmetadata/commitpending, original73+74/source81preserved. Rootwillintegratefocused53a5+add8736+greenfixwhilepreserving11API99source+privateevidence. CmaynowrunONEsmall75component-onlycohortafteritsplan/tests/sourcefrozen, usingnewactualPagecomponentandappropriateunchanged73/74companionsunfiltered(existing1024guard/concurrency/DOMcontrols). Recordconcretecountsbeforeexecution; this mayproveactualRTLtab/filter/guard/empty/error/accessibilitygesturesbutNO75Fullmark/commit/browser/visualscreenshotclaim. No types/build/renderer/nativeAPIfixture orroutewiring, perusercode+smalltests. Keepsource56cachecorrections/105/107intact. Allotherworkerssourceonly; Rootgitintegrationnotparalleltestruntime. SDK49gatealreadytrue, no anotherisolated49rerun. New75+current74integrationcohortcanincludethefixedtransportonceifneeded; neverweakenoromitoldcases.

**Approved narrow T73 expectation correction (2026-11-17 UTC / user16local):** user: "Corrigir essa expectativa (recomendado)" (reply call_8c2dbee1ab4c41bb905ff23cd0ee3de7). Authorizesonlytheexistingnewcategory-updateassertionwirekey parentId:null→parent_id:null asreviewedpatch27cf560301d3b436d65ef3565bc3d08d832f68b6fa26ecef893eda8db8945a8f; allinputs/otherfields/otherassertionsunchanged. SDKadaptsONLYexplicitnullparenttothecurrentcontroller'ssupportedalias; no backend/productflowchange. CmayapplyexactreviewedcandidateafterbeforeSHA/reversalproof, addoneindependentclearregression, runONEunfiltered73cohort(expected49=39new+10old)underexisting1024guard, thenfocusedfixcommitwithapproval/evidence. Preserve74add8736/81proof/1058/d949/75source; no silentoldcaseinputsubstitution. Rootwillintegrate73original+74+greenfix, notclaimknownbugresolvedbeforeactualgate. No fullbuild/browser/provider/production/foreignactions.

**C73 QuickUI returned / Root99 expanded component gate (before execution):** C73actual48/48unfiltered4files(38new+10unchangedclientcompanions),0skip/fail/natural0at23:46:56Z;1024admission4949/1567physical; originalsourcecommit53a5cd57awaitsRootfocused integration. C74sourceonlyoverreal73contracts, no fictionalappointmentoroptimisticconfirmedstate. RootnowownsONE36case99componentcohort(27preserved+9newactualusecase/realTenantContextcases) underoriginal1024guard/networkguard/ready-prod-loader/concurrency1. Existing10productive/test/migrationhashesunchanged; extraapplicationfixtureSHApinnedbylauncher, no implementationchange. This addsactualapplicationstate/no-op/clear/scope/errorcoverage; noHTTProle/SQLrollback/fullcheckedclaim. Earlieractualmigration9andSchema0remainvalid source/schemaunchanged. Allotherworkerssource/cacheonly; no fullbuild/browser/memoryprompt peruserpreference. Scope/eventDuplicate/replay/fixturefindingsfromM56source-reviewwillbefixedincachedraftbeforeanyintegration, notsilentlyignored.

**Source-only T56 review / P31 preparation dispatch (before sending):** userpreferscode+smalltests, no newfullbuild/browser/secondmemoryquestion. C73productiveclient/testsagainstimplemented25contractsactive; nextsoleQuickUIawaitsitsready source/counts, Root99migration9alreadyreturnedgreen. Mmayread C's actualcacheT56close/resumehelper/usecase/tests against48-55contracts andreturnspecificclosure/epoch/idempotency/privacy/authoritygaps only, notanotherframework/doc orfinalVerifier. PreserveM18source. P, aftercompletednormalalignment0b345b70/20T30reapplied, mayprepareactualT31manual-admissioncommand+criteriontestsincacheonlyusingreal26admission/23availability/30policyauthority; no inventedHTTPcontract, forcedoverlap/price/paidstate, orsourceintegrationbefore30Full. Preservecurrent20WIP/71packets. Rootwritesactual99applicationcomponent9casesderivedHUM09(addedtoexisting27=36), no productionchange; sourceonlyuntilC73Quickreturn. Allruntimegatesstrictlyserialized, no API/native/model/provider/production/foreign/OSactions.

**User small-tests steering / independent client implementation dispatch (before sending):** useranswered"Continue com código e testes menores" to resourcequestion; no furtherfullbuild/browserattemptormemorypromptnow. Existing99PG-onlymigrationgatecontinues(alreadylaunched1024/4157,noAppModule); allfullgatesremainpendingnotwaived. T73typedadminclientdependsactualimplementedprofessional/availability/policy/categorycontracts25andpermissions59, notgenericRAGevaluation72. Removeonlyartificial72→73ordering, preserve71→72andaddexplicit72→95finalacceptance; add41→79to preventspeculativemanualbookingAPIs. WholePhase10ownedbyC: actual73→74→75→76→77 preparation/Quickgates canadvanceindependently;72stillwaits71andisrequiredforfeaturecompletion. No scope/criteria/pricing/rolechange, unsupportedappointmentwrappersoromittedgate. Cmayimplementactual73afterminimalplan/exactcontrollerDTOinventory/criteriontests, thenone1024QuickUIcohortwhenRoot99migrationreturns;74follows73green.75-77sourcepreparationallowedafterdependenciesbutnoheavyUIruntime/buildnow. Source56draftretained, notdiscarded; wholePhase8waits55aftercompleted59. Root/P/Mnoothergates; allproduction/provider/foreignactionsoutofscope.

**Root99 migration gate dispatch (before execution):** Root99component27/27andschemavalidation0passed/natural0,10sourcehashesunchanged;59integrateddbb9afd5c/50complete. CorrectedreadonlyDockerinventory3scopedlabelsreturnedzero containers, noownsyntheticleak/cleanupaction; noforeignresourceschanged. RootnowownsONEunchangedT5migrationcohort(root+8=9)oncurrent99schema/migration underexisting1024PG-onlyadmission/networkguard/localUUIDownership/loopbackmarker/defaultCLI90s/test600s. Actualdeployallpendingmigrations+currentPrismaschema-parity+legacycommerce/stock/persistencepreservation/cleanup, noAppModule/generatednewclient/oldartifact/HTTPauthclaim. No sourceassertion/path/deadlinechange; task99FullstillrequiresnewHTTP10/freshcheckedAPI. P/C/Msource/cacheonly, no concurrentruntime ornewbuildprobe. Askeduseraboutoptionalmemoryrelease asynchronously; no assumedanswer.

**T59 integration complete / corrected readonly inventory (before inspection):** C59integratedasRootdbb9afd5c,50/108locallycomplete; exactly7focusedUI/metadatafiles/noAPI99staged, all11protectedownpathsbyteequalbackup21a6844d. MetadataonlyconflictsresolvedpreservingRootstatusandC59trace/graph; failedUTF8defaultdecodeassertstoppedbeforestaging, correctedexplicitUTF8fromimmutablebackup. Root99unit27+schema0unchanged, allknownrunnersclosed. MreadonlyDockerattemptfailedGo-templatequotingbeforerows(noabsence/ownershipclaim); RootmayperformONEcorrectedlabel-filteredIDinventorywithoutembeddedquotedlabelkeys, sanitizeonlyID/name/state/threeownedlabelvalues. Labelsarecandidatesnotcheckoutownership; requirecache/runproofbeforeanycleanup. No start/stop/delete/dataquery/globalDocker/OS/processaction ornewbuildprobe. Pnormalalignmentcompleted0b345b70/T30reapplieduncommitted, no source/gatecompletionclaimbeyondexisting24.

**T59 integrated locally / T99 current partial evidence:** originalC3e26a3b0 QuickUI75/75unfiltered, oldfunctions/constants/testsbyteexact, no route/tab/backendauthchange. Rootnow50/108complete(T59added); T56waits55and59. RootreviewedhelperrolesagainstexistingAPI: supportOWNER/ADMIN/STAFF, configurationOWNER/ADMIN, service-managementOWNER/ADMIN+canonicalservices/selected; unknownsensitiveprofile/targetdenied. All10Root99APIpaths+own99planremainbyteequalto21a6844dbackup; noAPI/source99stagedin59. Root99component27/27passed/0skip/fail/natural0 at23:13:43Z(logce9d4aca) and ownPrismaschemavalidation0 at23:15:44Z(logcee181ad); actualmigration/fullchecked/HTTP10remainpending. T70all19sourceparkedexactcfc76532, notdiscarded/completed. M55latest3072admissionrefused2467beforechild/e6420e68; no retries/source191repetition. Pbaselinealigned0b345b70 treeequalsaa30; own30reapplied/fingerprintmergedpreservingRootexports, native324pending. Allknownteamgatesclosed; source/cacheworkonlyuntilnextexplicithandover. No production/provider/foreignprocess/OSaction.

**C59 QuickUI returned / Root99 component slot (before execution):** Cnewpermissionprimitivespassed75/75unfiltered(permissions60=5old+55new/subscriptionroute15),0skip/fail/natural0 at23:12:35Z; original1024admission4471/1378physical. Oldpermissionsfunctions/constants/testprefixbyteexact,105eight/d949intact, knownownnodecmd0. Cmayclose59metadata/atomiccommitonly; no56runtimebefore55. RootnowownsONEprepared99component27cohort via .cache/run-t99-unit.mjs underexisting1024guard/networkguard/ownedloader/concurrency1; current10T99sourcehashesfrozenfromadoptiond3a6c3cd. Ifgreen, oneboundedownPrismaschemavalidationmayfollowunderfresh1024guard/sanitizedenv/owncachedbinaries, no generate/build/artifactrecord/DB/browseroroldstampuse. NoTask99Fullcompletionfromthesepartialgates. PbaselinealignmentandMownershipinspection/sourceonly, no otherteamrunners/provider/production/foreignactions.

**Source adoption / bounded resource ownership and P alignment dispatch (before sending):** RootT99tenfilesadoptedexactsourcecandidate d3a6c3cd after19T70pathsparkedwithmanifestcfc76532; noRootparser/test/buildyet, new99cohort27preparednotrun. Cowns59actualQuickUIwindow. Pmaynowperformreviewedcommittedbaselinealignmenttoaa30initsowncheckout: preserve20WIP+14older71files, normalmerge(notfalseFF; mergebaseee4532), keepownsourceparkedoutofintegrationcommit, preserveRootapprovedmetadata andbothshared-typesexports, thenreapplyownT30sourcewithfreshhashmanifest. No Rootdirty70/99source/artifacts/depscopied, no parser/test/build/native/probe, no30Fullclaim. Mmayreadexistinglocaltestlabel/ownershipcontractsandmakeONEread-onlyDockerinventoryofpositivelyscopedfeaturecontainers tofindpossibleoldsyntheticruntimeleaks; no start/stop/delete/globalDocker/OS/processmutation orcustomerdata read. Reportexactlabel+run/checkout-evidencebeforeanycleanupisconsidered; absenceisvalid/no retry. This read-onlyinspectionisnotparallelapp/testexecution; Cunitownershipunchanged. Rootwillrun99units/schemaonlyafterCreturns; no testsrepeatedmerelyforcounts. Allproduction/provider/foreignactionsremainoutofscope.

**Technical Phase8 reorder / C59 implementation dispatch (before sending):** M55attemptrefusedactual2467<3072at22:57:55Zbeforechild/receipt e6420e68, no capture/compiler/Job/record; all18source/191greenpreserved andslotreturned. T59permissionprimitivesdependoncurrentprofile9andexistingauthenticatedsupport53, notunimplementedqueue58. ExecutewholePhase8as59→56→57→58→60→61→62 inC; addexplicit58dependencyto60, preservingeverycriterion/role/plan/mode/serverguard. This technicalorderingchange grantsno newrole/configaccess andremovesnoFullgate. Cmaynowprepareminimalactual59plan/tests/source againstexistingpermissionscontracts, thenONE1024-admitted unfilteredold+newpermissioncomponentgate(noAPI/runtime/build). Existingfunctions/oracles/configprivacymustremain, no route/tabwiringbefore62; staffconversationaccesscanonlyfollowexistingauthorizedsupportpolicy. C59completionneedsactualQuickUIgate/atomiccommit; other56-62draftsremaincacheuntiltheirdependenciesgreen. Root/P/M/99source-onlyduringCexecution; no repeatedbuildprobes. Root70all19sourceverified/parkedcfc76532insideownedcachebefore99integration; no data lost or sourceclaimedcomplete. No production/provider/foreignprocess/OSaction.

**Resume 2026-11-16 / dispatch M55 build and P/C preparation (before sending):** user: "prossiga tem muita coisa ainda para fazer". Rootcurrentmemorysnapshot22:54:15Zobserved6169commit/2367physical, actualchangefromprior3103strictrefusal and4027->1486monitoredbreach. To unblockConversations, M55nowownsONE unchangedreviewedoriginal3072/live1536/300ms/max500gap supervisedfullAPIattempt; Rootindependentlyverifiedall6retargetedhelpersinvertbyteexact(68db5f37original/c0812dc8worker). No automaticfallback/retry orguaranteedfit; earlierreservebreachretained, fullcommand/defaultheap/coverage/currentinput-output/jobownership/natural0/recordseparationunchanged. MmustreportactualreceiptbeforeRootpermitsfinalize, then77native/phasegatesbefore55commit. No191rerunabsentsourcedrift. P30source/cache-onlyprepareexactFullnativeinventory+ownbuildreadiness preserving19WIP+declaredfixturead6 and71packets; noexecution. Csource/cache-onlyprepareactualPhase8close/menu/conversationimplementation/testsagainst55contracts, pending55integration;105WIP/93/107preserved,noUIruntime. Rootwillpreserve/park19own70WIPexactlyandintegrateunblockedT99privatephonesourceintoNunderexistingapprovedscope(dep53complete), ownplan/10fileinventorybeforeediting, noRootimports/build/runtimewhileMowns slot. Root70Fullremainsmandatorybefore71; parkedsourceisnotdiscardedorcomplete. Allremote/provider/foreignprocess/OSactionsremainunauthorized.

**Root independent log read at checkpoint:** actual M191TAPtail/hash3229ea8c, C93Vitestsummary9files/result0/postclose0/hashe91bfd0a, P24TAPtail/hash6864fd71 independently reread afterworkerreturn. Counts191/93/24confirmed, no newexecution. Root19T70APIpathsbyteequalbackup; metadataupdates do not stageunverifiedAPI/source. Allthreeworkersreturned, no additionalrunnerauthorized. This is currentcomponentevidence, notFull/production/finalVerifierproof.

**P30 final24componentgreen / current local checkpoint:** fresh1024admission5509at22:34:15Z; all24passed/0fail/skip/cancel/todo/natural0 in5775ms, log P/.cache/t30-units/2026-11-16T22-34-15.697Z/unit.log SHA6864fd71. Solefixturejoin0642a1a4->ad6fdb08 reversesbyteexact; allassertions/nonwhitespacetokensunchanged, other19WIP+14prior71packetfiles+branchpreserved. First17/24fixturefailure retained. No30native/build/DB/record/Full/commit; slotreturned. Currentresults: M55components191green, C105+107components93green, P30components24green, Root70components906previouslygreen butfreshchecked/native13pendingresource. C105actualvisualdiagnosticstillfailedbeforelogin/gesture; no screenshot/layoutapprovalfor105. Wholefeature49/108locallycomplete; allremainingFull/phase/product/finalsameHEADproofs/Verifier/screens/walkmandatory. Allknownteamrunnersclosed, no furtherexecutiondispatched. Source/cacheplansfor71SQL/canonicalfallback and100staffalert areproposalsnotimplementationproof. No production/provider/foreignprocess/OSaction.

**P30 first24result / fixture-only syntax repair adopted (before sending):** actual1024admission2893at22:31:55Z,24executed17pass7fail0skip/cancel/natural1,7689ms. All8StartCheckout+7policy passed; capability2childrenpassed/6failed+parent due ReferenceError as-is-not-defined at newfixtureguardline22: objectliteral newline before TypeScript as-assertion wastranspiledasstandaloneidentifier. Log P/.cache/t30-units/2026-11-16T22-31-55.597Z/unit.log retained; no SUTfailure/Fullclaim. Pmayrepair ONLYthe newline joining objectliteral closingbrace to its existing as unknown as Parameters assertion, afterexactbefore/candidateSHA/normalizedtokenandassertionpreservationplan; no expectation/comparator/casechange. This is fixture-syntax setup repair, notwrongexpectedbehavior. ThenONEwhole24rerununderunchanged1024guard/networkguard/loader/concurrency1/nofilter/skips; reportactualresult/source20preservationexceptdeclaredline/closure. No compile/native/DB/record/commit; Root/C/Msource-only.

**Dispatched P30 component-only gate (before sending):** P71canonicalcachedraftreturnedmanifest15daaccd/adapterae8e21db, proposedcontracts/casesonly/noexecutions; Rootintegrationwaits70Full. P30readinessfoundformalnonexistentwrapper/^T30$wouldmissactualtests. RoottechnicalGatepathcorrectionuses3actualunfilteredfiles(9capability+8StartCheckout+7policy=24expected), retainingFullnative/checked/productrequirements andalloldassertions; no productdecision or behaviorchange. PmayrunONE24componentgate underexisting1024admission/networkguard/ownedloader/concurrency1, afterownplan/freeze20WIP/sourcepaths; no alignmentofRootdirtysource/artifactborrowing/native/build/record/provider. Root/C/M/99source-only. Reportactualcounts/skipfail/exit/log/SHA/closure; no30completionorcommitfromunitonly. Rootlateststrict22:22:21refused3103beforechild; no current70API.

**Strict retry refused / no current build:** actualRoot22:22:21Zstrict6500attemptrefused3103commit/1539physicalbeforechild/samples0, receipt t70-supervisor-20261116T222221358949Z. C's7073unitpreflightwasrealbutnotastablereservation; no claimhoststillhad7073. No furthercompilewithoutactualenvironmentchange, no guardreduction ororiginal3072retryafteritsrealreservebreach. Root70resourceevidence1b6a6509 embedsallfiveactualsupervisorreceipts withSHAs;906componentsremaincurrentandnative13=0. C93sourcecomponentgreenisretained,105Fullstillpending. Heavy slotFREE; allworkerssource-onlyuntilRootrecordsnextboundedgate. No taskcompletion/APIstage/productionclaim.

**C93 green / Root70 strict retry after measured environment change (before execution):** C combined105+107cohortpassed93/93/9files/0skip/fail/natural0 in44.81s, ended22:21:15Z; current10sourcehashesexact/knownownnodecmd0. Log C/.cache/t105-execution/combined-units-2026-11-16T22-20-28.366Z. Itsactual1024preflightobserved7073commit/2400physical at22:20:28Z, meaningfulchangefromRoot4027/947thenreserve1486. RootnowownsONE SAME strict6500initial attempt16898f6d afterCclosure, withoutloweringguard; all1536live/300ms/max500gap/job/defaultcommand/currentbytes/recordseparationremain. Root19APIhashesrecheckedbyteequalto21:20backup. C105Fullstillpendingcurrenttypes/build/native2; P71/M100/Creadinesssource-only. No retryifstrictrefusedwithoutnewmeaningfulchange; no nativeonoldstamp/provider/prod/foreignactions.

**Dispatched C105 combined component gate (before sending):** Rootactual70ownedjobempty/monitorreturned1 with currentartifactfalse, allotherworkerssource-only. CmaynowrunONE original1024-admitted unfilteredunion of10578components andindependent10715newentitlementcases (deduplicatefiles, expected93/runnerauthoritative) on unchanged8WIP/d949source. This establishescurrentcombinedsourcecomponentbehavior only; no types/build/browser/native/preview/warmup/probes outsideexistingpreflight andno105completion. Preservealloldassertions/failednavigationtrace/realactionabilityunknown. Root/P/M/99no runners; Creturns slotafter naturalresult/knownownedclosure. Broaderunitselection is justifiedby combined105+107CSS/controlsource; no repetitionofunchanged906/191cohorts. No prod/provider/foreignprocess/OSactions.

**Root monitored70 actual reserve refusal:** unchanged3072monitor admitted4027commit/947physical22:16:18Z but75samples later reached1486<1536. Receipt .cache/phase3-gates/t70-supervisor-20261116T221618613965Z/supervisor.json: ENVREFUSAL_DURING_OWNED_BUILD, actualbreachtrue/forcedownjobtrue/jobEmptytrue/maxgap313/permitfalse. No successfulcapture/build-result/currentartifact/native/70completion. This is actualresourcefailure at3-5GiBstart, not acompilererror; no furtherbuildretrywithoutmeaningfulenvironmentchange or memory-guardlowering. Allforeignprocesses/OS/containersuntouched. Rootreleasesheavyexecution; C105trace/P71canonical/M100source-onlyremainactive. Nexteligibleboundedcomponentgate requiresRootrecordedhandover; no implicitruntimegrant. Keepold69stampsstale andallstrict/ordinary/supervisedfailures.

**Root explicitly selects original reviewed monitored policy (before execution):** thirdstrict6500attempt22:15:03Zrefused4071commit/473physicalBEFOREchild, receipt .cache/phase3-gates/t70-supervisor-20261116T221503400506Z/supervisor.json;0samples/no compiler/currentartifact. WithCactualclosure andallotherssource-only, RootnowselectsONE unchangedpreviously-adopted3072initial/1536live supervisedattempt(d2b8a4df/fourauxiliaries) after independent78ab27c3review. This openlyreplacesoptionalextra6500startupbufferforthisattempt, notordinary5168/native2048orcompiler/test/live/job/500gap/publicationrules; neitherhelperedited. No proven3-5GiBfit, oldordinary814warns. Preserveallrefusals andfailclosedonactualgap/reserve/ownership, no recordexceptactualnatural0/emptyjob/currentbytes afterRootreceiptreview. C105trace/P71/M100source-only; no provider/production/foreignprocess/OSchange.

**C105 diagnostic returned / Root70 strict build selected (before execution):** C actualsinglecase22:08:45Z/session59817 ended22:13:03Z/natural1 after ownedseed200/profile200; page.goto original30s load timedout BEFORElogin/normalAddHorariogesture. No actionabilityfinding or105Fullpass; nativecleanupACK/disconnected/timers[]/knownownnodes+PGRedis0 and8WIP/d949exact. EarliercacheconfigCJS/import.meta0casefail preserved and fixedbyexplicit.mts/staticdiscovery1; no oracle/SUTchange. Cnow source/cachetrace diagnosis only; P71/M100source-only. Rootnow explicitlyselects SAME strict6500initial helper16898f6d forONE fresh70attempt after actualownedCclosure (C admissionwas6625, notcurrentproof). Alllive1536/300ms/max500gap/newexclusiveverifiedJob/fullnormalpnpmcommand/defaultheap/coverage/currentbytes/natural0/emptyjob/recordseparation unchanged. Original3072optionreview78ab remainsUNSELECTED; no loweringoroldartifactuse. Refusal/failuremustremainnon-green; Rootinspectsactualreceiptbeforeanyfinalization. No otherteamheavy/probe/provider/production/foreignprocess/OSaction.

**Returned M55 build preparation / dispatched T100 alert cache design (before sending):** readinessmanifestce4dd387/helpers8cef48b5/plan0ca07ffa records18unchangedpaths and exactRoot->Mliteralretargets, owncachedtooling/fullcoverage/defaultcommand/outputs binding. Original3072andstrict6500UNSELECTED; no compile/capture/import/probe/record. Mnowmayread existingT99privatephone source and current55/49canonicalintake-outboxcontracts to prepare ONLY ignoredT100design/cases andminimalproposal for durablecase/epochstaffalert. Rootowns99source, integrationwaits55/99gates; no productive55mutation/schemaedit or new receipt/capabilitypurpose. Require separateverifiedstaffrecipienteligibility/template/consent, no buyer24hborrowing, no arbitrarycase/epoch/bodygrants, minimalnotification/authenticatedlink, unknownnoautoresend/ticketsurvivesfailure/privatefieldsneverpublic. Preserve18freeze/54oracles, source/cacheonly/noexecution or sourceimports. C105retains sole actualruntime; Root70next afterCreturn. No finalVerifier/provider/productionclaim.

**Returned P monitor history / dispatched T71 canonical-reader cache draft (before sending):** boundedthree69receipt review foundtwoactualfullbuilds+publishedfinalization0(initial6159/min3521/gap313;initial6478/min3484/gap313), one fail-closed6375msgap/ownjobcleanup/norecord, no observedsuccessful3-5GiBstart. Recommendation78ab27c3 allowsRoot to explicitly select unchangedalready-adopted3072initial/live1536 monitor for a futureboundedattempt; optional6500refusals/ordinary5382->814interruption retained. No selection/execution yet; C105retains slot. Pnowmayprepare ONLY ignored71canonical-reader draft/contracts/tests (notexecute): explicitinternalcanonical provenance/nulledembedding-work, current-onlybounded6family discovery+unchangedformatter, merchant-firstshare/defaultReadCommitted, recheckexactselectedhashes/publication/pairs afterLASTmodel, nofallback-indexfabrication/newpricinggrant/T66-T68rewrite. RootremainsPhase9author and71productiveintegrationwaits70Full. Preserve20P30WIP+old71packets, no appimport/parser/test/build/native/probe. No finalVerifier role.

**Resume 2026-11-16 / dispatched C105 and read-only P, M (before sending):** M55 whole23selector component gate ended21:47:37Z,191/191/0skip/cancel/natural0, log3229ea8c/receipt4cc5d7f2; original17 plus adoptedvalidfixture18 exact and ownedresources0. Do not rerun unchanged191. Root49/108complete, current70API19WIP preserved; no55/70Full completion. C owns the sole execution slot for the reviewed105readiness plan: first bounded real normal-service-button geometry/RAF diagnosis, then minimal supported hash-entry/request-phase test setup if warranted, with original gestures/oracles/deadlines intact. Preserve8WIP/107commit and ownAPI identity; current78components/types/lint/build and2browser/cleanup/captures required before105commit. Existing1024/5168/2048 guards unchanged; no blind eighth run. P source/cache only may inspect a bounded historical69supervisor receipt inventory and compare the already-adopted3072 monitored path to optional6500strict path, stating actual outcomes and risks; no execution/probes/change of guards. M source/cache only prepares a55fresh-own-build plan with current source hashes, original coverage/command and no output borrowing; no imports/parsers/tests/build/native/probes. Root no heavy work while C owns the slot. No foreignprocess/OS/provider/production action or finalVerifier claim.

**M isolated2passed / dispatch whole191component closure (before sending):** soleadopted18thfixture ae72d5c5 passed2/2/0skip/cancel/natural0 in28.6s at21:38:50Z, loga0f2aefe/receiptc9ed9e3f; original17freeze6a1+54dbd/a981 unchanged, allownPIDs0. Previous191=190pass1fixturefail remains historical, notcomposedintofakeFull. MnowmayrunONE whole23file191focuscomponentgate underexisting1024guard/sanitizedenv/networkguard/loader/concurrency1,nofilters/skips. Thisrerun is justifiedonlybytheactualfixturecorrection; ifgreen stillNO55completionuntilfreshchecked/fullnative77/phase7/productgates. No compile/API/native/browser/process/global action. Root/C/P/99source-only, no repeatedresourceprobe/guardlowering. Root70strictstillrefused6500with3289currentlastknown; no oldstampuse.


**Legacyreceipt valid-input enrichment / isolated2case slot (recorded immediately after dispatch):** Root secondstrict70admission21:32:28Z againrefused3289<6500BEFOREchild/samples0/norecord, noAPIbuild/rerun/native. Mfixturefirstassertion embeds partialclaim inactualcall; completingitsinput necessarilychangesthatargument. Rootexplicitlyadopts onlyfullvalidscopedclaim/config/device/stream/row/clock INPUTpreconditions; comparatorexpectedtrue/originalresponsepayload/other2sent+receipt assertions remainunchanged. No wrapper/prototypehack, authority bypass or expectedbehavior change. Mmayupdate18thfixtureafterplan+beforeSHA/reconstructiondiff, original17hashes/54oraclesstable, thenONE1024-isolated2receiptcases witholdguards/loader/concurrency1/nofilter-skips. Actualresultfirst, no whole191/build/native/browseruntilhandover. C/P/Root/99source-only. Thisisfixturecompletion, not askingtoweakenwrongexpectedassertion or claimingbaseline/native success.


**Root strict70 second admission after actualMclosure (before execution):** M191runner ended21:28Z/190pass1legacyfixturefail, allownworkerPIDs0; C107committed/restored8andallownedruntime0. BothnowSOURCEONLY. Rootretains49complete/19APIWIP unchanged andmaymakeONE strict6500build admission via reviewed .cache/t70-supervised-build-strict-proposal.py afterthisactualenvironmentchange; no lowering/repeatedprobe. Existingexclusivejob/live1536/cadence500cap/currentinputs+outputs/natural0/emptyjobproof required; no finalizebeforeactualreceiptreview. Ifrefusedagain, no buildchild or oldstampadmission. No otherteamheavy untilRootreturn; no provider/production/OS/foreignactions.


**M55components returned190/191 / scopedfixture source repair before nextgate:** exact191executed/190pass/1fail/0skip/cancel, naturalrunnerexit1; logf6c44615 at M/.cache/t55-component-gates/2026-11-16T21-22-00.770Z. All17frozen55paths and54dbd/a981 unchanged, ownPID19028/wrapper/children0. Solelegacyreceipt test's existingmock lacks tx.whatsAppWebhookInbox.findFirst/current canonical validclaim fixtures; botholdtest+productionreader identicalto01e, no baseline-runclaim. MmayprepareONLYthatfixture's missing scopedrow/leaseclock/stream/config/device preconditions undernewsource plan/SHAs, preserving all3originalassertions/expectedvalues and productionguards. This is setup repair, not correctionofexpectedbehavior or bypass; no originalassertion/test deleted/skip or weakened. No rerun/build/native/browser yet. Rootsoleoptionalstrict70buildafteractualMprocessclosure, existing6500jobguard/currentadmissiondecides; C/P/M/99source-only untilRootreturn. No55completion/newprivilege/provideraction.


**Current107integration verified:** Cfbfa6d5a3 integratedasRoot774c62d18 aftermetadata-only conflicts; exact18staged107files/noAPI/package/locksource. Whole107Full/Root6capturevisualPASS retained. Rootbackup3b412b70 contains all21own dirtyfiles and exactpre-mutationtasks; all19T70APIpaths+own70plan byte-equal afterintegration. Restored onlyownHandoffprefix atop completed107block, preserving54status and allC107checks/proofs. Root49/108complete;70Fullpendingcurrentartifact/native. M55sole191componentrun33779 from21:22Z; Root/C/P/99source/git/cache only. No productionclaim or incomplete70commit.


**Root70strictrefusal / dispatch M55components only (before sending):** strict6500 supervisorobserved3162MiBcommit/716physical at21:16:27Z andrefusedBEFOREchild, samples0/noAPIbuild/noattestation/noartifact; receipt .cache/phase3-gates/t70-supervisor-20261116T211627054748Z/supervisor.json. No compilererror/guardrelaxation/retry. C107actualFullcommitfbfa6d5a3f31f108ce0f5b59e76d0e487884607c returned18focusedfiles and1058restoredexact, indexempty/knownownresources0. Rootwillintegrateonlycommitted107withownT70WIPSHApreserved, no heavyapp. MnowsoleexecutionforONE existing1024-admitted55focusedcomponentgate using frozen17source6a1b6cee and exact23selectorinventory(expected191, runnerauthoritative), old54oraclesunchanged/no skips/filters. No build/native/importofAppModule/browser untilhandover; cachelauncher preparationis permittedasexactexisting54sanitizedenv/guard/concurrencyreuse. Ifrefused, retainzerochildreceipt andreturnsource-only. Root/C/P/99no heavytests.191isnot77native/currentAPIproof or55completion; no prod/provideractions.


**T107 actualFull returned / Rootstrict70build slot (before execution):** Cwhole3PASS34.8s/14.7s/29.6s, current70components/types/lint7/build0, actual201/SQL/reload/noadvancedstart/direct403/7%rule/provenance/capturesallretained. NativeACK/disconnected/timers[]/natural0, postknownownnode+PG+Redis0; sixcurrent1440x1000/390x844captures actuallyinspected byRoot+shownUserasLOCAL. Rootvisual107PASSforrelevantcontrols only; Cmaymark107+atomiccommit/source-only105restore, notyetRootintegrated. No newpub/featurecomplete claim. Rootnowsoleheavyowner for its freshfull70APIthrough preparedstrictsupervisor (INITIAL6500, LIVE1536,300ms/max500gap, exclusiveownjob/fullnormalcommand/currentinput-output/noattestationuntilreview); actualcurrentadmissiondecides. Pnormalized source-onlyreviewpassedexact1-linehigherthreshold. C/M/P/99no app/test/build/browser duringRoot. No repeated906units becauseAPI source unchanged; new13native/publicgate afterfreshowncheckedbuild remainsrequired. Refusal/failure retainsproof/no blindretry/record. C UIcommit doesnotchange API/package/schema/lock inputs and may beintegrated afterRootbuild.


**C107 current one-pass/true remaining causes / next focusedcamera-readiness repair (before sending):** lastactual3ended1pass(Growth22.4s)/2fail withnativecleanupPASS/ACK/timers[]/knownownnode+PG+Redis0;1058restoredexact. Growthdesktop+mobilecaptures SHA-backed and shownactual toUserasLOCAL; do notlabelwhole107complete. Starterproducts basic201+actualSQLgood+desktopcapture, mobilehitfalse becauseactualsuccessToast coverslocktarget. Services editorresponses begin9.67s afteronboarding duringcoldmoduleload andwerependingat10s; missed-completed-response hypothesis again disproven. CmaychangeONLYnewSpec: observe/bufferrequeststart beforegesture, stage existing10srequeststart then10sresponse withinoriginal60s andstatuses; assertsuccessfeedbackthenuseexistingrealFecharAvisogesture soactualcaptureunobscured. No timeoutincrease/sleep/force/style/API/billing/oraclechange. Preservecurrenttypes/lint/build/70proof ifactualinputsunchanged; syntax/affectedlint andonewholecorrected3browserunder2048/currentownAPI. No blindrepeatifanotherfailure. Root/M/P/99source-only, Root70strictbuildwaitsCreturn. No taskcommituntilall107Fullandcapturesgreen.


**Dispatched T71 unindexed-company source assessment (before sending):** whileC107owns actualexecution, Pmayread current63-70publicsource worker/admission/revalidation +existingdirectcompany context and its71cache contracts to assess genericnew-company consultation whengraphdisabled/notallowlisted/unindexed. RAG10requires samegenericingestion/queryflow; completed/indexed public-v1 evidence cannot be fabricated from queued rows. Compare minimalhonest canonical-sourcefallback versus index-only availability undercurrentapprovedbehavior, identify exact existingtests/invariants impacted. OnlyignoredPcache note, no newnamespace/schema/gatewayallowlist/worker/SUTchange, no imports/test/build/native/browser/OSprobe. This is future71sourceplanning only (70Fullpending), not newproductdecision or completion; preserve20P30WIP. Cslotunchanged.


**Dispatched stricter ownedbuild source review (before sending):** existing five70monitored helper hashes matched their reviewed69->70label-only reuse manifest. New ignored strictsupervisor changes ONLY initialminimum upward3072->6500; same live1536/300ms/max500gap/exclusivecreatedjob/standardfullAPIcommand/defaultheap/coverage/naturalexit0/currentinputs+outputs/finalization. This is source-only preparation after observed standardbuild memory814, not guardrelaxation or a compiler/SUTchange. Pmayreview exactnormalizeddelta/ownership and write onlyignoredPcache, preserving20T30WIP; no imports/parsers/tests/build/native/browser/OSprobe. Cretains soleheavyexecution for107; Rootno builduntil actualCreturn and currentstrictadmission. No70completion inferred.


**Resume after user "prossiga" / dispatch C Phase16 first (before sending):** disk and git reconcile Root03e590f5a/48complete with19dirty70APIpaths, allagentsreturned. Freshsingle readonlysnapshot20:22:40Z observes6858MiBcommit/3368physical, an actualchange from1880refusal. C nowowns soleheavyexecution for reviewedT107Full under unchanged5168types/build and2048browserguards: preserve/park only105eightownfiles forindependent107, retain d949+70componentproof if source/baseline identical, lint/currenttypes/build/ownAPIadmit/corrected3browser and genuine6captures. No repeat ofunaffectedunits/native55, no guard/oracle/deadline lowering, foreignprocesses untouched. Root/M/P/99source-only whileCexecutes. Afterfull107green andRootcapturereview, mark/atomic107commit; then wholePhase16 continues105before106 under originalgates and explicit resourcehandover. No production/actionauthority implied byresume.


**C107 complete LOCAL before atomic commit:** Full70independent components, types0, affected7lint0, official dashboardbuild0 and actual3/3browser/nativecleanup0 at21:13:11Z. Root inspected all6native1440x1000/390x844 captures PASS before mark. Existing Starter policy/server403 and every original payload/SQL/reload/request-start oracle remain. Failures0/3+firstcleanupAggregate, second0/3 and third1/3 are preserved separately in task-107-evidence.json/cache packets; no absent-checkout412 APIrepair claimed. Productive d949 is PromotionSection only. Eight105own files SHA-backed/parked for independent107commit and restored exact after commit; no105delta staged. Heavy slot returnedRoot, no105/106native until handover.

**C107 reviewed-source attempt refused / exact105restore:** Root accepted dedicated107config/staticwrapper, defaultsharedsetupfalse, boundeddiagnostics and empty-policyupsert. FormalGate/C81dedicatedconfig, validate_tasks0. Fresh8-file105SHAbackup, committed98baseline/d949/a1d4 identical so70proof reused.20:06:43Z unchanged5168guard refused1880MiB, zero typechild/build/correctedbrowser; no repeatedprobe/retry/lowerguard. Eight105files restored8/8SHA at .cache/t107-reviewed-105-parking-20261116T170637. Reviewed corrected sources remain unexecuted/frozen; slot returnedRoot. Original0/3browser+cleanupfailure/noACK retained; task-107-evidence/sourcecheckpoints authoritative.107open/no taskcommit,105open,106ignoredcache-only. No provider/production/featurecompletion/acceptance-print claim.

**C107 first actual browser failed / source-only correction:** latest independent70components0fail/skip against productive d9497d24 and committed98baseline; original15causalcases unchanged. Types refused4970/4918<5168, build never launched. Browser standalone3ended19:41:57Z/exit1/0pass3fail plus outercleanupAggregate. Complete3traces/failurePNGs/decodedRAF observations and causalpacket retained. Servicesmissed-response hypothesis disproven: mainbootstrap/module work consumedinterval before any product/promoGET; GrowthactualadvancedGET200 but helper omitted real closed-details disclosure. FirstfixturePOST10s lacks internal phase evidence; noSEO/cleanup cause inferred. Post-exit readonlyCnodes0, SQL/Redis testcontainers0; noACK/provider0/natural-app-exit claim and noforeignmutation. Eight105WIP/overlap files restored8/8SHA. NEWfixture/setup/bootstrap/disclosure corrections are source-only in .cache/t107-source-repair-20261116T165030 with before/aftermanifests/diffs; task-107-plan/evidence current. No next app/native/browser before Rootreview+handover.107notdone/committed,105notdone,106cache-only; no acceptance prints/feature/provider/production claim.

**C107 partial gate / slot returned:** own4f90aa2e7 integrates authorized Root5e168c03b metadata only after21-file SHA backup;19/19nonmetadata WIP hashes matched. T107source only PromotionSection plus independent component/browser fixtures and minimal setup/config composition. New15+unchangedold55 components70/70green,0skip/fail; affected6-file lint0errors/0warnings. Typecheck child never launched because static5168MiB guard refused4970MiB; no build/browser/native/retry. Sole slot returnedRoot. Three standalone actual browser cases and six native-viewport captures are prepared, unexecuted. No uncommitted105helper import. task-107-plan/evidence and exact pre-full-source checkpoint retain scope/receipts;107 remains incomplete before its Full and Root actual capture review, then105 and106. Current105fourproductive hashes/source6264168b are preserved; seventh originalwhole2 failed, traces backed; no eighth run/task105commit. No provider/production/finalVerifier claim.

**Current resource return / all localwork preserved:** correctedC107attempt20:06:43Z refused1880<5168 BEFOREtypechild andalso belowbrowser2048, so no build/browser/probe/retry. All1058filesrestoredexact, currentd949component70proofretained, reviewedsourcecheckpointfrozen, old0/3+cleanupfailure preserved; no107/105completion ornewcaptures. Creturnedslot; M/Psourceworkandread-onlyreviewsalsoreturned. M55manifest6a1b6cee remains17unexecutedpaths/no blockersfoundinsource-onlyP review;191/77expectednotproof. Root70current906green butfullchecked/nativependingresourceafterowninterruption; no newSUTcompilerdiagnostic. Teamnoactiveapp/test/build/browser andno foreignaction. Current48/108completed remains. Resumeonlyafteractualresource/environmentchange withreviewedguards; no blindrepeatedattempt, guardreduction, incompletecodecommit, fakevisualapprovalorproductionclaim. See conciseSTATE for exactpaths/hashes/gates.


**C107 source-corrected isolatedwindow dispatch (before sending):** first standalone3actualcases0/3pluscleanupAggregatepreserved; causalreview disproved missed response forservice (noGETbeforecold lifecycle ended), firstfixture multi-step10s causeunproven, Growth missingactualdisclosure confirmed. All3RAFdiagnostics advanced/visible/focused. KnownownedCnode/cmd+PG/Redislabels0 afterexit,1058WIPrestoredexact. C v2 source isolates newpreparation through dedicated107config/staticwrapper; defaultsharedsetup adds0actors/newrouteabsent. Real3company seeds await existingglobalsetupbound withregister/create10s andpolicyupsertgrants[], no planupgrade/model/providerstub. Actualbootstrap theneditorstage uses existing10s observations/buffers; realdisclosuregesture and everypayload/status/SQL/403/reload/requeststart assertion retained. Cleanupdiagnostics bounded6nodes/depth3/code3 and preserveoriginalerror. Productive107d949+15causaltests unchanged/70passed; priorfailedrunsretained. Root readonlyreview acceptedsourcecorrection, formalGate/C81configupdatedbeforeexecution. C may SHApark105only and ownsole refreshedtypes/affectedlint/build (5168guard), ownAPIreadmission, corrected3browser(2048guard); no repeat70unless actualproductive/baseline drift. Ifresource refuses, retainrefusal, no repeatedprobe/guardlowering. Root/M/P/99source-only. Full107requiresallgates and genuinecaptures; partialbrowseralone neverclose.


**Dispatched readonly55source review (before sending):** M55frozen17paths at base01e41f884, source manifest6a1b6cee under M/.cache/t55-source-prepared-20261116, all implementation/tests UNEXECUTED and old54stamp stalefor55. P may read only that bounded source/plan packet and write ignoredPcache assessment for callback signature/exactURL/history/attempt/no-start/privacy/rollback/regression risks. Preserve all20P30WIP hashes, no edit to M/N/C source, no application import/parser/test/build/native/browser/OS probe. This is preparatory source review, not finalVerifier or gateproof. C retains sole actual107browser run; Root70Full remains resource-interrupted. No new task completion or provider action.


**Root70checked attempt interrupted / source proof retained (before next handover):** ordinary fresh build initially admitted5382>=5168 and capture passed, then hostcommit dropped814MiB at19:22:46Z during maincompile. Root sent Ctrl-C ONLY to own execsession91036; returned1. Poststop readonly known-N/exactlauncher command scan matched0, foreign processes/containers untouched; no compiler error shown, no record stage/currentartifact/native claim. Receipt .cache/t70-gates/2026-11-16T19-17-26.170Z/interruption.json preserves exact log.906components remain green,70Full pending. No automatic rebuild/guard reduction. With that heavy compiler now stopped, C may receive one new existing-resource-admitted107window; if5168type/build refuses, preserve refusal and only independent actualbrowser under its original2048guard is permitted as PARTIAL evidence, never complete107withoutfulltypes/build. Freeze105WIPs and keep107case/fixtures independently replayable; no extra product decision or test weakening.


**Root70whole906passed / official fresh checked build (before execution):** combined54+70source completed906/906components,0fail/skip/cancel, including new caller-timeout negative, at .cache/t70-gates/2026-11-16T19-14-14.210Z/unit.log. Root retains sole execution for standard5168-admitted .cache/run-t70-gate.mjs checked: fresh capture, full normal pnpmAPIbuild, existing checked artifact record only after0. If static preflight refuses, preserve it; exact previously reviewed monitored69->70label-only helpers may be used only with3072initial/1536live/300ms/max500gap/ownJob/natural0/noBreach/currentinputs+outputs and reviewed finalization. Never use old69artifact. C/M/P/99remain source-only. Native13andold gateway/evidencecohorts still pending; no70completion from components/build alone.


**Root54integration / sole70final-component window (before execution):** M54commit01e41f884 integrated as Root9f0df7829, only STATEconflict resolved with current concise handoff and54local evidence. All20nonoverlapping own dirty70files remain byte-equal to final backup1a203ef7; own handoff additions reinserted without replacing54status/spec. C10770unit/lintgreen but types preflight4970<5168refused beforechild, no build/browser; C returned slot. Root now runs the whole70component cohort with its new caller-timeout negative (expected906; actual runner authoritative) on combined54+70source via unchanged1024resourceguard. M55/C/P/99 source-only, no concurrent app/test/build/browser. After green, fresh own official70build and actual nativequery gate remain required. No lowering of resource/compiler/test guards or release action.


**M54 returned9/9 / dispatched C107 remaining standalone Full gate (before sending):** M originalAPI9 passed9/9,0skip/fail/cancel, natural exit0 and own a104/8b40/2547 integral admission before/after at .cache/t54-gates/2026-11-16T19-05-17.370Z. Original15s predicates completed under3s; terminal/close diagnostic emitted no failures, so no cause for historical6/3 inferred and no relay/deadline change. Root authorized54evidence/status/atomiccommit with all128components/55native, retaining history. C now owns only remaining107dashboardtypes/affectedlint/build + actual standalone3browsercases (Starterproduct/Starterservice/Growthproduct) under existing unchanged resource/time guards and independentfixtures. Real saved-editor route, realGET/PUT/basic promo/direct403/SQL/reload and six1440x1000/390x844local captures planned; no105helper imports or old tests changed. If renderer stalls, preserve trace and diagnose actualRAF/visibility instead of another blind run. Root/P/M/99no runner until C returns; source/docs integration allowed. No107completion before whole gate.


**C107 components returned / dispatch M54 diagnostic once (before sending):** C10770/70components (55old+15new),7files,0skip/fail, natural runner0 at .cache/t107-execution/components-2026-11-16T19-03-46.421Z. No C runtime/browser remains. M may now run one unchanged2048MiB-admitted official API9 failure-only diagnostic using its own admitted a104/8b40 build; preserve exact approved6c3293 reconstruction, fifteen-second predicates, every status/cleanup oracle and resource guard. If preflight refuses, retain refusal and return source-only, no repeated polling/retry or threshold changes. Root/C/P/99 no runner/build/native/browser until M returns. Foreign task trees remain untouched. No54or107Full completion inferred.


**Root T70 components returned / dispatch C107 independent component gate:** Root905/905,77suites,0fail/skip/cancel at18:54:37Z log, duration266247ms. Full70 remains pending fresh own checked build and native SQL/Neo4j/gateway proof; old69artifact printed by launcher is stale for productive70inputs. C may run one prepared107component gate under unchanged resource admission and report start/end; no build/browser/native until a further handover. Root/M/P/99 no runners. P may read-only review70source and keep20own30WIP exact. This metadata commit only records the observed403 and technical dependency reorder107before105, no task marked complete or new product decision.


**Source diagnosis / independent107 repair-first dispatch (before sending):** new C-resume proved catalog module import starts the data request after10s and service click lacked rendering frames, without a movement/overlay cause yet. No eighth blind105run. Since107 depends only on the existing PromotionSection/API entitlement and completed98, remove the artificial105→107 dependency: execute107→105→106, same requirements and separate atomic gates; this preserves the already-observed403repair while larger browser/native work is resource-blocked.107plan/tests/code may now be prepared in C without overwriting any105delta. Gate107must use independently committed tests/fixtures, not new uncommitted105 files. C remains source-only until Root returns T70component57186; current onlyRoot executes. No107completion before its own Full. No business/plan/permission change, new production authority or test-oracle deletion.

**M diagnostic resource refusal / Root T70 component window (before execution):** the single M-resume attempt stopped at2048MiB preflight with1082MiB commit margin, zero API9/business cases or new containers. Refusal receipt371836a2 is retained; diagnostic still unexecuted, no scheduling causation or cleanup-success inference. Foreign tasks remain untouched. Root now owns only a resource-admitted T70 unit/component run via prepared .cache/run-t70-gate.mjs unit (existing minimum1024), not a full API build/native waiver. C/P/M/99 source-only; no concurrent browser/probe/native. If refused, continue source work, no lowering of either threshold. T70 source/gates remain pending; partial components cannot close Full.

**Dispatched M-resume sole official API9 diagnostic window (before sending):** operator_delivery_resume reconciled MHEADbda and all54WIP; diagnostic officialdbd837af/helpera981/patch1ce5/manifestedaa match, removing observation reconstructs approved6c3293 exactly. No own M/C Node or PG/Redis remains; foreign fiscal/meta-ads/agentic tasks are not controlled or modified. M now owns only this team's execution slot for unchanged resource preflight, integral owna104/8b40/2547 admission and one official native-appmodule/API9 diagnostic. No warmup/direct dispatch/clock/quota/deadline/oracle/SUT changes, no repeated unrelated gates or rebuild absent actual productive drift. Keep fail-only SQL/2metric/6node diagnostics sanitized and rethrow original failures. May add only known non-sensitive pool error code P2024 before freezing if needed, recording new hash; no raw error output. C/P/Root/99 source/read-only until actual M return. Next decision is driven by observed pending/attempt/last-dispatch and cleanup causes, not the source hypothesis.54 remains open; no task/production approval inferred.

**Resume 2026-11-16 after user "prossiga":** live collaboration tree contained onlyRoot; previous agent names are no longer active. Disk confirms seventh105ended17:47:09Z/exit1/two failures, natural cleanup logs; no105commit. Product still missed catalog-response10s; service reached schedule but Add slot click could not become actionable/stable10s. Do not repeat the same fixture blindly or call a pass from partial screenshots. RootHEADbda/47complete;70API stilldirty/unexecuted. M54diagnostic draft dbd837af/helpera981 is prepared only, official6c3293 assertions reconstruct exactly; no54commit,128+46oldgreen/API9sixpass-threefail preserved. New C-resume owns wholePhase16 source diagnosis only initially, M-resume owns originalPhase7 diagnostic only, P-resume readonly relay design; all must reconcile logs/ownership and await explicit sole-execution dispatch. No new production authority from the null Companion Page snapshot.

**Dispatched relay-start source assessment (before sending):** P may prepare only ignored cache notes for the suspected next-minute initial outbox gap, reading actual pinned BullMQ source/types, existing relay tests/lifecycle and official BullMQ documentation. No productive changes/import/test/Redis/OS probe, new scheduling or clock mutation. Compare a bounded immediate startup scheduling option against current one-worker/repeat/durable-lease/shutdown semantics; identify any existing oracle impact instead of silently changing it. M's frozen sanitized diagnostic will confirm runtime timing before a production repair plan is selected. This is not an approved causal finding, not Task109 implementation and not finalVerifier. C currently owns seventh105execution, M diagnostic source-only, Root70API remains unexecuted.

**M54 returned / sole window to C105 seventh (before sending):** M API9 realrun6pass/3fail,0skip; two delivery predicates exceeded original15s and cleanup returned AggregateError. Owned fallback left0MNode/containers, do not report natural clean success. a104/8b40readmission passed;54notcommitted. Source suggests BullMQ relay schedules only next-minute repeat while dispatcher disables fallback timer with Redis, but timing causation and nested cleanup cause remain unproven. M may prepare only bounded sanitized timeout/outbox/cleanup diagnostic in source, retaining exact approved timestamp expectation and all15s/status assertions; no new run/production change until next handover. C's seventh helper626… successor uses real Catalog Edit/back gestures/no reload/quota reset, code-confirmed readiness and all payload/reopen assertions intact; C may now run its reviewed unchanged81/108base/API guard108/currentfa8c whole original2 under existing budgets. No107/106productive source until105green/commit. Root/P/M/99no runners while Cowns. Original consumer failures and all prior evidence stay recorded.

**Sole execution handover C→M54 API9 (before sending):** C sixth cleanup confirms0ownedNode/containers, app ACK/natural exit/provider0/timers[]; guard108 worked in both fifth/sixth actual app startups.105stillnotcomplete: current failures concern cold UI navigation/reloads (including excess403/429 advanced-rule traffic), all78units/types/lint/build/currentownAPIfa8c preserved. C now only repairs its new test helper using real SPA catalog/back gestures/readiness, retaining every persisted-value assertion and existing budgets; no seventh/107/106runner. M is aligned atbda with24ownfiles exact and official6c3293 intact. M now owns sole window for actual integral artifact/client admission of a104/8b40, then ONLY pending originalAPI9. On green, mark54/commit atomically without repeating still-current128unit/46othernative or claiming fullfeature/provider delivery. Root/P/C/99no runners until Mreturns. Source54/105/coreAPIs remain as before, no new business policy or guard relaxation.

**Committed108 integration / sole window handover to C (before sending):** bda28419d contains only the three JS native-collector files,108plan/evidence and metadata; no Root70API source. Full30 native/old/new contracts and syntax are green, exact old ownership body hash29c94e45 preserved. C may SHA-back all105WIP/metadata/cache, restore only its own backed overlapping metadata, merge committedbda, recompose own105partial record and validate productive API/packages/schema/lock still byte-equal to f09 (its own checked fa8c/1d61). Preserve all four105control/fixture hashes and failures; never import Rootdirty70/dependencies/outputs. C owns execution for pending original105whole2 on the repaired collector, then its105atomiccommit and107as conditional prior dispatch. No repeated API build if actual own input/output/client admission stays equal. M may align only committed108 source/docs under the same preserve/three-way procedure, preserving54deltas/128+46/approved6c3293, but no M runner/import/probe until C returns. Its actual API9 remains next. Root/P/99 no runners; consumer results decide, no predeclared success.

**T108 Full30 passed / dispatched concrete source review (before sending):** standard sanitized runner .cache/run-t108-gate.mjs guard completed syntax checks and30/30 whole old/new contracts,0skip/fail/cancel. Finalrun .cache/t108-gates/2026-11-16T17-06-54.040Z; real native TCP forced-blank-getter ownership/closure passed, existing two old files unedited. Before finalrun a new malformed-prefix case strengthened the parser to reject partial TCP rows rather than ignore an ambiguous trailing row; no old assertion altered. P may review the exact three-file108delta and actual proof before commit, no edits/runners. Root retains sole execution, unrelated70API unstaged. Original affected C105browser2/M54API9 remain pending after108integration, so this is not feature completion.

**Root acquired sole T108 execution / dispatched source review (before sending):** C returned after its fourth105attempt failed before readiness with zero business cases; no remaining C Node/owned containers and no AggregateError, do not claim admitted app ACK. M already idle, allsource54/105 frozen with partial evidence. Root owns a narrow T108 JS-only repair in N (Root70TypeScript remains unstaged/unexecuted). P may review existing proof and proposed fixed native netstat collector read-only against official Microsoft docs; no productive edit/import/test/build/OS/process modification. Preserve every existing ownership assertion/10s bound, old logs and failed setup counts. Root implements/tests then commits108 independently; affected C/M consumers rerun after integration. No new user approval needed for implementation of the existing native ownership contract, no external/OS/global action or test-oracle edit.

**Dispatched conditional107 continuation and extended C window (before sending):** C owns whole Phase16. Finish105 green/atomic first; then preserve its exact committed105 and align only Rootcommittede4e5783dc metadata (no Rootdirty70API), recording/resolving metadata status without discarding105proofs. CurrentCAT05/C81/T107 formal files are in that commit. Source-only107plan must precede productive edit, then its own unfiltered units/types/lint/dashboardbuild/actual local browser and atomic commit. Existing105 third trace confirms advanced-rules403 for both modes; keep Starter negative, no billing upgrade to conceal it or toast hiding. Only existing hasFeature/cancelled effect policy, noAPI/schema/plan changes. Fresh own API fa8c/1d61 can be re-admitted byte-exact because107 is UI only; do not rebuild unchanged API or use foreign artifacts. C retains sole window through107 for readable final captures; M54API9 rerun follows its return.106productive source remains blocked by107gate/commit. Root/P/M/99no runners. Original diagnostic images and failures remain, no final screen/feature/provider claim.

**Catalog107 repair planned, not dispatched:** C105 browser observed Starter's rule-loading toast; source PromotionSection effect always calls advanced-rules but render already uses hasFeature, backend gates Growth. Added narrow107 after105/before106 and CAT05/C81 without changing the policy. C may finish frozen105 and report exact network observation first. No productive107 or106 edit yet; no skipped105gate, plan upgrade, toast hiding, API changes or claimed repair from the source hypothesis. Counts81criteria/107tasks, completed46 until actual105gate/commit.

**Dispatched T55 external provider-contract preparation (before sending):** M may prepare ignored cache-only source inventory and primary-provider documentation for status callback correlation/admission after54. No productive55edit or execution before54green/commit; C owns105window. Cover existing Meta opaque receipt correlation, missing Twilio StatusCallback/verified-account route, Bubble identity proof limitation and truthful unknown/unavailable outcomes. Reuse established producer event/lease/case/attempt proofs; no arbitrary body IDs, fabricated SIDs, credential output, provider/customer communication or old AI sender changes. Root will review the concrete plan; local mocks and browser states do not prove external delivery. M54approvedAPI9 remains pending later window, not waived.

**Dispatched T71 external preparation (before sending):** P/service_professional_agenda may prepare only ignored cache notes against current Root70 source for the remaining grounded buyer-flow integration. Map actual namespace-pinned SQL fallback, public runtime candidate selection, unchanged69provenance/audit and regulated/clarification behavior, current price/availability tool authority, and verified WhatsApp/socket TenantALS composition. Preserve P30 uncommitted source/checkpoint; no productive edits/imports/tests/build/native/provider. Root remains Phase9 author and T71 cannot start productive work before70 green. C owns105execution; this preparation is not final verification or quality proof.

**Sole execution handover to C105 (before sending):** M returned its window after46/46native (PG16/adapter10/old13/runtime7) green and a failed later API9 setup with zero business children: owned Get-NetTCPConnection capture exceeded its existing10s deadline. It reported no remaining M Node commands or owned Redis/Postgres containers and no AggregateError; because readiness never completed, do not claim an admitted AppModule ACK/exit0 for that attempt. No guard/deadline change or new productive defect asserted. M keeps only source/cache review, approved6c3293 oracle remains applied awaiting actual9rerun later. C now owns sole execution for105: reviewed own source atafd867ca plus its four control deltas; source SHA checkpoint preserved/refreshed before runs, full unfiltered unit→types/lint→fresh own checked API→dashboard build→real protected browser, each normal resource/ownership check. No artifact/dependency sharing or Rootdirty70 import. Primary captures should use the actual1440x1000 and390x844 viewport with target visible for readability; optional full-page kept separately, no post-resize. No105completion before green gate and atomic commit. Root/P/M/99 no runners until C explicit return; Root70source remains unexecuted.

**T70 source prepared, zero execution:** separate pinned public sources/pairs compiler and hash, signed Community operation/admission, bounded actual engine/direct/client readers, separate runtime readiness and local embedding retrieval; canonical pair method uses one unchanged snapshot and both endpoint/link proofs. New4unit files plus12native children are written, unexecuted. P read-only review found two fixture issues fixed before any run: observed/released/drained held response and Starter catalog→Growth policies entitlement ordering. Foreign real published source canary and unchanged foreign state strengthen actual namespace separation. C38 proof now selects the actual new full files, no zero-match/skip pattern; old query/hash/TTL/tests remain unchanged. Ignored .cache/run-t70-gate.mjs is prepared from69 with added pair cohort/public mode, unchanged resource guard. Full remains pending sole window and a fresh own checked artifact; old69artifact is stale for this source. No current RAG buyer-flow/provider/production claim.

**Settled test correction / dispatched exact application (2026-11-16, before sending):** user: "Sim, corrigir a expectativa do teste (recomendado)" (reply call_f467064279f64627b220b0e1727ef4da). M may apply only approved HTTP test candidate6c32932e9c25c627dbecc49b2bdb46f7db9ddb5092e84dcc6263ae7575884f86, patch06290559f6f04eb24d3ae7e3185e9abc09fb79a53bcf79d1a6eedcf67b589fed, originala19442c8cd312c84193af6cc8b557cc4ec30714c10bb8c78ce8a6734e8a088b7. Preserve full before-enqueue snapshot; only expected ticket.updatedAt uses exact canonical queued message.createdAt at four sites/five child contexts. Every other assertion remains. Repeat actual9 after the ongoing independent cohorts on the unchanged current checked artifact; do not mark Full until actual all55 pass. M remains sole executor, C105 prepared/not run and Root70 source/review only. Record approval in M metadata before applying. No productive or remote action authorized by test approval.

**Returned T70 source design review / dispatched current-source follow-up (before sending):** P proposed a distinct revalidatePairs over one existing canonical.read, requiring both admitted endpoints and exact current service.publicData.professionals ID. Root implemented that narrow design without changing canonical port/read signatures. P may now review Rootdirty70 source/tests read-only for concrete source/schema/fixture mistakes before first execution, including full real native setup, gate paths, legacy preservation and race cleanup. No edits/imports/tests/build/native; M still owns execution, this is incremental review not finalVerifier.

**Dispatched Phase16 catalog refinements source (before sending):** C/service_company_ui owns whole Phase16 T105→T106 in its isolated checkout. First preserve its current clean98 and cache/drafts, align only committedRootf09c217e6 (not current Rootdirty70). Re-read exact new task/spec/plan and record105minimum file inventory. Reuse ToggleSwitch, including accessible label/focus/keyboard/disabled state, keeping serialized serviceSchedule and selection controls. Source105 only initially; no tests/import/build/browser/container until M returns execution and root explicitly hands over. Gate105 then own commit before productive106. T106 saved-service panel reuses paginated GET/PATCH productIds+expectedVersion, owner/admin, explicit partial/conflict recovery and preserved other links; no new backend writer. Future76reuses same client. Native resources/old assertions/production boundaries unchanged. This is author implementation, not finalVerifier/screens.

**Dispatched T70 source review (before sending):** P/service_professional_agenda may read the external C t70-preparation draft and current committed Root69 interfaces, then return a narrow design review of parameterized public read capability, canonical service-professional pair admission and reused operational boundaries. No productive edits/import/test/build/native/container; preserve its own uncommitted30checkpoint and role as author, not finalVerifier. M owns execution. Root remains T70 author.

**Dispatched catalog refinement preparation (before sending):** service_company_ui may inventory/cache-plan T105/T106 in its existing isolated checkout, preserving Phase8 drafts. No productive edits or tests/build/browser/import/container until formal plan review; M owns sole execution window. User explicitly requested toggles and professional associations. This dispatch was recorded after the initial tool delivery; further source authorization will be recorded before sending. Current80criteria/106tasks; original approvals and local-only boundary remain.

**Dispatched M54 alignment and sole gate window (before sending):** committedRootad81d32c9f6803dbbf923324d6f6b765c865497d includes green69/104/98 and all earlier29/53. Root83native ended naturally; no active Root compiler/runtime remains. M preserves its exact26-file54freeze+metadata/cache before aligning only this committed base. Temporarily restore only its own SHA-backed tracked deltas, merge committedRoot, then reapply54with original blobs/three-way review; never copy Rootdirty user-feedback context, dependencies or outputs. Resolve additive69runtime fixture wiring without dropping either opt-in or old default oracles. Recheck schema/lock/source authority and new source fingerprint. M now owns the sole window for its recorded54units→fresh checked/API→native55 under unchanged resource guards; source fixes allowed after actual failures, no old assertion weakening. No old M53artifact reused or54completion before Fullgreen. Root may prepare70source in N and new UI refinement plans; C/P/99no runners. M continues its original54-55batch sequentially, each actual gate/atomic commit; no provider/production actions.

**Settled user UI feedback (2026-11-16):** user: "está sim mas trar checkbox por toggle e poder vincular um profissional a um serviço se ja nao tiver". Record acceptance of the shown mode split with pending ToggleSwitch/professional-association refinements; no release authority or fabricated final screen approval. Backend professional association already exists through productIds+expectedVersion under owner/admin and tenant/mode guards; inventory actual shape/concurrency before new UI, no duplicate writer. Keep69full closure and other approved work moving; new UI follow-up plan/source will be isolated after concrete task records.

**T104 atomic commit complete;69remaining gates (before execution):**19483cdc42834a9f64ff65a4b808f394d85fc8fd stages only104source2files/plan/evidence/status, after879components/51actualnative/checked2543fa8c-1d61green.45/104complete. Metadata-onlyce8af091e separately records requested support/board plan; no69or99source staged in either. Root now repeats the mandatory new provenanceHTTP9 on the current post104artifact, then coexist23 after its natural cleanup. No fresh build or unit rerun needed without a source-content change; native validators must still admit exactfa8c/1d61 after commits. No source/test changes during these gates, no remote/provider action; other agents remain source-only.

**Dispatched Phase8 cache preparation refresh (before sending):** C98is complete/returned. C may refresh its existing wholePhase8T56-T62 preparation in ignored cache only while M55is pending. No productive edits/imports/tests/builds/browser/provider. Read frozenM54proof/types, record exact proposed files/contracts and review: all WhatsApp ticket close/status/transfer writers must respect canonical close+resume; resumed-AI notice needs its own current epoch/purpose proof, no fake inbox or reused human-message authority; semantic tool-created handoff must use the confirmed server-only notice path, not arbitrary model text; staff Conversations access must be separate from credential controls/requests. Preserve original batch dependency55, gates, all old buyer menus/product routes and phone99-101scope. Not finalVerifier; Root retains native43260sole window.

**Current104/69 checked build green, native next (before execution):** unchanged full standard API command0/2543 at .cache/t69-gates/2026-11-16T14-58-30.444Z, current inputfa8cefd9/artifact1d6187f5 recorded15:05:24Z. Components879green;44tasks remain complete,104/69notcomplete. Root now runs existing unfiltered index14 under fresh2048MiB native admission, then only after green the unchanged revalidation37. No warm-up/observer/timeout changes, no source/test mutation during native. C98source is integratedf287; all other workers idle/source-only and Root99unexecuted.

**Root98 integrated;104fresh build (before execution):** Root f28703c69 integrates C98source4ddb706d1 after Full55/2/types/build/lint/defaultCAPI2bcd/cleanupgreen. All36own files SHA-backed; only3metadata temporarily restored, STATE-only conflict section-scoped, no69/104APIfile staged.33nonmetadata own files byte-identical after integration; pending78criteria/104task additions restored with completed98block/C73-C74checks.44tasks complete. Component879/879 passed on the same untouched API source; UI98 has no API/package/lock changes. Root retains sole window and now starts one fresh unchanged standard checked API build after its5168MiB admission. If refused, no stale record/native accepted; exact previously reviewed monitored path remains the alternative. No source/test changes during capture/build.104/69remain open until their full native gates.

**Returned P104 review:** no blocking source issue identified for17+/15- query delta; old tests diff0. CALLunit preserves source-row cardinality, FOREACHscope/5.26semantics and same tenant/source lock/CAS reviewed against primary docs. Newunits are boundary mapping only, not Cypher/performance proof. Native14/37unchanged still required; finalVerifier not dispatched.

**Sole execution window Root104 components (before execution):** C98 reported complete55unit/types/lint/dashboardbuild, ownAPIchecked2bcd and actual browser2/2exit0 with natural cleanup. C finishes evidence/local98commit using metadata/git only; no more runner/build/browser. Root now takes the sole window for the unchanged unfiltered component launcher, whose graph glob includes the new5-case104companion (879expected, actual runner authoritative). API source/old tests frozen; C98integration waits for this run to finish. P/M/Root99 remain source-only. P104source review returned no blocking issue, no execution claim. Old395d/d33dAPIartifact is stale after104 and cannot serve native tests until fresh checked build.

**Dispatched incremental T104 query review (before sending):** P may review only the current17-add/15-remove projection-query repair and its new five-case boundary companion/plan in N. No edits/imports/parser/tests/build/native; C98 browser57843 is sole execution owner. Focus source-root lock/CAS, no-row unit-subquery cardinality, scoped retirement, withdrawal, single atomic rollback and legacy namespace preservation. Actual native performance remains unproven; this is not finalVerifier. Root's old395d/d33d build and874components are now historical for the pre104source; new source requires a fresh complete checked gate and unfiltered cohort before104/69completion. No old assertion/deadline/testfixture changed.

**Root69 observed failure diagnosed; window returned:** the observed rerun again ended22/20pass/2fail, with the same pgvector16 seed projection failure. Actual compiled-adapter observation captured Neo4jError code Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration, duration3114ms, against unchanged2000ms transaction configuration. Default profile15 and publicHTTP4 passed; no source/query/driver/assertion/deadline was changed. Error propagation kept the projection unavailable and job failed truthfully; do not count the incomplete37green or infer a new69source regression from the cold local deadline alone. No blind rerun loop, warming/skip/timeout increase or test-oracle change. All owned resources closed naturally and session79830 ended1.69Full/index14/coexist23/commit remain pending. Preserve new checked395d/d33d and native9pass as separate evidence.

**Dispatched C98 independent validation (before sending):** C receives the sole window after Root79830 natural cleanup.69is not committed/aligned, so do not reuse its artifact; use a fresh fully guarded official C API build on its committedb5adc+own98 source, plus actual own Prisma, exact frontend types/build/lint/unfiltered55 rerun and local browser/screenshots. One fresh resource admission; if refused, preserve proof and return without polling. This independent T98 depends on completed17, not69. P/M/Root99 stay source/read-only, Root no compiler/native while C owns it. Original product API/human support/RAG gates remain required for the complete feature; no remote/provider action.

**Native69 failure and observed rerun (before execution):** current ordinary revalidation ended22tests/20pass/2fail/0skip/cancel; pgvector16 initial projection reportedgraph_unavailable before15children, while publicHTTP4/default15passed. Cause is not proven and all failures stay recorded. Root reviewed the ignored observer: it delegates actual compiled withProjection with identical this/args/result/error, logs only safe status/duration/errorcode, never changes driver/query/retry/timeout. A logging failure makes the process non-green. Exact copy of existing launcher has one changed line adding the observation import to the same unfiltered37 command; default launcher/assertions/deadlines remain untouched. Run one observed revalidation to capture the collapsed graph error; no dependent completion before resolving any reproduced failure. Same checked395d/d33d source frozen, Root sole window.

**Dispatched C artifact-reuse preparation (before sending):** while Root69 native gates run, C may inspect source/manifest contracts read-only and prepare an ignored proposal for immutable checked-artifact transfer after69is committed and C is aligned. Exact canonical input hash, entire generated outputs, schema/Prisma ownership and current source checks are mandatory. Do not copy dependencies, share mutable clients, relabel an old build, execute a helper/test/build or mutate N outputs. No API compatibility is claimed yet. If the existing validators cannot establish complete binding, retain the requirement for a fresh official C build. T98 stays open and this is no finalVerifier dispatch.

**Dispatched incremental T99 source review (before sending):** P/service_professional_agenda, whose T30 preparation is preserved and has no process running, may review the isolated T99 source/tests in C:/tmp/zyon-support-alerts-20261116. Read-only inspection of private schema/tenant/auth/FAQ-RAG exclusion and criterion-derived fixtures; no source edits/imports/tests/builds/containers and no finalVerifier role. Root69 keeps sole native window. Return concrete issues/paths without treating unexecuted tests as evidence.

**Root69 current checked build green:** unchanged full API build2543, input395d3e5a/artifactd33d4ef7, supervisor20261116T133527312720Z natural0/noBreach/noForce/jobEmpty, initial6478/min3484MiB/maxgap313ms. Exact bound finalization completed0 and checked record published13:42:38.272Z. Native provenance9 now runs session42842 after fresh6983MiB admission; Root still owns sole window. After its natural cleanup, run existing revalidation37/index14/coexistence23 sequentially on this artifact.874units remain actual/current (no dirty API file mtime after unit start). No T69 completion yet. T99 source/tests are isolated in C:/tmp/zyon-support-alerts-20261116, zero tests/build/imports there, not in69fingerprint.

**Sole window Root69 after C return (before execution):** C's one fresh static admission refused4404MiB at13:34:45Z, with no child/compiler/browser or owned process. Its first window remains55units/lint green, no T98 completion. Two earlier large processes have naturally exited and physical availability improved; Root may make one fresh-admitted attempt of the unchanged reviewed3072/live1536/maxgap500 owned-Job checked69 supervisor. No weaker threshold or repeated loop; no source/test mutation in N during capture/build. Root99 remains separate source/docs only, P/M/C start no runners. A monitor refusal yields no attestation regardless of reserve. Native gates wait for successful reviewed natural0 receipt and exact binding.

**T98 execution handover renewed (before sending):** C returned its first window with55units/lint green and resource-refused compiler/browser, no owned active process and no task completion. Read-only inspection now shows the two previously observed large unrelated/unknown Node processes and their parents no longer exist; C did not terminate them. This is a material environment change, not permission to kill foreign work. C may take the sole window for one fresh unchanged admission and resume recorded types/build/browser if admitted. Root T99 only source/doc work in its separate checkout; Root69/P30/M54 no runners. Preserve earlier ENV/TypeScript fixture diagnostics and all gates.

**Independent source continuation T99 (before implementation):** the memory refusal prevents current compiler/browser gates, not the already-authorized private-setting source task after completedT53. Root preserves dirty69 in N and prepares T99 in a separate local checkout C:/tmp/zyon-support-alerts-20261116 from committedb5adc21f3, with the current explicit-addition spec/tasks copied as local metadata only. No uncommitted69 source, dependency/artifact copying, test/build/container or task completion. Exact assumptions/files/tests are recorded in task-99-plan.md before source edits. Root owns Phase14 preparation; C remains author of98 and its gate checkpoint; P30/M54 retain their isolated deltas. No source99 is staged into task69.

**Settled mid-build (2026-11-16):** user selected "WhatsApp, com link para a conversa (recomendado)" for the fallback-phone alert. Implement a private support-notification recipient with a minimal authenticated conversation link, preserving the original customer thread. No pending channel choice, no SMS implementation. The new service Kanban and semantic/notification additions are explicit user requests; concrete task/criterion amendments follow the audited canonical models and preserve all original gates.

**Heavy69 returned:** the unchanged supervised build at .cache/phase3-gates/t69-supervisor-20261116T124255838431Z ended ENVREFUSAL_DURING_OWNED_BUILD. Initial4548/min4432MiB did not breach the reserve, but a6375ms scheduling/journal sample gap exceeded the existing500ms observation bound. The owned job was terminated and empty; no child exit0 or build attestation. No compiler flag, test deadline or monitor threshold changed. Current874/874 components remain valid source-based evidence; the old checked artifact is stale. Root starts no new heavy process while C owns the UI gate window.

**Dispatched T98 UI gates (before sending):** C/service_company_ui now owns the sole execution window for the recorded T98 component/typecheck/build/browser gates, after fresh admission by the unchanged applicable resource guards. Root69/P30/M54 start no runners/builds/native/containers while C holds it. Source can finish before capture; freeze it during gates. Browser fixtures and screenshots remain synthetic/local, no real provider or production calls. Preserve old component cohorts unfiltered; report actual counts/commands/receipts and any resource refusal. Do not invent a dashboard lint script or lower build thresholds. Return the slot after natural owned cleanup. No T98 completion/commit before its gate.

**Dispatched T98 UI continuation (before sending):** C/service_company_ui may implement the directly requested catalog creation UI now as T98, independently after completedT17, using the two exact CAT criteria above. First preserve own clean source/metadata/checkpoint and cache inventory; align an isolated branch to committedRootb5adc21f3 without copying Rootdirty69 or shared caches/artifacts. Compare lock/schema and component base hashes, preserve any own metadata in SHA backup. Compose only the new T98 specification/task/check records into its metadata; do not mark69complete. Read impeccable current product register/use existing tokens; the optional upgrade was already declined by the user. Source/plan only initially; Root will explicitly hand over the UI test/browser/build window after no heavy69process remains and fresh resource admission. No new provider/production/remote actions. Other phone/kanban additions remain separate amendment work. This worker is an author, not finalVerifier.

**Heavy69 resumed (before execution):** user explicitly resumed local implementation. Fresh read-only Windows commitment5783MiB at12:39Z, previous suite complete874/874 and no owned heavy process active. Root rechecked exact69supervisor e35d44bc/worker ca5e5c97 against the already-reviewed literal-retarget manifest. Run one unchanged full checked69 build-only on current b5adc21f3+dirty69, monitoring existing initial3072/live1536/300ms/maxgap500/ownedJob rules. No source/test file mutation during capture/build; all src/spec files also fingerprinted. No finalization/native until actual receipt natural0/noBreach/noForce/jobEmpty/source-output binding is reviewed. P30/M54 source-only in isolated worktrees, C additions inventory/cache-only; no other runners/builds/containers. New amendment metadata does not enter productive fingerprints.

**User resumed execution and requested additions (2026-11-16):** user: "entao prossiga ate fecharmos com isso" and "prossiga com o que falta ja mapeado" explicitly revoke the temporary review-only restriction and resume the existing approved local implementation/commits/tests. User additionally requested semantic recognition of human-attendant requests plus a configured fallback notification telephone, a services-only scheduled-services kanban page inspired by Orders replacing the service-business Orders navigation, and service creation offered only to service businesses. Record these additions as a scoped amendment after auditing existing code and resolving genuine missing product choices; no fabricated approval of an unwritten amended spec. Existing97task implementation continues independently. Local-only/production/product-preservation bounds remain.

**Dispatched continuation (before sending):** P/service_professional_agenda resumes its existing Phase4 T30-T32 from committed29, with plan/source only while Root owns the next full checked69 window. M/service_batch_01 resumes existing Phase7 T54-T55 from committed53, plan/source only and original-account/lease/privacy invariants. Neither may start a compiler/native/container/focused runner until Root hands over sufficient resources. C/service_company_ui receives read-only/cache-only inventory for the three new additions: reuse current Orders kanban, service status/actions, catalog business-mode choices, handoff notifications/settings/semantic intent. Return exact source paths and unresolved product choices; no productive edits/tests/build/container. Not finalVerifier. Root owns amendment/spec/DI integration and current69 gate.

**Read-only review result (2026-11-16):** the already-running combined component cohort finished naturally874/874,0fail/cancelled/skipped/todo,294503.3406ms, .cache/t69-gates/2026-11-16T12-12-37.214Z/unit.log SHA404fc5a05e83006c978fe80b58de1541d7fe319cf1fee94d717194a039eff5a5. This is source-level component proof at b5adc21f3 plus dirty69, not a new checked artifact/full69/production proof. No heavy process remains. P and M returned read-only reviews; neither created productive30/54files, only their permitted STATE checkpoints. C's cache-only70proposal is returned, not imported. No new code/test/build/commit after the user's review-only instruction.

**Reviewed remaining work, with concrete source evidence:** T70/71 public corpus selection is not yet wired: QueryKnowledge currently selects legacy graph/SQL (query-knowledge.use-case.ts:66,92), and the legacy repository deliberately excludes public-business-v1 (prisma-knowledge.repository.ts:186,214). Preserve that namespace separation and add a pinned public selector; do not broaden the legacy query. T71 verified-channel scope remains missing at WhatsApp adapter:395 and Storefront socket gateway:113 while PrismaPublicEvidenceSources:31 requires TenantALS; socket buyer identity at:39 is retained for rate limiting but not passed into the message use case. Establish scope only from the verified live channel/capability, including buyer validation, then prove actual channel routes. These are mapped incomplete feature paths, not a production incident claim.

**Reviewed T54 provider gaps:** BubbleWhats sender:16-18 uses global URL/token and its outbound body:45 contains no config/device binding; original-account authority needs a server-owned mapping before new human dispatch can claim it. Sender:29-32 prepends55 to explicit international numbers while fence:51 uses the original recipient; the existing whatsappE164 contract preserves explicit country codes. Twilio sender:40 recognizes lowercase twilio:, whereas authenticated intake accept-bubblewhats-webhook.use-case.ts:120 and handoff repository:47 can legitimately use uppercase TWILIO: when deviceId is absent. Root independently read both sides. Reproduce with owned fixtures before fixing; no provider blocking/policy/runtime production conclusion was applied during review.

**Reviewed T30 draft gap:** current appointment admission requires name plus phone OR email (service-appointment-admission.service.ts:43-53), rejects root Prisma clients:129 and executes the authority fence before merchant locks:133. Its internal clock is a callback read after locks:165. The old external packet must be recomposed with those contracts, current29callbacks and original transaction budgets; copying its Date/now/15s snapshot or stricter payment-contact helper would regress the approved contract. Explicit new capability and real post-lock expiry/current-policy proof remain to implement; no30source was changed.

**User restriction (2026-11-16):** user: "Continue só a revisão por enquanto" after actual Windows commitment fell to858MiB. Current mode is READ-ONLY review: no new productive edits, tests, compiler/native/container starts or commits. Preserve Root69/P30/M54 WIP and the original approved objective. Root full component suite58276 was already running when the question explicitly said it would finish; allow only that existing run to settle naturally and record its actual result, without retry. P/M were notified to stop new edits/tests and report current files/findings. A future user instruction must revoke this restriction before implementation/testing resumes; elapsed time or recovered memory alone is not permission. This note supersedes older heavy/implementation handovers.

**Integrated green29/53:** Root43/97complete, HEADb5adc21f3 after T29e6dd37db4/source1e695f037 and T53b5adc21f3/source0432700ac. Full29=46unit+102native, checked2541 a983/46ba; Full53=31unit+13HTTP-WS-SQL, checked2542 1bd5/9132; zero skips/providers/naturalcleanup. Productive bases matched before cherries. Only additive29metadata insertion conflicted and was retained;53 merged cleanly. Backup all28own69files in .cache/t69-before-green29-53-20261116T120800793794Z;26nonmetadata byte-identical, restored metadata composes both completed task blocks. No69source staged into integrations. Separate gates do not prove this combined source: fresh checked/full69 now required; Root sole-heavy, P30/M54source-pure only.

**Continuation within existing batches:** P's assigned Phase4T26-T32 may continue T30 source/pure after its atomic green29; M's assigned Phase7T48-T55 may continue T54 source/pure after atomic green53. Root sent these continuation notes immediately before recording this line; neither is a new worker/Verifier dispatch. No heavy/native/container/build is granted: Root69 owns the next window. Each next task still requires its plan, unchanged approved scope, actual gate and separate commit. T30 explicit appointments:confirm/no implicit legacy scope; T54 exact original private delivery lease/no adoption after awaits/no public leakage.

**Heavy returned M53:** actual official13/13 passed0fail/skip/provider, ACK/naturalexit0/timers[]/ownedcleanup0 at .cache/t53-gates/2026-11-16T12-00-54.299Z/native.log. Integral before/after checked1bd5/9132 coverage2542 unchanged;31unit current. M closes only evidence/status/atomic53 and starts no54native. P likewise closes green29. Root now owns the next heavy window, but first integrates both reviewed atomic commits with fresh own69SHAbackup and exact metadata composition; then one combined complete checked69/full unfiltered components/native9+37+14. No other checked/native/container concurrently.

**Heavy handover M53 (before sending):** P29 official journal10 passed after exactly approved0473 TTL correction,43.7s/0skip/provider/natural owned Postgres+Redis+bridge cleanup. P returned all heavy; Full29 now46unit+102native on unchanged checked2541 a983/46ba, closing own atomic commit only. Root69 focused approved-scope cohort50/50 green (11-59-26.719Z), no source/guard change. M53 now receives sole-heavy for integral admission of own checked1bd5/9132 and actual official protected13 with applied11074 helper; if input/artifact differs, stop and fresh full checked build is required. No Root/P/C checked/native/container until M returns. Root will SHA-back up latest69metadata before integrating green29/53; combined fresh checked69 follows both.

**Heavy returned and next P29 handover:** second Root69 regression also crossed a Windows suspension (System resume08:55local) and failed; no successful gate claimed. After resume default15cases passed, but the next profile correctly refused the artifact because applying the approved two src/spec literals changed the complete source fingerprint0551→7a5e. This was an orchestrator timing mistake: test files under src are fingerprinted even though production compiler coverage excludes them. Preserve the failed logs; never bypass the guard or revert approval to use the old artifact. Root must perform fresh complete checked build after integrations and approved test application, then repeat full69. Root owns no active heavy process now. P29 receives sole-heavy to verify its own current artifact and run the official journal10 with approved TTL candidate; full/commit only actual green102+46. M53 source/pure waits P return. Root source/backup/integration only; no checked/native/container concurrently.

**Settled test corrections (2026-11-16):** user: "Sim, corrigir essa checagem" approves exactly M53 strict-null JSON parser audit candidate11074da2/proposal2c3bd330, preserving HTTP400/no-write/every other oracle. User: "Sim, corrigir para null" approves exactly Root69 candidate d4d4a093 replacing only two no-context undefined expectations with the existing null contract; API/guards unchanged. User: "Sim, corrigir o teste de expiração (recomendado)" approves exactly P29 TTL candidate0473f8ca/proposalbe497f7e measuring configured four minutes by logical expiresAt and Redis TIME, keeping PTTL>0/all old negatives. Actual official gates remain required; prior external diagnostics are not completion. No new runtime policy, remote action or other test correction authorized by these replies.

**Dispatched (approved test application, before sending):** M53 and P29 may apply only their exact hash-pinned user-approved candidates after checking frozen originals and record approval verbatim in their own task metadata. Focused pure verification and source/evidence preparation allowed. Root currently owns heavy69; no checked/native/container until explicit handover after current owned cleanup. Then P29 runs real journal10 on its unchanged checked source and M53 real protected13 on its unchanged checked source, each with original guards/no filters and own atomic commit only after Fullgreen. Root applies its exact two null literals now; no full69 claim before all actual gates.

**Root69 finalization admission:** actual supervisor093724410819Z SHA c78da9d1 and worker606a814d were reviewed: natural compiler0,2542 checked sources,input0551eacdd2746b83f451b25b9c13dab027e4bd47363605733e25089a4bc4ce3b; artifact03d8fffa1465ea78dbb2d4d63392a8532bc127069a3028bf053c01a285bc8229; jobEmpty/noBreach/noForce/noMonitorFailure,min3521/maxGap313/374samples, all resume/terminal/final observations. No attestation recorded by build mode. Root admits separate finalize-root-reviewed on this exact owned directory, with unchanged binding/output/handle checks; native may start only after finalization and integral artifact admission exit0. Scope/test approvals remain pending, no69Full/completion claim.

**Root69 build-path admission:** standard checked launcher refused before capture/compiler at commitment3976<5168. Root verified the five existing T68 reviewed helper bytes against their pinned manifest, then changed only literal T68/t68 task labels and file paths for69; root/workspace/owner remain identical. Manifest .cache/t69-monitored-reuse-manifest.json records every source/target SHA and substitution count. Adopt the already-reviewed monitored alternative initial3072/live1536 sampled300/maxgap500, official full eight-package/Prisma/Nest command/default heap/coverage unchanged, exact owned Job only; any breach/force/monitor failure is not green. Execute build-only, then inspect actual receipt before separate finalization. No native69 from old68 artifact, no source mutation during compilation. Root remains sole-heavy.

**Heavy handover (Root69, before execution):** P returned all heavy processes after corrected checked2541 a983/46ba,46unit and92independentnative(7HTTP+48product+11holds+26core),0skip/provider/naturalcleanup. Journal10 remains pending explicit TTL-oracle approval, no29commit/integration. Root now owns sole-heavy for fresh T69 full official checked build using the existing guarded launcher retarget8dd0afcf; compiler/defaultheap/coverage and static5168 preflight unchanged. Then actual newSupport5/storefront4 native provenance and old68companions on that exact artifact. No M/P/C heavy runs until explicit return. Official69 scope oracle98af and M53helper4f27 remain frozen; tests may not be skipped or normalized while approvals are pending.

**Dispatched (T70 external Cypher preparation, before sending):** C/service_company_ui may prepare a cache-only implementation proposal for the whole next T70 deliverable, after reading current public-source projections, graph templates, private Community gateway and service canonical interfaces. Map parameterized public source/service/professional queries, tenant and pinned ABI admission, bounded limits/timeouts, rejected write/subquery/procedure/arbitrary text and operational availability boundaries. Include concrete spec-derived test proposals and exact files/base hashes. No productive edits/imports/tests/build/container, no T70 completion before green T69; no separate RAG admin. This preparation is not final verification.

**Pending T29 oracle (2026-11-16):** P preserved actual journal RED10/7/3 and proposed only changing a new incorrect physical Redis key TTL assertion to logical expiresAt bounded by actual Redis TIME plus configured four minutes, retaining physical PTTL>0 and every old assertion. Root reviewed proposal be497f7e/candidate0473f8ca against existing Lua retention+86400000 and T27 logical-expiry negatives. User question is pending; official8d86c21c remains unchanged. P may run independent suites on its fresh corrected financial build, but journal/full/commit require explicit approval then actual green execution.

**Dispatched (P29 independent base/sole-heavy, before sending):** M53 completed diagnostic13 and returned heavy while officialhelper awaits explicit useroracleapproval. Root69 source/pure continues, not green. To keep authorized independent booking work moving, P29 may align own SHA-backed10deltas onto committedgreen68 ee4532ece (not Rootdirty69; no dependency on53) with rechecked4sourcebases/lock/schema and ownmetadata-only composition, then unchanged fullchecked + planned102native under fresh existingguards. No otherheavy whilePowns; no nulloracle/53helper change or scope30implementation. Fullgreen?atomic29. Root will integrate29 preserving own69; later combinedproofs remain required.


**Dispatched (T69 external native model-fixture helper, before sending):** C may prepare cache-only native proposal for actual storefront RAG HTTP + modeltransport interception using existing STOREFRONT_PROVIDER_FETCH_FACTORY and real Query/repo/auth/canonical/runtime. Preserve supportQueryModel oldwire/4tests; separate opt-in storefront model flag, no repo/auth/facade/publicroute overrides. Derive real route/input from existing journey/receiver code and ensure no help shortcut masks RAG. No imports/tests/build/container. Root owns source69/actualgate.


**Dispatched (M53 actual combined-base alignment + sole-heavy, before sending):** green68commit ee4532ecefc60d51d22fa25c99baf253b9690131 is final. M may align own SHA-backed13deltas onto a new branch at thiscommit without unrelated stash/reset; restore only backed-up owntracked changes if needed, switch, reapply code-only3way patch/newfiles, compose both28 and53shared-types exports and own53metadata only. Recheckallbases/schema/lock and preserve everyoldoracle; actual53 is SupportMessagesController, no fictionaltenant13collision. Then existing fullchecked and planned real12HTTP/SocketIO/SQL gate under ordinaryfresh5168checked/2048nativepreflight (or exactreviewedmonitoredretarget if necessary, no newguardtooling/flags). Root/P nootherheavy; root69source/pure permitted after68commit. Complete53 only actualFullgreen/atomiccommit.


**Completed68:** Full639components/51actualnative(37new+14index), checked2541 input4c61abc6/artifact0c20cdc3,0fail/skip/provider/naturalcleanup; task-68-evidence.json preserves allcausalREDs, fixturecorrections and actualboundaries.41/97complete after atomic68; rootheavyreturned. No newbuyerUI or production action. Next M53 aligns thiscommit before checked/native12; P29source7unitready/102nativeunrun waits68+53base. Root69implementation may start only after thisgreen68commit.


**Future30 security composition:** the buyer confirmation endpoint may be /embed/service-appointments/confirm, but final booking must not gain authorization from checkout:track alone. Use explicit narrow appointments:confirm capability for this new reservation mutation, live allowedOrigin and verified checkout/buyer/session binding, businessmode/policy/currentcapacity/idempotency guards. Issuer may allow requested capability; do not silently add it to legacy tokens missing scopes. Preserve existing cart/customer track behavior. T40/T43 service flows request the new scope explicitly; tests exercise real issuer+route and track-only/foreign/origin/replay negatives. This is an implementation choice within approved booking authorization, not a new product policy. P30 remains prep only until29green.


**Integrated28:** b37511cfb (source6a754d69), full14unit/83native:HTTP9+product48+core26,0fail/skip/provider/cleanup. Coreactual25old?26new; original104asserts preserved, HTTP148 unchanged.40/97complete. Root68dirty18otherfiles SHA-identical aftercherry; metadata restored only after28commit, no68source staged into28. Evidence task-28-evidence.json.

**Heavy ownership (root68 build-only):** P returned allheavy. Root adopts exact literal-retarget5helpers verified against73C8/D798, manifest.cache/t68-monitored-reuse-manifest.json/supervisorf9c7cecc; official unchanged full build/defaultheap/coverage under same initial3072/live1536/300ms/maxgap500 ownedJob rules. Root may execute one monitored68build-only, review naturalreceipt before separate finalize; native37+14 and fresh combinedunit639 follow only verifiedartifact. P29source/pure, M53backup/sourceonly.


**Dispatched (M53 base-alignment inventory, before sending):** M may prepare only an SHA backup/manifest of its own dirty53 files and read-only git ancestry/alignment plan for the eventual combinedroot68commit after28integration. Preserve constructor13TenantContext/newqueue14 and alloldoracles. Do not merge/cherry/apply rootdirty68 or execute imports/tests/build/native/container yet; root will send the actual68commit afterFullgreen. P remains soleheavy; root68sourcefrozen.


**Dispatched (T69 external response-audit helper proposal, before sending):** C may extend its.cache/t69-preparation only with a concrete minimal typed audit-helper and spec-derived unitdraft, exact constructor/DI/consumer patchproposal after reading currentinterfaces. Reuse existing RecordAuditEventUseCase and68ValidatedPublicEvidence; scalarreadonly allowlist+tenant/responseDigest, bounded refs, no prompts/answers/questions/buyer/order/rawmetadata persisted and no publicresponse-schema change. No productive files/imports/tests/build/container, no69completion until68green+commit. Root owns integration/gate; helper is not finalVerifier. P keeps soleheavy.


**Dispatched (P28 reviewed finalization and native, before sending):** root read actual072113214861Z receipt SHAa5474d4c, natural0/jobEmpty/noBreach/noForced/min4047/maxgap313/418samples; bound workerResulte1a72e94 verifies identicalinput64339018 and checked2538, standardartifacte5fa3d58. P retains soleheavy to run existing separately reviewed finalize-root-reviewed ONCE on this exactdirectory, preserving hash/source/output/handle checks. This is firstactual Win32publication; rollback is not exercised or claimed unless a genuine ownedfailure occurs. Only after finalization0 and integralstandardadmission pass, run planned native9+48product+27core on thissameartifact with ordinary fresh nativepreflight and naturalcleanup; fix actualtask28source failures normally, neverweaken oldoracles. No taskcompletion beforeallFullproofs.


**Settled environment:** 2026-11-16 - user: "Vou liberar mem?ria agora (recomendado)" and "Liberei mem?ria; pode continuar". Fresh kernel snapshot07:19:46UTC shows4829MiB available commitment/1631physical, materially improved from prior3993start/1516breach. User completion revokes the resource wait; no authorization to close their apps is inferred.

**Dispatched (resumed P28 build-only, before sending):** P receives sole-heavy for one unchanged full official monitored build with supervisor73C8EB1/workerD798 after own fresh preflight, initial3072/live1536/cadence300/maxgap500 and ownedJob contracts unchanged. Preserve all oldrefusals; no heap/deadline/sourceguard changes. Report naturalreceipt before separate root-reviewed finalization/native; root source/light work only meanwhile.


**Current environment checkpoint:** P28 retry054106 stopped at realcommit reserve1516<1536 during Nest; forcedownedJob cleanupempty/33identities, no fullbuild/attestation/native. Root68full639green remains actual;39/97complete,68pending. No heavy processes active. User asked to free about2GB with asyncquestion, unanswered. Keep source frozen and retry only after materially improvedresources; no compilerheap/deadline/guard reductions or foreign app shutdown.


**Dispatched (reviewed build retry, before sending):** root reviewed exact2-hunk patch7CEB2700 and supervisor73C8EB1. P receives sole-heavy for ONE official full build-mode retry, workerD798 unchanged, all source/defaultheap/coverage/memory/deadline/ownership checks preserved. Prior053115 remains ENV/forced/jobEmpty and is not success. Do not finalize or run native until root reviews receipt. Root unit639 completed naturally; no other heavy process.


**Heavy returned:** root68 full component gate exited0 naturally:639pass/0fail/0skip,133367.7024ms, .cache/t68-gates/2026-11-16T05-35-08.625Z/unit.log. No native or current checked proof yet. Next P28 corrected supervisor awaits exact diff review before heavy handover.


**Heavy ownership:** after P returned053115 with jobEmpty, root owns the single heavy window for T68 full component suite only. P proposal edit/read-only and M source/pure; no other checked/native/container process. No stale artifact is used for native68.


**Dispatched (observed monitor race correction, before sending):** P28 supervised attempt053115 stopped during Prisma generate on QueryFullProcessImageNameW ACCESS_DENIED5, min2826/maxgap328/noreservebreach; forcedTermination and jobEmpty are recorded, no Nest/fullbuild/attestation/native proof. P may correct only the exited-member observation race in its ignored supervisor: an inspection failure may be ignored solely after retained handle proves samePID, actual exited Wait0 plus no membership in a fresh Job inventory; otherwise preserve refusal. Record PID/error/exit evidence, close unretained handles, and preserve all active-member executable/parent/creation checks. Provide exact diff/hash for root review, no rerun yet.


**Dispatched (T69 read-only inventory, before sending):** C maps current KnowledgeChunk/reader/retrieval/audit/support consumers for the next approved provenance task against root68 contracts; only an external cache proposal and exact spec-derived failing examples, no productive edit/import/test/build/container. T68 must be green and committed before69 implementation. This is preparation, not final verification.


**Dispatched (adopted supervised checked-build ONLY, before sending):** P receives sole heavy ownership for one execution of pinned supervisor CA393E55 with its exact reviewed worker and official full build. Initial3072/live1536/cadence300ms/maxgap500ms and verified owned Job confinement are adopted as documented in parallel-execution.md. Preserve all failure receipts. Build mode has no record-build-exit0; do not finalize or run native tests until root reviews the natural build receipt. No feature completion from infrastructure oracles.


**Returned final resource peer:** C verified9/9 final hashes and closed the3 earlier findings by reading; no new blocker found in that scope. Actual Job probe already passed; full supervisor/capture/compiler/finalize still0runs.
**Dispatched (infrastructure contracts, before sending):** P may run only the7Python+1MJS resource oracles in isolated owned temporary artifacts, fresh>=1024MiB commitment, preserving all previous receipts/source and not invoking the actual API compiler/capture/record. These are infrastructure tests, not feature tests. P may add only the exact OS System32 conhost path to the proposal under unchanged sameJob/parent/exe/creation checks, then provide hash/diff for root review; no full build until explicit adoption.

**Returned infrastructure probe:** P actual ownership probe passed after two preserved diagnostic failures: conhost appeared before the intended Node leaf, so discovery now observes exact exe/parent/creation. Receipt P/.cache/phase3-gates/t28-supervisor-probe-20261116T044736695336Z.json: root49876/leaf52156/conhost32748/own sibling15248, job empty/cleanup0. No compiler/capture/record/SUT. Full supervisor still unadopted; conhost is not yet in its execution allowlist.
**Dispatched (final proposal read-only review, before sending):** C checks P's final9-file manifest2EC6B37C and the three reported fixes; no imports/tests/probe/compiler or edits. Root separately reviews source and must explicitly adopt any orchestration refinement before a build. Current5168 policy unchanged.

**Dispatched (benign ownership probe approved, before sending):** root read the actual standalone Python probe and C independently reviewed the Job confinement boundary. P may execute ONLY the owned Node root/leaf plus separately owned sibling probe with fresh>=2048MiB commitment, explicit --execute-root-reviewed-probe and its actual Node path; existing Job/helper hashes must be recorded. It calls no compiler/capture/record/SUT, reports checkedBuild=false/featureTestsRun0, and must prove job empty, separate owned sibling unaffected by that job then all owned processes exited. No full supervised build yet; final telemetry/enum/attestation fixes remain under review, original5168 build policy stays.

**Heavy returned:** P28 returned its slot without any compiler/probe/supervisor run. Its old5168 preflight refused13times; no source RED or checked28 exists. Root owns coordination; monitored proposal is unadopted pending read-only review.
**Dispatched (public RAG HTTP fixture helper, before sending):** M may prepare only external cache changes for an explicitly declared model fixture in the owned canonical AppModule runtime: deterministic legacy384 query vector and captured ChatCompletionPort prompt, no repository/auth override or new production route. Reuse51senderfixture/control patterns and ownership/runId/IPC/network guards. Goal is actual POST /support/chat/public demonstrating current canonical policy context after admitted visitor scope; root owns source/controller fix and native68 gate. No imports/build/native/heavy. M53 productive source remains frozen.

**Returned68peer:** C found two real integration gaps: agreeing identical FAQtext under distinctIDs was falsely conflicting; public/support/chat caller lacks tenantALS for the new canonical admission. Root owns causal tests/minimal fixes; product/config context and FAQdefaults remain explicit71compatibility work, without raw private fallback.
**Dispatched (resource proposal safety review, before sending):** C reads only P's ignored Python/MJS supervised-build proposal for ownership, cleanup, live reserve and attestation gaps; no run/import/edits. It did not author these helpers. Existing5168 policy stays until root adoption. This is incremental tooling review, not final featureVerification.

**Returned T68 lock helper:** C96982265 integrated as child15 with original14ASTassertions71/71 preserved in order. Root strengthened owned URL protocol/host/port/user/password equalities and restricted the new unexecuted query-event assertion to canonical tables. Future33native,0executed.
**Dispatched (incremental read-only68 review, before sending):** C reviews root's evidence service/QueryKnowledge/module composition for scope/public/ABI/legacy/failure gaps only, no edits/imports/tests/build/container. It authored adapter/fixtures, so this is not independent finalVerification and cannot substitute for the later fresh nonauthorVerifier. Findings must name a concrete violating input/outcome or a remaining task boundary.

**Dispatched (resource orchestration proposal, before sending):** P may draft an ignored monitored-build supervisor for root review, not run it yet. Current static5168 preflight remains until reviewed. The existing threshold is only our ignored coordination (parallel-execution.md), not a user requirement/compiler/test. Proposal must preserve exact official build/defaultheap/coverage/deadlines and enforce live Windows commitment reserve, stop only a verified owned compiler tree on breach, never record a budget-aborted build as green. No foreign process/OS/global Docker change or source/test assertion edit. Root will record any adopted technical refinement explicitly before execution.

**Heavy handover:** P28 owns the sole-heavy slot after alignment with a9ec3e47f (combined67/51/52); root68 and M53 source/pure only. Root68 current28-unit green is not a native/build gate; candidate source is unbuilt and old artifacts must not be used.

**Dispatched (T68 lock-admission fixture helper, before sending):** C may draft one additional external native case observing the exact reader backend waiting behind an actual merchant writer transaction before release. Prove pre-lockA cannot pass after writerB commits and currentB can pass; actual scoped SQL/canonical writer helper, no callback/AppModule override, unchanged5s/defaultisolation. No productive files, import/test/build/container. Root reviews/integrates before actual68gate; not finalVerifier.

**Settled test correction (2026-11-16):** user: "Sim, corrigir esse teste para 403 (recomendado)" (reply call_ef8af0f77f6746789f47388d26a49fd9). Approves exactly the T52 external proposal dcef33d0: foreign merchant body403/tenant_mismatch_body; own merchant extraDTO400 and all other400/no-write assertions preserved. Production unchanged. M receives soleheavy for the REAL10-case gate on unchangedbddc/490a; candidate10-pass diagnosis is not the gate. Record before dispatch.

**Dispatched (T68 adapter helper, before sending):** C/service_company_ui may prepare only its external cache Prisma canonical snapshot adapter against root's new domain contract. Read real canonical/writer interfaces; no productive edits/imports/syntax/tests/build/container. Root owns service/tests/composition, full68 gate and commit; C is a helper, not finalVerifier.


**Current integration:** Root39/97complete after green52/sourcefc1abe1dd on67da31c1156+51a3858b639. T52 checked2529 bddc/490a,31unit/10actualHTTP green,0skip/provider/naturalcleanup after explicit403approval. Combined candidate still needs fresh checked/native; separate branch artifacts do not establish it. Only STATE/tasks metadata conflicted; production merged without conflicts.
**Dispatched (before next handover):** P/service_professional_agenda owns the next sole-heavy window for28 after aligning this combined52base and preserving its backed-up own13deltas; fresh checked then9HTTP+48product+expanded27core51. M53source/pure and root68source/pure only; no other checked/native/container while P owns the slot.

**Dispatched (before next handover):** M/service_batch_01 receives the next sole-heavy window for T52 checked/native after its31-unit green and after root finishes this metadata-only integration. P28 aligns the combined base and performs source/pure only while M runs; root may implement68source/pure after67 completion. No other checked/native/container process until M returns the slot.
**Previous dispatch snapshot:** M owns Phase7T48-T55 (48-51 complete;52source/puregreen, nextFull). P owns Phase4T26-T32 (26-27complete;28source/purepreparing combinedbase). C Phase2+96/97 complete, Phase8externaluntil55; returned68externalfixtures,0executed. Root Phase9 T63-T67 complete;68 next. FinalVerifier/screens not dispatched.

**Current checkpoint:** Root38/97 locally complete after integration of greenT51/sourceed75cbd6a onto T67da31c1156. T67 Full614components/135native is separate evidence; T51 Full552unit/91native/normal48/widget176/contracts6 is separate evidence. The combined source requires the next fresh checked/native gate and no old artifact may be used. Only metadata conflicted; auto-merged admission retains both27lease checks and51original-authority admission.

**Returned (T68 external preparation):** service_company_ui delivered companion b9d9c69ae5b4ccbad47087bb806a22905a8d012d5da1d9f10a46aa558cab599f and registrar dea3f9d97cb29e22831a23d572f35c3d5c8e3c3950d42d0262099b8dc3f7ff54 in its cache; READMEc205a753/manifest6b975c81. Draft14 scenarios across two future profiles would register31tests, but zero imports/syntax/tests/build/containers executed and no productive source changed. Root must review and compose real reader classes after67; the companion alone registers zero tests and is not a gate. T69audit/T70prodtemplate-gateway/T71buyerflow not covered by this draft. No finalVerifierrole.

**Heavy returned:** service_batch_01 realwidget176/176 and planned deferredCOMMITnegative1/1 passed on unchanged9b130/c419,0skip/provider/naturalcleanup. First companion fixture correctly lacked wabaId and stopped before request; only synthetic input repaired, all assertions retained. M closes evidence/atomic51 and may prepare52source/pure under its existing Phase7 assignment. Root acquired soleheavy and started unchanged index14+preservation106 (120 expected) at .cache/t67-gates/2026-11-16T02-50-03.053Z; exact path will be verified after exit. No integration/source mutation during this root gate.

**Dispatched (T51 missing negative proof, before sending):** after real176, service_batch_01 may add and execute one MJS companion for the already-planned deferred SQL COMMIT failure after external request start. Use owned synthetic DB, real transaction/readLocked and fixture-only DEFERRABLE constraint, no productive TS/AppModule override or bypass. It must assert unknown/no retry or forwarding and SQL rollback; preserve all old tests. Same sole-heavy window, return after natural cleanup; no task51 completion before this planned negative is covered.

**Heavy slot handover (before sending):** root67 checked and backfill15 completed0; component gate completed0. service_batch_01 now owns the sole heavy window for the real approved176-case widget gate. Root/P/C perform source/document/cache-only work and start no checked/native/container gate until explicit return. Root67 remaining index/preservation gates are pending, not waived.

**Dispatched (T68 external fixture preparation, before sending):** service_company_ui may extend only its .cache/t68-preparation with a runnable native-fixture proposal derived from its14 mapped cases and current T63-T67 interfaces. No productive checkout edits, imports/tests/builds/containers, model/tenant flag changes or T68 gate; root implements only after T67 completes.

**Settled mid-build (2026-11-15, widget test oracle):** user: "Sim, corrigir essa linha (recomendado)". Authorization covers only the proposed strategyContextVersion expectation after e-mail confirmation, preserving the saved.version and all other assertions. The real 176-case gate remains required.
**Dispatched (2026-11-15, approval received):** service_batch_01 resumes T51 in its isolated worktree to apply that exact one-line oracle correction and record approval. Root retains the heavy slot for T67; M prepares without checked/native runs until explicit handover.

**Settled test correction:** 2026-11-16 - user: "Sim, corrigir esse teste para 403 (recomendado)" (reply call_ef8af0f77f6746789f47388d26a49fd9). Approved exactly the T52 candidate dcef33d068a0f44e76400b0af385d63e9865366e477c94b0565848b0f65d2101: foreign body merchantId expects403 tenant_mismatch_body from the existing global guard; authenticated own merchantId remains an extra DTO field rejected400, with all other invalid-input400 and exact no-write assertions unchanged. No runtime/source guard or other oracle changes. A fresh real10-case gate is required after application; earlier overlays remain diagnostics only.
**Settled test correction:** 2026-11-15 - user: "Sim, corrigir essa linha (recomendado)" (reply call_895e4cba1100411cbc83b4423b42623d). Approved only the old widget email-OTP assertion strategyContextVersion equals its previous value rather than previous+1; saved.version6 and every other oracle remain unchanged. Concrete external candidate176/176 and identical before/after49-case failure were reviewed. Apply exactly that line and require the real protected176-case runner before marking T51 complete. No production/source behavior or remote action is authorized by this correction.
**Settled mid-build:** 2026-11-14 - user: "Aprovar o plano e iniciar implementação local". Aprovação recebida para os 71 critérios, 95 tarefas/13 fases, refinamentos posteriores e subagentes, preservando produtos nos dois canais. Publicação permanece etapa separada. Início por T1, sem alterar o workspace concorrente.
**Settled execution change:** 2026-11-14 - user: "por que esta demorando tanto? spawnar subagents". Preparos paralelos autorizados em checkouts isolados, preservando gates reais, dependências técnicas, commits atômicos e escopo local.
**Root parallel front:** T63-T71 public business RAG in N. T63 uses completed T13/T18; T65 also waits T25 to cover all actual new writers. Human handoff Phase7 may start after the independent schema/session base T9. Final coexistence requires every front; no criterion/gate is removed.
**Next parallel dispatch:** service_batch_01 switches to whole Phase7 T48-T55 in M after incorporating the committed T64 base; T48 depends on T9 because the binding/support/session domain is independent of availability. Its T26-T32 drafts are hash-preserved and handed to P for execution after P/T25. C retains T96/T97 integration and its returned M field10/10. Root coordinates the same one-heavy-slot limit and final author-independent verification. No human gateway/provider action is authorized by this local dispatch.
**Next prepared batch:** C/service_company_ui prepares whole Phase8 T56–T62 after its green T97 commit and root integration. Drafts stay outside productive fingerprints until M/T55 is integrated; the original T55→T56 dependency, all per-task gates and atomic commits remain. Root's T65/T66 drafts are preparation only, with ten and eight preparatory pure tests respectively; no indexing or retrieval is accepted from them.
**Previous dispatch snapshot:** service_batch_01 owns Phase7T48-T55 in M;48/49/50 complete and integrated,51 original-authority/transaction/dispatch work in progress. service_professional_agenda completed Phase3T17-T25 (52unit/72native/all4apps types-build0) and executes Phase4T26-T32 from the verified45-file packet; T26 is locally complete with18units/17native/checked2523 and T27 with31units/28native/checked2531; T28 follows. service_company_ui completed Phase2+96/97 and prepares Phase8T56-T62 externally until55, with reviewed temporary RAG helpers in cache. Root integrates N and owns Phase9;63/64/65 complete,65 has528unit/88native/checked2521 green. All36 locally completed tasks and evidence are in STATE.md. Root66 is complete in its own atomic commit: checked2528 e746f146/01c2d8b2, pure603+5 and actual index14+preservation106 all passed, provider0/naturalcleanup0; earlier setup refusals remain recorded. rag66_fixture_review was dispatched2026-11-15T21:35 local for read-only incremental fixture review at HEADa451adf1c plus the current dirty66 files; returned with two oracle findings (live lease during observed lock wait and foreign sentinel preservation), both strengthened by root and passed in actual index14/14; no source or runner authority and no final Verifier role. This dispatch note was recorded after the tool call, not before. No final Verifier/screens dispatched; all work local. Incremental rag66_fixture_review returned read-only T67 draft/fixture review at base12c67c6a9 with one incomplete-foreign-snapshot finding; root strengthened the snapshot, native proof still pending; no edit/runner authority and no final Verifier role. service_company_ui prepares T68 reader inventory/design/tests externally only, no source/runner authority; dispatch record was written after its tool call. T67 reviewer returned one canonical snapshot finding, fixed by root with all assertions retained; actual67 native proof remains pending.
**Previous dispatch snapshot:** service_batch_01 owns Phase7T48-T55 in M:48/49/50 integrated,51 complete locally in this atomic commit after the explicitly approved one-line old widget oracle correction and real176-case gate. T51 final552unit/91native/normal48/widget176/contracts6 all green, checked2528, zero skipped/provider/owned cleanup. Next52 has only external preparation. Root owns N integration and Phase9;66 is separately committed12c67c6a975d88f5cb3b2a47dea83116f6e58af5,67 is in progress. P27 separately committed27db2fe5a4a27340485d3b9d855dd77d55e7fb28; it needs the final51 guarded composition after integration. C prepares Phase8 externally until55. These separate later commits are not in the M51 artifact. Final Verifier/screens remain undispatched; local implementation only.
**Previous dispatch snapshot:** M/service_batch_01 owns Phase7T48-T55:48-51 committed and52 completes in this atomic commit (31unit/10realHTTP-DB/checked2529, zero skip/provider/cleanup). Root integrated51 in N a3858b6398383d08182a851fc4d505457f56f5a8 and67 is da31c1156; P28 aligns committed bases and the actual-TX51 hooks. M52 artifact is its independent ed75cbd6a ancestry, not a combined67/P27 build. Next53 will start with source/pure only; root coordinates the single heavy slot. C prepares Phase8 externally until55. Final Verifier/screens remain undispatched and no remote publication is authorized.
**Walked:** Nenhuma jornada da feature nova foi executada. Prints anteriores de produto não comprovam serviços. Capturas de proposta, se anexadas, terão rótulo de prévia local. Ao executar, registrar rota/gestos/dados/resultado e ambiente para cada Independent Test.

## Phase Execution Map

108 tasks in17 phases; the task-level dependency graph and Depends on fields above are authoritative. Phase1 opens company/professional/human-delivery fronts. Company/professional writers feed Phase9 RAG;25+59 open the independent73–77 administration client/state/UI sequence, while71→72 remains mandatory before final acceptance. Phase4 waits for company/professional integration; Phases5/6 follow its canonical booking admission. Phase8 close/UI depends on55 and its explicit59 permissions. No business-operation dependency or required gate is waived.

Phase14 adds99→100→101, with55 also required by100 and62 by101. Phase15 adds102→103 after actual41/74, then80/83. Phase16 keeps105→106 and107 entitlement dependencies;104/108 retain their earlier explicit edges. Phase13 coexistence92–94 and all new fronts converge at Phase17 final95 after94/97/98/101/103/106/72. Existing original product regressions,108 consumer guards, same-HEAD proofs, independent mutations/screens/walk and validate_verification remain required before completion. One local atomic commit per completed task; publication is separate.

**Approved T54 test correction:** 2026-11-16 - user: "Sim, corrigir a expectativa do teste (recomendado)" (reply call_f467064279f64627b220b0e1727ef4da). Exact candidate6c32932e9c25c627dbecc49b2bdb46f7db9ddb5092e84dcc6263ae7575884f86/patch06290559f6f04eb24d3ae7e3185e9abc09fb79a53bcf79d1a6eedcf67b589fed applied only after officialoriginala19442c8cd312c84193af6cc8b557cc4ec30714c10bb8c78ce8a6734e8a088b7 verification. Keep the full pre-enqueue snapshot; only expected ticket.updatedAt equals the canonical queued message.createdAt, all other fields/oracles intact. Original9-case failure retained; real9 must pass on currenta104/8b40 before task54 completion.

**M54 alignment with108:** 2026-11-16 - SHA backup26 files and74 cache records in .cache/t54-before108-align-20261116T171558Z/manifest.json (c2e9901fbe0c21fdcc636034a0573db2ce82e6d9aa15b6ac3e4d408972b1f512). Fast-forward only committed bda28419d and reapply original-blob3way own11API/test deltas; all24 nonmetadata source/test/plan files remain byte-identical, including approved6c3293 and PGhelperac181a2d. Root107/108 definitions/status preserved. No productive base diff, schema/lock/stamp unchanged, outputs/dependencies not written/copied. Artifact a104/8b40 is preserved and awaits integral readmission before officialAPI9;128unit/46native remain green, task54 incomplete. C owns105/107 execution; no M imports/probes/parsers/tests/build/native during alignment.

**M54 actual officialAPI9 after108:** 2026-11-16 - session94677 log.cache/t54-gates/2026-11-16T17-33-51.089Z/appmodule.log:6pass/3fail/0skip, exit1. Integral owna104/8b40 readmission2547 passed before AppModule. Accepted/rejected terminal waiters exceeded unchanged15000ms; replayaccepted and remaining cases passed. Root failed handoff_fixture_cleanup_failed; nested cause is not exposed by TAP. No M Node/owned PG/Redis containers remain after fallback, but no natural-cleanup0 claim. Official6c3293 and all source unchanged;128unit/46native preserved. Task54 stays open, no commit; sole window returned to Root for diagnosis/coordination.

**M54 final accepted Full gate:** 2026-11-16 - final single authorized API9 run .cache/t54-gates/2026-11-16T19-05-17.370Z/appmodule.log passed9/9, zero fail/skip/cancel, natural wrapper exit0 and no owned worker/container afterward. Exact productive artifacta10478e3/8b402eb9/2547 admitted before and after; prior128unit plus PG16/adapter10/queue13/runtime7 remain unchanged, giving55native total. Observation-only officialdbd837af/helpera981627b strips to approved6c3293 exactly, all original assertions and15000ms unchanged. Failure-only observers emitted no rows/gauges/close cause because no failure occurred; earlier6/3 and resource1082<2048 refusal remain historical, with no claim of their cause or a scheduling repair. Task54 marked before its focused atomic commit. T55 awaits Root review/integration; no further runner/build/provider/remote action.

**Settled mid-build, one T73 request assertion:** 2026-11-16 - user: "Corrigir essa expectativa (recomendado)" (reply call_8c2dbee1ab4c41bb905ff23cd0ee3de7; Root exactpatch27cf5603). Only committed expectation parentId:null -> parent_id:null and matching SDK conditional were approved. Applied candidate SHA/reverse-check verified before adding one independent null/non-null/omitted parent regression. Actual corrected49/49 unfiltered,39new+10unchanged,4files,0skip/fail,6.32s,natural0 at2026-11-17T00:09:18.584Z; original1024admission1863MiB, all23inputs exact/ownedCnodecmd0. T74code and81historical baseline proof preserved. No backend/oldcatalog/105/75source in fixcommit, no browser/build/featurecompletion claim.
