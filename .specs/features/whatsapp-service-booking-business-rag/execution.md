# Execution Evidence

## T1: Complete Baseline

**Assumptions**: API722 é a base preservada; frontend f103 é fonte Git limpa, com publicação histórica comprovada apenas para widget. Não presumir frontend concorrente do principal como publicado.

**Files to touch**: três árvores frontend ausentes (`apps/dashboard`, `apps/storefront`, `apps/widget_v2`); somente documentos desta feature (spec/context/design/tasks/baseline e manifesto/script de curadoria). API/packages/lock/configs não recebem alteração.

**Success criteria**: 1.259 fontes Git copiadas sem sobrescrita divergente, hashes de destino iguais à origem, shared packages idênticos e reutilizados, ausência de segredos/deploy/builds, importers compatíveis com lock preservado e diff check limpo. T1 é documental, sem teste artificial.

**Gate**: PASS documental: 1.259 arquivos conferidos contra SHA-256 de origem; API/packages/lock sem diff; metadata nova passa diff check; importers frozen/offline aceitos. Linking interrompido para não concorrer com baseline do root, sem download/resolução. Whitespace herdado de source importado permanece registrado em baseline.md, sem reformatar código aprovado. Nenhuma condição de venda, pedido, estoque, pagamento ou mensagem foi alterada.

## T2: Owned Runtime

**Assumptions**: reutilizar PostgreSQL/Redis próprios existentes; executar o AppModule real em processo com ambiente filtrado; tipos e build de produção precisam passar sem noCheck/waiver. Neo4j parent prova o motor local, não integração API-RAG, que pertence às tarefas posteriores.

**Files to touch**: `apps/api/tests/service-test-{runtime,artifacts,neo4j}.mjs`, worker e spec focais; config checked de teste restaurado da fonte f103 e metadados desta feature. Não modificar código comercial ou testes anteriores.

**Success criteria**: recusas de endpoint/env/executável estrangeiros e ownership; contagem zero/skipped/fail recusada; banco real com schema completo/marker, Redis e Neo4j próprios; `/health` e `/ready` servidos pelo AppModule canônico; nenhum provider externo; encerramento exige ACK real de app.close e saída natural code0 antes de remover recursos próprios.

**Preexisting baseline**: orquestrador registrou 5.253 testes, 5.169 pass, 84 falhas e zero skips, exatamente o conjunto já catalogado em 05/11. Relatório em `.audit/service-plan-20261114/execution/baseline-triage.md` do principal. Não há baseline global verde e não se corrigem essas expectativas nesta tarefa.

**Progress**: linking frozen/offline concluído com zero downloads e lock preservado. O script test:compile original não tinha tsconfig.test-runner; config checked foi restaurado, mas um processo interrompido não deixou exit0 e não foi atestado. O build real de produção subsequente terminou exit0. Sua primeira attestation recusou mudança do harness JS durante o build; nenhum manifesto foi forjado. Novo fingerprint distingue produção compilada do harness JS executado diretamente, com novo build/attestation em curso. Sintaxe dos cinco JS passou. RED inicial por módulo ausente foi observado; depois quatro subcasos negativos passaram e o caso real recusou manifesto ainda ausente. T2 permanece incompleta até prova real e cleanup.

**Gate result**: PASS em 2026-11-14: build produção checked e attestation estável exit0; T2 executou 7 testes, 7 pass, zero failed/skipped, em 56,3 segundos. Schema completo e markers reais SQL/Redis, motor Neo4j local, `/health` e `/ready` do AppModule real e providerCalls=0. Cleanup exigiu ACK de app.close, saída natural code0/signalnull e remoção dos containers/bridges próprios. Isso não é aprovação de PSP, conversa Meta real, API-RAG ou shutdown de produção.

