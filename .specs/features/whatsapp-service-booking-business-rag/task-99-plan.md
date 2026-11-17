# T99 private support notification recipient

## Assumptions

The user selected a WhatsApp staff alert with an authenticated conversation link. T99 persists only the private recipient; T100 owns dispatch and T101 owns the UI. Both business modes may configure it. Reuse owner/admin and explicit support-scoped credential authorization. No public company/FAQ/RAG field, borrowed company phone, new role, provider message or new commercial entitlement.

T53 is complete. This independent task may proceed while T70 waits for a suitable build environment. Preserve all19 uncommitted T70 API paths, their original tracked patch/new bytes and hashes outside the productive inventory first. Parking does not complete or discard T70. Restore that exact work after a verified T99 commit; current checked artifacts never authorize different input bytes.

The source candidate already exists in C:/tmp/zyon-support-alerts-20261116 at base b5adc21f. Integrate only its ten declared source/test/migration files into the current committed N baseline aa30b1511, using a three-way/context patch for the existing three files. Preserve the current specification/task/STATE metadata rather than copying the old candidate's metadata wholesale. No dependencies or compiled output are copied.

## Files

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20261116000000_support_notification_settings/migration.sql
- apps/api/prisma/deploy-migrations/20261116000000_support_notification_settings/migration.sql
- apps/api/src/shared/persistence/tenant.middleware.ts
- apps/api/src/modules/support/support.module.ts
- apps/api/src/modules/support/domain/support-notification-settings.ts
- apps/api/src/modules/support/domain/support-notification-settings.spec.ts
- apps/api/src/modules/support/application/manage-support-notification-settings.use-case.ts
- apps/api/src/modules/support/application/manage-support-notification-settings.use-case.spec.ts
- apps/api/src/modules/support/presentation/http/support-notification-settings.controller.ts
- apps/api/tests/support-notification-settings.integration.spec.mjs

## Approach and success

Use a private tenant-owned table with a real merchant FK, normalized nullable E.164 recipient and positive configuration version. GET absent yields null/version0 without creating any row. Explicit null clears; missing/extra/invalid input fails. Serialize mutation through the merchant row without updating public source/FAQ timestamps. Saving an identical normalized recipient is a no-op. Keep private/no-store responses and recipient-free audit metadata.

The prepared domain cases precede their implementation and retain their expected outcomes. Full proof requires the new input cases plus unchanged support-settings regressions, actual owned AppModule HTTP/SQL save/read/clear/role/scope/privacy/FAQ concurrency/rollback and migration/FK checks. There must be no provider calls, skipped old tests or weakening. Record concrete selectors before execution. Fresh official checked API/schema build and affected lint remain required before task completion and its single local commit. T100/T101 are not complete from this task.

While M55 owns the execution slot, Root performs file/patch/hash/source work only. No application import, parser, Prisma generation, test, build, database, browser or memory probe is started here.

## Adopted source and component selector

All19 T70 paths were copied and hash-verified in .cache/t70-park-before99-20261116T225815Z (manifest cfc76532); the ten tracked paths were restored and nine new files moved only inside that owned cache. The API baseline was clean before adoption. Source adoption d3a6c3cd at .cache/t99-source-adoption-20261116T230349Z copied only the seven new source/test/migration files and applied the three existing-file changes with a checked context patch. All ten resulting source hashes exactly match the prepared candidate. No compiled artifacts/dependencies were copied, and no test/build ran during adoption.

The initial component cohort is unfiltered: domain/support-notification-settings.spec.ts (5 including root), application/get-support-settings.use-case.spec.ts (3), application/update-support-settings.use-case.spec.ts (4), domain/entities/support-settings.entity.spec.ts (9), infrastructure/in-memory-support-settings.repository.spec.ts (6):27 expected cases. Run with the existing network guard, ready-prod-loader and concurrency1 under the existing1024MiB unit admission only after C returns its permission-test slot. This cohort covers the new input rules and unchanged FAQ/settings behavior; actual HTTP/SQL privacy, authorization, versioning, rollback and migration remain the required Full gate.

The unchanged tests/service-migration.integration.spec.mjs (rootT5 plus8children=9) can separately prove real deployment of all pending migrations and exact current schema parity, while preserving legacy commerce/stock/payment fixtures. It creates only its UUID-owned isolated Postgres and loopback facade, uses the existing local marker/Prisma migration guards, default90sCLI/600stest limits, and proves owned cleanup. Run unfiltered with the original network guard under the existing1024MiB PG-only admission. This requires no AppModule, generated new client or old compiled artifact. It proves the new schema is deployable; actual T99HTTP authorization/privacy/recipient persistence and fresh full checked build remain pending until their own gate.

The first component27 and schema validation passed; the unchanged actual migration9 also passed on the new schema with normal cleanup. Add the missing application-level component coverage before the full HTTP gate: the real ManageSupportNotificationSettingsUseCase and real TenantContextService must produce the specified persisted recipient/version, no-op, clear, projection, scope and failure outcomes over a deterministic in-memory persistence fixture. Eight child cases plus their root (9) add to the original27, for36 expected. This is neither HTTP role authorization nor actual SQL rollback proof; those remain the original actual HTTP/SQL10 gate. Preserve all old cases/assertions and all ten existing source hashes. No productive implementation change is proposed by these additional criterion-derived tests.

