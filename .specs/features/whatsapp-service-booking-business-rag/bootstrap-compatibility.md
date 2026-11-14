# API Test Type Compatibility

Local bootstrap PASS: API typecheck/build, four compiler/deadline contracts and the real owned runtime 7/7. The affected legacy suite retains its 14 baseline failures with identical error signatures; it is not labeled green. No business implementation changed.

The original API typecheck exited 2 with 14 diagnostics in nine existing specs. Production build remains checked. No service business source or schema was changed before this result.

The orchestrator authorized a separate local bootstrap commit to correct fixture types and the current shipping constructor signature. Preserve all scenario data and business assertions. Do not add noCheck, ts-ignore, generic casts, or remove intentionally invalid JSON. Changes and results are recorded here before implementation.

- Normal cross-sell/session anchor: keep extra JSON and invalid legacy fulfillment data through explicit runtime fixture injection.
- Coupon application: make stored row customer/shipping fields structurally present with the same values.
- Coupon redemption: name the transaction fixture type before its callback parameter.
- Cross-sell resolver: use the real product entity and a complete, typed repository fake, with unexpected methods rejecting.
- Embed shipping: pass the manual configuration in its current fifth constructor argument; do not invent Prisma success.
- Storefront terminal and shipping reference: inspect dynamic JSON fields through reflection, keeping the same expected values.
- Cross-sell marketplace: keep the intentionally incomplete foreign marketplace data as explicit invalid JSON.

Gate: API typecheck must exit 0. Execute all nine affected spec files with the existing guard/loader. Any runtime failures must be matched to the recorded baseline; new failures block the bootstrap. Do not report baseline failures as passes.

Typecheck now exited 0 using the unchanged package script, with no compiler waiver. The selected nine specs executed 248 tests: 234 pass, 14 fail, zero skipped. All 14 failure titles and complete error signatures match the previous baseline, including the two freight contract differences. The unchanged failure comparison is stored in bootstrap-runtime-comparison.json. No new runtime failure was introduced, and this suite is not labeled green.

The production fingerprint now derives the actual compiler program from TypeScript readConfigFile/parseJsonConfigFileContent/createProgram. It includes an excluded file when an active production import brings it into the program. A focused RED/GREEN contract proves both that case and exclusion of an unused spec. Package compiler configs are also hashed. Test/harness evidence remains separate from compiled production inputs. A fresh checked build and attestation are required after this correction; neither the prior manifest nor its digest is rewritten as if that build had occurred.

The fresh checked API build exited 0. The unchanged source matched its before-build fingerprint; input digest is fb347e14f6c1ffe70c516b1453e7279cd2e6d0df574f013fe8498acde27a8a4a and artifact digest f9cddcce5bbf9a41b6664fc9c2e3db932ede0e717e1e5c2f430fecc93cf2eaf7. Build log: C:/Users/Admin/Desktop/AACP/.audit/service-plan-20261114/execution/bootstrap-api-build.log.

The first T2 rerun with compiler-program integrity failed with 5 pass/2 fail/0 skip, service_app_ready_timeout:owned_markers_checked. Static analysis consumed most of the boot deadline before the API was imported. Owned resources were removed. This failure is preserved in bootstrap-runtime-new-fingerprint.log; it is not called a successful runtime proof.

The orchestrator authorized separate local startup budgets. Integrity and owned-marker verification have a finite 150-second preflight. Only its one-time IPC completion starts the unchanged 110-second API boot deadline. Construction/init remain 45 seconds each. Repeated signals cannot renew a settled promise. A missing preflight or missing readiness still fails. Four focused contracts passed, including a frozen API that rejects at exactly 110 seconds under a virtual test clock. No persistent compilation cache or alternate manifest protocol was added.

The aggregate local test ceiling is 600 seconds: 120 for parent compilation verification, 120 for owned-resource provisioning, 150 preflight, 110 API boot, 60 HTTP/browser gestures, and 40 shutdown. This ceiling is a test budget, not a production setting. Shutdown still requires app.close acknowledgement, natural worker exit 0 and removal of owned containers/bridges. No productive rate-limit, Redis, payment or appointment timeout changed.

The phased rerun also failed: 5 pass/2 fail/0 skip with service_preflight_timeout:worker_started at the 150-second static-integrity limit. No API was constructed, and owned resources were removed. Raising budgets again was rejected. The orchestrator approved returning to a conservative source superset for runtime hashes: all API/package source TS/TSX/MTS/CTS/JSON plus configs and emitted JS/JSON. Excluded specs remain conservatively hashed; their changes can require an extra build. This is stricter source invalidation, not an omission of productive imports.

TypeScript's actual program now runs only during build-input capture. Every non-declaration, non-external source of that program must belong to the hashed superset or capture fails. The before/after superset must match around the real checked build. Runtime validates those hashes and outputs without loading a compiler program. No persistent compiler cache or alternate artifact protocol is introduced. A new real build/attestation is required and is running; the previous program-only hashes above are historical evidence, not the active final proof. Infrastructure changes stop once the new runtime gate is green.

Final bootstrap gate: the new checked build exited 0 and coverage passed for 2,483 productive sources. Active input digest is 1ac9b88b441c9f805e278507acdc89a01c934702dca168ca58d532a0034e422a; source-plus-artifact digest is 3423819cc21711ddf7fccb0d994b000cd8568c082a6ea01fcc77f4cb9d2aedf4. T2 passed 7/7, zero fail/skip, in 109.4 seconds, with actual app.close ACK, natural exit 0 and removal of owned resources. Four compiler/deadline contracts passed. The source of truth is bootstrap-runtime-cleanup-cause.log, not the earlier failed attempts.

One intermediate superset run failed with the generic cleanup aggregate after completing the real API assertions. Containers were removed; the original nested cause was unavailable. The next run added bounded causal messages and stage names, then passed with unchanged cleanup budgets/assertions. Do not claim an identified shutdown defect was fixed. The following browser T3 gate independently requires the same teardown. Productive runtime shutdown is still not claimed; owned Redis cleanup may use the documented harness assistance.