**Bootstrap corrections**: restaurados dois mirrors SQL byte-idênticos à história API e à revisão f103; origem/hash em runtime-bootstrap-sources.json. Nenhuma SQL foi alterada. A primeira prova AppModule revelou reconexão no rate-limit usando Redis por docker-exec; o guard real de 1500ms ficou intacto. Redis desta suíte agora é container próprio com publicação restrita a 127.0.0.1/porta efêmera, rootfs read-only/tmpfs/ownership/marker verificados. Helper Redis legado network-none permanece inalterado. A correção foi testada com negativas de bind público/volumes e prova real. O handshake isolado de bridge antigo foi medido em105ms, sem alegar que isso elimina latência sob AppModule concorrente.

**Next checkout**: após este commit, criar `C:/tmp/zyon-service-business-20261114`, branch `feat/service-business-20261114`, a partir do HEAD T2. O R histórico conserva suas mudanças .specs alheias; só fonte commitada e o estado desta feature serão a base nova. Nenhum stash/reset/deleção dos trabalhos anteriores. Instalar dependências próprias offline, sem junction mutável de Prisma.

## T3: Local Browser Acceptance

**Assumptions**: browser and backend use owned local resources only. The WhatsApp screen is a labeled fixture, with no Meta/PSP connection. The actual dashboard login and the canonical API readiness route are exercised. Signup is the default route; the test clicks Entrar before checking the login form.

**Files to touch**: dashboard service-local Playwright config/setup/scope/tests; runtime diagnostic IPC; local-only build wrapper and the missing dashboard auth build policy copied from f103; minimum objective ESLint bootstrap authorized by the orchestrator; feature metadata, transferred artifact manifest and local captures. No commercial API/frontend behavior changes.

**Success criteria**: refuse external origins and inherited credentials, serve a real local AppModule and database, block browser egress, capture local desktop/mobile states, close the app and remove all owned resources. Run existing typecheck/lint/build scripts without suppressing failures or weakening tests.

**Transfer verification**: independent frozen/offline dependencies and Prisma generation succeeded in the new root. All 5,242 transported checked artifacts (23,617,263 bytes) matched origin hashes. Input fingerprint 0a6629fca03e2fab52b996bcc500fc85fdfb0e1b745ecf23bd776f03364e43d4 and artifact fingerprint bd7a193e4b4d293064794bffd1b294f45d09bcbfb5036fa14ac50204f59e054a passed assertServiceArtifacts; T2 then passed again, 7/7, zero skipped, in the new root.

**Browser result**: final scope/count contracts passed 2/2; Playwright T3 passed 1/1 with exit 0 and teardown in 1.4 minutes. Preflight took 11,395ms and boot 20,971ms. Local login and WhatsApp-fixture desktop/mobile captures are saved in captures/. A first round timed out before readiness; added bounded stage diagnostics without changing productive timeouts. The next round correctly revealed the default signup screen; adding the Entrar gesture retained the same login assertions. No assertion was weakened. The final reporter rejects zero, skipped and failed cases.

**Build bootstrap**: widget-v2 must be built before storefront consumers. Build order is corrected without dropping checks. Dashboard build references the missing scripts/lib/dashboard-auth-build-policy.cjs; only that dependency was restored from the frozen f103 Git blob, preserving its canonical LF bytes. Filtered local builds use synthetic public auth values and the cached, pinned pnpm9.15.0 directly. These frontend artifacts are local validation artifacts; release needs the normal production build configuration. The network guard rejected the global launcher's attempted auto-install; no package was downloaded. The complete platform-hostname helper was already imported by T1; an unnecessary EOL-only recopy was restored to HEAD bytes.

**Final gate**: PASS. Typecheck/build scripts for API, widget, dashboard and storefront exited 0. API lint exited 0 with two preexisting unused-disable warnings. The 14 spec type diagnostics were resolved in separate bootstrap commit bcb863757 without business/assertion changes; the selected legacy runtime suite remains 234 pass/14 baseline fail/0 skip. Fresh checked API build and conservative hashes covered all 2,483 productive sources. T2 then passed 7/7 with actual app.close ACK, natural exit 0 and owned cleanup. The final browser independently completed the same teardown. Compiler/deadline contracts passed 4/4. Logs in C:/Users/Admin/Desktop/AACP/.audit/service-plan-20261114/execution/t3-*.log and bootstrap-*.log preserve results and failed attempts. No production source/schema, provider or remote business state was changed. No Meta, PSP or API-RAG acceptance is claimed.