## Small controller gate while full builds are deferred

The user selected code and smaller tests. Add only `src/modules/support/presentation/http/support-notification-settings.controller.spec.ts`, then execute its ten child cases/root (11) together with the existing36 and the unchanged three TenantAccessGuard cases:50 expected, eight files, unfiltered. Read the actual decorator metadata with the real TenantAccessGuard, validate the actual DTO with the established class-validator/class-transformer pipeline, and call the real controller/use case/TenantContext over a bounded read fixture. Cover owner/admin, staff denial, absent principal, distinct read/write service scopes, unrelated scope denial, nullable recipient/invalid/foreign DTO fields, the authoritative principal tenant and mismatched context before I/O. This is component authorization and input/routing proof, not credential authentication, HTTP middleware execution or SQL persistence/rollback. No guard/controller/application behavior or old assertion changes are planned. The original Full AppModule HTTP/SQL gate remains required.

Incremental source review found no concrete implementation defect and three proof gaps. Before this first controller cohort, add one independent application case for non-null A-to-B replacement: exact oldVersion+1, new normalized recipient, changed stored timestamp, read-back, foreign row preserved, then normalized equivalent of B leaves the complete projection/storage unchanged. Removing only the added child must reproduce the original application spec SHA60b7f77d. This raises the first current controller cohort from50 to51; all old36 and three guard cases stay intact. Concurrent SQL writes and failed-audit privacy receive additional actual HTTP cases for a later full gate, not a simulated concurrency assertion.

Run affected production-source ESLint separately on the five T99 changed TypeScript files, using the repo config and existing1024MiB small-gate admission. No compiler, schema generation, browser, database, provider call or new heap setting. Record natural results and preserve all original11 source hashes and the new controller spec.

## Reviewed additive HTTP coverage

Review32e2e864 identified missing actual same-setting concurrency and failed-audit privacy coverage. Integrate the insertion-only M proposal4f7b21f9 into the existing integration companion after reviewing the real writer fixture, SQL JSON reader and audit interceptor. Three additional children raise the eventual Full gate from10 to13 including its root; all original nine children remain byte-exact and reconstructing the original file must yield SHA30ccd4e2. Cases cover identical concurrent first saves and different serialized replacements, exact non-null replacement/version/timestamp with normalized no-op, and one correlated failed audit after a real DB-trigger rejection with unchanged private/public/foreign state. Original HTTP15s/root600s and bounded5s observation stay unchanged. No Prisma/client/AppModule bypass, production table or provider call. These additional HTTP cases remain unexecuted until the deferred fresh checked build and actual Full gate; the51 component pass precedes this HTTP-only addition and is not an HTTP result.

## Complete execution resumed

The user's instruction to finish all tasks resumes full gates. Root retains the sole execution slot for the original standard checked API pipeline (capture inputs, full unchanged build, record only natural exit0) at its existing5168MiB admission, then a separate fresh2048MiB admission for the actual thirteen-case AppModule/SQL companion. Reuse the existing T70 runner environment/launcher and resource gates, relabel only the launcher and select the actual T99 native file. No compiler coverage, heap, deadline or artifact guard change. Source remains frozen during the build and native run;51 unchanged components and affected lint are already green and need no blind repeat. Resolve actual source/fixture failures while preserving every test. Only complete99 and commit after required gates are green.

The fresh standard admission at01:10:16Z refused3954MiB before capture/compiler, despite the earlier read-only8013MiB observation. Retain that refusal. Use the previously adopted monitored alternative, copied from the five reviewed T70 helpers with task-label substitutions only:3072initial/1536live reserve/300ms sampling/max500ms gap/exclusive owned Job, unchanged full command/default heap/coverage. Actual natural0 plus empty Job, no breach/forced termination, and current inputs/outputs are prerequisites for the separate root-reviewed attestation step. This is reuse of an already adopted path, not a guard relaxation or new build tooling contract.

The monitored attempt refused an actual516ms sampling gap and proved its owned Job empty; it created no attestation. A later original5168-admitted standard build passed2550 checked sources, input9bcd1402/artifact848ace7b at02:02:21Z. First actual13-case HTTP/SQL run executed all cases and closed its runtime;11 passed, one FAQ interoperation child failed400 instead of200, causing its parent failure as well. All private-recipient/auth/scope/concurrency/rollback/failed-audit children passed.

Source review found the fixture omits the existing mandatory Idempotency-Key on `PUT /support/settings` (`@Idempotent()` and the existing interceptor), unlike the already-green public-support writer fixture. Correct only the local request wrapper for that route/method to send a fresh UUID header. Keep every child body/assertion byte-exact; do not alter any expected status, API source/guard, rate limit or deadline. This fixes invalid transport setup, not an oracle or product contract. Snapshot/reverse-check before application, then rerun all13 against the same own API artifact if its unchanged compiler-input/output guard readmits it. The MJS harness is explicitly outside productive compiler input and remains separately proven by this native run.
