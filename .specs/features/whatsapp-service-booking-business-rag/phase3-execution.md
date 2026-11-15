# Phase 3 Execution

## T17: Catalog Business Mode

PASS for the approved Full gate. Unit6/6, actual AppModule HTTP/database12/12, existing catalog/ERP regressions60/60 and normal checkout/source/coupon/identity/history48/48 passed without skipped cases. API typecheck and checked production build exited0. The build covered2,487 productive sources. The shared worker acknowledged close, exited naturally0 and removed owned containers/bridge sockets. No provider was called.

Canonical catalog writes resolve the persisted merchant mode under the existing merchant lock. Both catalog repositories and the independent ERP snapshot writer use that guard. New service offers and product offers remain exclusive; physical, digital and food offers keep product mode. Persisted pending signup markers require explicit selection. Normal legacy products remain allowed; service/mixed or orphan historical reservation evidence requires classification. Withdrawal does not force old offers through current publication validation. Historical checkout/payment writers are not gated by new catalog admission.

The first native run was red:10 subcases passed, the new CSV fixture used an unsupported header and the final provider invariant rejected a first-use local embedding model download. The fixture now uses the existing peso g alias. Root authorized only the local worker's supported Transformers allowRemoteModels=false setting, asserted before AppModule and returned as actual runtime evidence. Repository/auth/provider trap checks stay intact. This exercises the real missing-model fallback and proves no successful embedding or RAG behavior.

The supplemental product-types-only regression failed before any business case because its existing deployed SQL asset is absent, including at the T9 base. Its owned database/bridge cleanup passed. The source was found only as an untracked principal-workspace file; it was not copied. Root owns canonical asset research and final REG follow-up. This extra run remains failed setup, separate from the completed approved T17 gate. No global regression or production-readiness claim is made.

The first launcher attempts also remain recorded: recursive scripts selected a global pnpm that tried package-manager auto-install, blocked by the network fence; the temporary Windows shim initially lost quotes. The successful launcher uses the existing cached9.15.0 CLI and its existing .bin/pnpm.CMD under a sanitized guarded environment. Packages, lock and build checks were not changed. Future T18–T25 drafts are hash-preserved outside productive fingerprints and will be restored in task order.

Evidence: task-17-evidence.json. Logs: .cache/phase3-gates/t17-*.log. Final verifier and global proofs belong to root after T95.

## T18: Professional Repository

PASS: unit4/4, actual owned PostgreSQL and tenant middleware7/7, zero failed/skipped. Checked API build exited0 with2,491 productive sources. The repository is registered through the canonical CatalogModule factory; its resource endpoints belong to T19. No artificial HTTP facade was created.

Professionals have a typed public description/specialties profile, timezone, publication/activity state, canonical service associations and expectedVersion. Creation does not create a login. Tenant-scoped updates and version races preserve resource/link identities. Deactivation withdraws publication and preserves appointments, prices and links. A real foreign composite FK failure rolled back the preceding mutation. Own resources and bridge sockets were removed.

The first DB run failed7/7 because a mapped nested Prisma input repeated merchantId inherited by the professional relation; later scenario assertions cascaded. TypeScript structural assignment accepted the inferred mapped extra property without an any cast. The fix creates the scalar professional and typed createMany links in the same transaction, with a satisfies check and an explicit Prisma input return type. Schema and all tests/assertions were preserved. A new checked build and the unchanged full native scenario passed after the fix.

Root reviewed the approved entitlement contract: Atendimento is gated by services mode and explicit role, without a newly invented STORE_ONLY/BOTH tier. Existing applicable entitlements and sales quotas remain. T19 will prove API-plan professional operations as well as staff read opt-in and forbidden mutations. Evidence: task-18-evidence.json.