## T4: Additive Persistence

**Assumptions**: existing products keep their branch and snapshots. Legacy service/mixed data is explicitly pending classification, not assigned a professional or an invented payment policy. Merchant products default plus nullable explicit-selection timestamp and needs-review flag support this distinction; T5 classifies from real data and T7 enforces it. OAuth preliminary registration remains distinguishable until completion. Service policy fields remain nullable until explicitly configured, and new admissions default disabled.

**Files to touch**: Prisma schema, minimum declarative tenant model registration, a normalized schema-before-services fixture and provenance for T5, and this feature's design/tasks/evidence. Existing variant writers gain no required scalar. About remains Merchant.storeSettings.company.description.

**Success criteria**: Prisma validate/generate pass, scoped composite product/variant/professional relationships and idempotency keys exist, operational and financial records remain distinct, and all required typecheck/lint/build commands pass. This schema task uses real compiler/Prisma validation, without artificial string-matching tests; T5 owes actual migration/persistence and T6 adversarial isolation.

**Co-location adjustment**: the existing tenant alignment contract requires every new merchantId model in TENANT_SCOPED_MODELS immediately. The orchestrator authorized the minimal list additions in T4; T6 still owes all adversarial HTTP/DB/rollback tests and any specific protections. No isolation criterion is marked complete merely by adding names. The baseline fixture comes from Git T3, with only line endings/trailing whitespace normalized and both hashes recorded.

**Financial cardinality**: the existing fulfillment adapter loads one canonical PaymentIntent and iterates scheduled units. AppointmentPayment therefore stores per-appointment allocations and deduplicates by appointment plus intent/provider source. It does not make intent/provider globally unique or create a charge per unit. T5 must persist multiple allocations from one source and reject a duplicate for the same appointment. T35 validates the shared canonical evidence and allocation sum; KPI reads must not multiply the original receipt total. Operational status remains independent of financial evidence.

**Gate result**: PASS. Current and baseline schemas validate; current client generation and all four apps' typecheck/build scripts exit 0. API lint exits 0 with the same two warnings. Existing tenant contract: 12 pass/0 fail/0 skip. Local Prisma schema delta has 11 CREATE TABLE and no DROP TABLE/COLUMN/TYPE/INDEX; no database was migrated. Checked API build/attestation completed with frozen source. A 16GB host had memory pressure during independent UI builds, so future heavy builds run serially; no flags, timeouts or checks changed. validate_tasks has zero errors and one documented granularity warning for the mandatory schema/tenant co-location. Native migration/FK/rollback proof remains T5/T6.

## T5: Compatible Expansion Migration

**Assumptions**: prisma.config.ts executes prisma/deploy-migrations; prisma/migrations is preserved history. The same expansion SQL must be byte-identical in both. The test's prior database is built from the pinned pre-feature schema, with synthetic commerce records and a clearly labeled already-deployed baseline ledger. This does not claim the historical migrations were all replayed. Only the new expansion is applied by the real Prisma migrate deploy command, then replayed through its ledger.

**Files to touch**: the two migration.sql paths for this feature; a local native-PostgreSQL migration integration test in MJS using the existing owned PG and filtered CLI environment; feature tasks/evidence. No remote database, legacy repair script or HTTP route is invoked.

**Success criteria**: preserve buyer/cart/checkout/payment/order/stock snapshots, distinguish legacy services/mixed merchants as review-pending without creating professionals/policies/appointments, prove tenant composite FKs/transaction rollback/idempotency and one canonical payment funding multiple allocations. Official deploy replay leaves one completed ledger entry and unchanged business state. Native overlap and basic configuration invariants fail closed. All cases execute with zero skip, then owned PG/bridge are removed.

