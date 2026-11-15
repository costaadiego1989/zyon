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

## T19: Professional HTTP Management

PASS: unit3/3, fresh checked API build0 with2,498 productive sources, actual AppModule HTTP/database6/6 including five business scenarios, zero failed/skipped. The unchanged five-second natural worker-exit guard passed with exit0 after close ACK. Owned containers/bridge sockets were removed and providerCalls remained0. The final diagnostic recorded no referenced timers before ACK or at disconnect.

The first draft fixture omitted the required ProfessionalService triple before seeding its historical appointment. Creating that real link fixed the setup without changing any assertion or schema. The next three runs passed5/5 business scenarios and failed only the root cleanup check. Awaiting and asserting the canonical asynchronous HTTP audit by correlation did not resolve that failure. Logs remain preserved as t19-native-first-failure.log, t19-native-cleanup-failure.log, t19-native-resource-failure.log and t19-native-scanner-diagnostic-failure.log.

Root authorized test-worker-only diagnosis. The first diagnostic reported three PipeWrap resources, TCPServerWrap and Timeout before ACK; disconnect temporarily added SimpleWriteWrap. The full diagnostic identified the referenced timer as RecoveryScannerJob.scan jitter after app.close. The remaining server was not listening and had zero connections. The inference that the scan reopens Prisma was not directly observed. No handles are forcibly closed or unrefed in the harness and no deadline is changed.

Root authorized a separate lifecycle follow-up, committed as b95f343ce after Quick37/37 and an independent read-only review by service_batch_01. It resolves only the job-owned jitter, drains scans before Prisma shutdown and prevents new work after stop. That earlier commit explicitly left checked build and native success pending. T19 TypeScript/module files were hash-preserved outside the fingerprint during the follow-up, then restored unchanged. Because source changed, the previous checked artifact was retired. The final fresh build and native retry now pass. Status was marked complete before the atomic T19 commit. The earlier failed runs and their original limits remain recorded; this is local runtime evidence, not a production shutdown or final feature claim.

## T20: Canonical Professional Eligibility

PASS: unit7/7, owned PostgreSQL/tenant middleware4/4 and actual AppModule HTTP/database4/4, zero failed/skipped. Checked API build exited0 with2,500 productive sources. Price remains on the canonical variant, duration on Product.metadata.serviceSchedule and timezone on the professional. Shared categories do not create resources or duplicate capacity. Foreign and withdrawn associations are ineligible.

The registered eligibility endpoint applies real auth, tenant, services mode and staff read opt-in with bounded cursor pagination. Its public profile output projects only typed description/specialties. An actual private JSON canary was absent from the served response. The new fixture uses a separate category create and scalar categoryId rather than mixing checked/unchecked nested input; no assertion was weakened. Close ACK, natural exit0, provider0 and owned database/bridge cleanup passed.

C attested the integral T19 source/artifact hashes before this task restored any future source. The old static offer-slot helper is unchanged; channel composition must still use canonical professional availability for duration-only services. Evidence: task-20-evidence.json.

## T21: Recurring Professional Availability

PASS: unit5/5 and real owned PostgreSQL/tenant middleware5/5, zero failed/skipped. Checked API build exited0 with2,502 productive sources. The canonical command/factory saves timezone, bounded recurring intervals and effective dates under merchant-then-professional locks with expectedVersion. Old rows remain inactive and unchanged appointment snapshots survive replacement, including a precise historical timestamp.

A new minute-precision check first failed with3pass/2fail against the generic-only validator. New validity now requires exact minutes; the generic parser still preserves seconds/milliseconds for history and reconciliation. Actual invalid writes leave rows, resource version and event count unchanged. A same-version race has one winner, one active coherent grid and one postcommit identity/version event. Owned Prisma/database/bridge cleanup passed. HTTP write routes remain T25; no facade was introduced. Evidence: task-21-evidence.json.

## T22: One-off Times and Blocks

PASS: unit6/6, fresh checked API build0 with2,503 productive sources and actual owned PostgreSQL/tenant middleware8/8, zero failed/skipped. The registered command exports saveAvailabilityException for a caller-owned transaction; later-operation failure rolls back interval and professional version together. Shared locks retain merchant-before-professional order. Conflicts preserve confirmed history and adjacency remains available.

The first native run passed four business cases and failed its new lock observer. The holder locked professional then inserted an appointment, whose merchant FK KEY SHARE could precede the command merchant FOR UPDATE. Root reviewed that inverted fixture and authorized two proofs: an exact-PID professional-only holder with no INSERT, and a canonical merchant-then-professional confirmation holder. Both use observed pg_blocking_pids with unchanged deadlines and safe finally draining; all prior business assertions remain.

Further review found historical withdrawal was incorrectly tied to the current professional timezone and a new inactive row could bypass minute precision. New unit RED3pass/3fail preceded the fix. Existing withdrawal now preserves original interval/kind/timezone/reason after an actual timezone edit and professional deactivation. New/reativated inputs keep current-zone/minute rules. The earlier build was retired; this final fresh build and native passed. Prisma disconnected and owned PostgreSQL/bridge cleanup passed. HTTP management remains T25; no artificial route or production/provider claim. Evidence: task-22-evidence.json.

## T23: Canonical Professional Availability

PASS: unit15/15, fresh checked API build0 with2,505 productive sources and actual owned PostgreSQL/tenant middleware7/7, zero failed/skipped. The valid31-day five-minute window returned all8,928 slots in its476.1924ms native case within the unchanged ordinary5s transaction. Shared services subtract confirmed occupancy from the same professional, parallel resources stay independent, and empty/stale/error outcomes remain distinct. Actual renamed-table failure was restored before cleanup.

Each original recurring occurrence and one-off contributes its own start anchor. Union supplies coverage, not a new origin; clipping, blocks, occupancy and query-window changes cannot move choices. Rules construct instants in their stored timezone, while the current professional timezone presents dates. Daily and multi-date fifty-minute alternatives agree. Overlapping alternatives remain valid until confirmation; ISO intervals deduplicate output. Root explicitly accepted this interpretation before the gate. The original draft first failed five new subcases plus root,7pass/6fail, without weakening approved results.

A preparatory maximum showed2,940.6934ms of pure calculation before formatter reuse. Root authorized mechanical reuse of up to128 Intl formatter objects inside the existing civil-time helper; no availability/result cache or build waiver was introduced. Fifteen outcome tests pass before/after that reuse, including half-hour DST and the unchanged static slots[] behavior. The post-change preparatory run used an explicitly capped256MiB heap and returned8,928 slots in601.9503ms; those flags differ, so no identical-flags comparison or transaction proof is claimed from the benchmark. The actual native maximum above is the transaction proof.

Earlier physical-only and generic commitment preflights refused before any worker. Root refined only orchestration using read-only Windows kernel commitment and measured default Node heap4144MiB, retaining normal compiler/typecheck/flags and all deadlines. The final build snapshot passed physical642MiB/commit5464MiB against512MiB and default heap+1024MiB. Native had its own healthy snapshot3797MiB/9626MiB. All earlier refusals are preserved; no unrelated process was terminated.

The SQL fixtures use the complete legacy metadata shape with timezone/duration/slots:[] and prove canonical reads, not actual catalog creation. The static global helper still regards empty static slots as unavailable; booking/discovery composition must call this shared professional reader. HTTP routes remain T24 and hold overlays remain T27/T40. Prisma disconnected and owned PostgreSQL/bridge cleanup passed. Evidence: task-23-evidence.json.