**Runtime parity adjustment**: review found that schema-only migrate diff would omit the SQL CHECK/EXCLUDE rules. The shared runtime now builds the pinned prior schema and runs this exact active migration through real migrate deploy, using one common seed-free helper. The owned marker and migration checksum are validated; an actual managed-schema drift is rejected. Historical ledger rows are synthetic and explicitly identified, not a historical replay claim. Prior ledger INSERTs are batched in one SQL operation. The active deploy directory and native MJS test path replace the planned historical-only/TS paths without reducing checks.

**Gate result**: PASS. The initial native suite passed 8/8. After extracting the shared bootstrap, the added drift negative and all native cases passed 9/9, zero failures/skips, in 111.2s. T2 then passed 7/7 in 238.4s with the SQL invariants installed, actual AppModule HTTP, app-close ACK, natural worker exit and removal of owned containers/bridges. Production TS, checked artifacts and business guards were unchanged, so no productive rebuild was necessary. Test self-review confirms assertions on stored state, rollback and negative effects; none were weakened, removed or skipped.

## T6: Tenant Isolation

**Assumptions**: T4 already registered the eleven new models as required by the existing alignment contract. T6 proves the actual Prisma extension with AsyncLocalStorage and the migrated PostgreSQL database; no service controller exists yet. HTTP adversarial cases remain mandatory in each later controller commit, rather than creating an artificial production route for this test.

**Files to touch**: native service-tenant.integration.spec.mjs; feature task/evidence metadata. Product middleware behavior is preserved unless a concrete new-model bypass is demonstrated.

**Success criteria**: two real tenants cover all eleven models, hostile read/update/delete filters never expose or alter foreign rows, bulk writes are tenant-stamped, composite foreign references fail and preceding transaction writes roll back. Existing tenant unit contracts remain green. Only owned PostgreSQL/bridge are used and removed.

**Gate result**: PASS. Existing unit contracts 12/12 and real migrated PostgreSQL integration 15/15, zero failures/skips, exit0. All eleven models use the canonical checked extension. Reads, mutations, bulk stamping, compound keys, native FKs, unchanged foreign rows and transaction rollback are asserted. Two initial driver errors were corrected without changing assertions: actual WhatsApp session fields and consumption of lazy PrismaPromise inside the async ALS callback. The first incorrect driver returned the unconsumed promise outside ALS; it was not a demonstrated production middleware defect. Productive middleware therefore remains unchanged. Owned database/bridge disposal is asserted. HTTP negatives remain in each future endpoint task.

## T7: Canonical Business Policy

**Assumptions**: this is a pure domain resolver, with no database or HTTP responsibility. Stored modality, explicit legacy-service evidence and policy/version determine new-admission capabilities. Existing reconciliation is always preserved; this resolver does not authorize financial settlement or bypass the global paid guard. Segment, role and plan do not infer business mode.

**Files to touch**: merchant/domain/service-business-policy.ts and its unit spec; feature tasks/evidence. The generated Full gate is corrected to Quick plus strict focused TypeScript validation because there is no endpoint or repository in this component. T8/T9 retain real HTTP/DB and T9 the phase Build.

**Success criteria**: products remain the default legacy journey; ambiguous service/mixed legacy needs explicit classification; no service booking without explicit valid policy and admissions enabled; four hold/payment combinations, positive integer hold duration, invalid modes/configuration and incompatible mode-change facts are covered. Disabling new admissions never disables existing reconciliation.

**Gate result**: PASS. Unit 14/14 with zero failed/skipped; focused strict TypeScript exit0. RED missing-module gate preceded implementation. The resolver exposes explicit classification/configuration/admission states, clears inactive hold duration and validates PostgreSQL Int-compatible positive minutes. All four combinations and legacy/invalid/in-flight outcomes assert domain results. No payment writer, existing product flow or global paid guard changed. Full HTTP/DB and phase Build remain T8/T9.

**T12 composition**: the pure mode-change helper is not sufficient authorization to change modality. T12 must also query canonical active/pending checkouts and financial attempts and reject an incompatible change before writing. Initial signup selection cannot be reopened by client-supplied pending flags. Existing reconciliation keeps its own financial/ownership guards.

## T8: Persist Exclusive Signup Choice

**Assumptions**: completed password signup requires an explicit products/services value, independent of segment/role/plan. OAuth creates a preliminary pending merchant; company-data completion selects once from persisted pending state. Settings cannot change an already selected mode, even with forged pending flags. A compare-and-set inside the same transaction protects concurrent completion and rolls back company-data changes on conflict.

**Files to touch**: register request/use-case, auth port and its two repositories/types, signup swagger contract; one initial-selection helper composed into the two existing settings writers and their role checks; three legacy signup specs receive only the explicit products fixture field. New unit/native HTTP/DB onboarding tests and feature metadata. No frontend UI changes until T10, no remote OAuth/PSP call.

**Success criteria**: both explicit modes persist atomically with owner creation; absent/invalid mode and duplicates leave no partial records; real HTTP login and stored mode agree. Pending completion uses canonical state, rejects foreign/staff/forged/repeated-different mode requests, and one concurrent conclusion wins without mixed settings. Products keep prior billing/role/auth behavior; no service policy is silently created. HTTP uses canonical AppModule and actual repositories/authentication, with zero external-provider calls and owned cleanup.

**Gate result**: PASS. Auth/OAuth unit/regression 25/25, writer/controller regression 19/19, real AppModule HTTP/DB 12/12 in 85s; no failed/skipped cases. Typecheck/build checked and lint exit0, with two preexisting lint warnings. Fresh build covers 2,485 productive sources and current hashes validate. The two settings paths enforce single selection; canonical pending/review and offer/appointment/payment facts are read before CAS. Concurrent different completions yield 200/409 and coherent stored mode/company data. All rejected requests preserve stored state. Canonical OAuth preliminary persistence is tested with a synthetic linked password for real authentication; provider token exchange is not claimed. Existing valid signup fixtures only gained explicit products, with assertions/errors intact. App-close ACK, natural exit and owned cleanup passed; provider calls remain zero.

## T9: Authenticated Business Profile

**Assumptions**: modality/policy/capabilities are additive to the existing /merchants/me profile. Role and plan remain their existing independent authorities. A pure whitelist mapper exposes only commercial configuration; it never spreads credentials or raw policy/database records. Legacy service evidence comes from actual offers/reservations when selection is absent.

**Files to touch**: canonical business-profile mapper and unit spec, composition/type in the existing Prisma profile reader and MerchantProfile interface; native onboarding HTTP/DB companion for T9; feature evidence. No product/customer flow or frontend navigation changes.

**Success criteria**: new login retrieves persisted mode/version/capabilities; unconfigured/disabled/review states fail closed for new service booking, existing product fields remain equal, secret sentinels never appear, and different plan/role do not infer a mode. Finish with the four apps' serial typecheck/build, lint and this phase's owned integration/unit/browser gates.

**Prerequisite hardening**: parallel review found food omitted from the product conflict count and a race between facts and CAS. The real food HTTP negative reproduced 200 instead of409; no assertions were weakened. Follow-up commit 07ba2b7b3 includes food and the shared merchant lock before facts, in the same transaction. A controlled PostgreSQL writer inserts while holding that lock; pg_stat_activity proves selection waits before reading facts. After catalog commit it returns409 with mode/settings unchanged. The product remains present. This is local admission proof, without financial reclassification or provider action.

**Final phase gate**: PASS. Unit 76/76, infrastructure contracts 6/6, real native integration 50/50 and browser 1/1, zero failed/skipped cases, all exit0. The native set is T2=7, T5=9, T6=15, T8=13 and T9=6. API/widget/dashboard/storefront typecheck and build all exit0; heavy builds were serialized. API lint exits0 with the same two preexisting warnings. The final checked API artifact covers 2,486 productive sources and was validated again by the browser runtime after frontend builds. Browser preflight5450ms/boot21131ms; teardown completed with actual app-close ACK/natural exit and owned cleanup. Local login and WhatsApp-fixture desktop/mobile captures were retaken. No Meta/PSP/provider/OAuth token exchange or production acceptance is claimed. Broad preexisting baseline failures remain separate, and final feature proofs/independent verification belong to root after T95.
