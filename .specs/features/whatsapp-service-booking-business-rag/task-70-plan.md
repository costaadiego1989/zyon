# T70 implementation plan

T69 is committed and green at ad81d32c9. This task adds a separate public-business read capability to the existing graph transport. It preserves legacy templates, hashes, TTL, admission operations and product behavior. No buyer or model can supply query syntax. Final buyer orchestration and live price/availability composition remain T71.

## Assumptions

- Public graph rows are candidates, never current answer text, price, availability or authorization. The existing canonical evidence fence remains mandatory.
- A service/professional hint is not a relationship proof. Both current public sources and the canonical published link must be admitted after retrieval in one merchant-first snapshot.
- Public static data does not acquire the legacy catalog freshness TTL. Current source version, publication and pinned embedding ABI remain required.
- An older gateway may continue serving legacy reads while its new public capability is unavailable. Public admission is separate.
- Heavy execution is serialized by the current tasks.md Handoff owner. T54 has since passed and was integrated before the fresh70attempt. T55 is not a T70dependency; its source preparation is separate and cannot run while another owner holds the slot.

## Files

- New graph domain public-business-query.ts, public-business-result.ts and public-business-query.spec.ts; external C drafts are reviewed proposals, not test evidence.
- gateway/query-protocol.ts, query-gateway.ts, community-read-engine.ts; existing adapters community-gateway.adapter.ts and neo4j-graph.adapter.ts.
- graph-rag.port.ts, new application/public-business-retrieval.service.ts and graph-rag.module.ts for the additive typed runtime capability.
- Existing public-source-evidence.ts and revalidate-public-source.service.ts add the bounded distinct revalidatePairs method. It reuses the unchanged PrismaPublicEvidenceSources read/port in one canonical snapshot and requires both endpoints plus the exact publicData.professionals ID. No canonical-port or old non-pair signature change.
- New targeted public graph transport/retrieval specs and tests/business-rag-public-query.integration.spec.mjs; necessary existing owned fixture helpers only. No auth/repository overrides or new public API.

## Success and gate

Test the new source and pair results, strict input/response bounds, all six public families, pinned ABI, canonical relationship and source withdrawals, foreign scope, current/stale/mixed hash refusal, request/response signatures, replay, shutdown and existing engine deadline. Keep every old graph/gateway/adapter/runtime/evidence test unfiltered. Use the standard full checked API artifact and owned Neo4j/PostgreSQL/Redis, with zero skips and no provider traffic. Actual AppModule buyer selection is explicitly T71, not claimed from parent-class transport tests.

The technical T70 gate selects the complete new public-business-query.spec.ts rather than ^T70 in the legacy graph-query.spec.ts. It also runs the complete old graph files and new transport/relationship files. The native gate is business-rag-public-query.integration.spec.mjs. This preserves the original Full requirement and prevents a zero-match or skipped old cohort; concrete commands and actual counts are recorded before execution.

One local task commit follows the real green Full gate, never preparation alone. No push, deployment, production migration or customer messaging.

## Source review before first execution

P reviewed the draft and current implementation read-only. The distinct revalidatePairs avoids the old flat ready/half-pair pitfall and preserves the canonical port. Before any run, Root strengthened the held-response test to release and settle its pending request on every error and honor the existing rate limiter before holding the graph response. The fixture follows the proven Starter-for-catalog then Growth-for-policy sequence, avoiding unrelated background SEO generation. No old assertion, runner deadline or productive SEO path changed. These are preparatory corrections, not executed proof.

## Follow-up source review after first component gate

The first905component cases passed before the final new caller-deadline case. Read-only P review found no blocking tenant/provenance/relationship/capability issue. The new held-graph-reply test exercises the caller timeout and verifies that a late success cannot replace the returned unavailable result. It does not claim cancellation of embeddings or in-flight driver work. Existing bounded engine transaction and legacy retrieval remain unchanged. Whole component count must be906 after the addition; no prior oracle was edited. Native05 proves a real unlink committed before post-graph canonical admission, not a lock-wait race inside that snapshot.

The exact reviewed monitored69build helpers are prepared as70task-label/path-only copies, with reuse manifest in .cache/t70-monitored-reuse-manifest.json. Full normal compiler command/coverage/heap are unchanged. Existing monitored admission3072MiB, live reserve1536MiB,300ms sampling/max500ms gap, exclusive created job, natural zero exit/current input/output identity and finalization remain mandatory. They are not a waiver for native2048or ordinary5168admission. No execution while another owner holds the slot.

## Current partial evidence

Root integrated54as9f0df7829, preserving all20nonoverlapping own dirty70files byte-for-byte. Whole906components passed on combinedsource,0fail/skip/cancel, including the new caller-timeout case. The fresh ordinaryAPIbuild captured2551sources/input52880590 and admitted5382MiB against5168, but hostcommit later fell to814MiB. Root interrupted ONLY its own execsession91036 with Ctrl-C; exit1. No compiler error was displayed, no record phase or current checked artifact exists. Read-only known-own-command scan afterstop found0; no foreign process/container was changed. task-70-evidence.json and the interruption receipt retain these boundaries. Do not run native against the old69stamp or close70until fresh checked build and actual13native cases pass.

## Stricter monitored build after reviewed UI window

The reviewed6500MiB initial-admission variant changes only that lower bound upward from3072; all five reused helpers match the original manifest. P source review at .cache/t70-strict-build-review-20261116 found no blocking delta. Live1536MiB reserve,300ms cadence/max500ms gap, exclusive newly-created job/verified handles, full unchanged pnpmAPIbuild/defaultheap/compiler coverage, terminal/final sampling, natural0/emptyjob and exact current input/output admission remain unchanged. No successful record is published by the build worker. Root inspects its actual receipt and only then invokes the separate reviewed finalizer. A refusal or interrupted monitored run is retained and cannot admit an artifact. No old69stamp/output reuse.

## Explicit monitored-path selection after strict refusal

At22:15:03Z the extra6500initial variant refused4071MiBcommit/473physical before creating a child. Root now selects one bounded attempt with the unchanged previously adopted3072initial/1536live monitored path, supervisor d2b8a4df and original four auxiliaries. This replaces the optional extra startup buffer for this attempt; it does not change the ordinary5168 launcher, native2048 admission, compiler/heap/coverage/test deadlines, live reserve,300ms/max500ms checks, exclusive-owned-job containment or separate reviewed publication. Neither script is edited.

Read-only independent history review78ab27c3 found two real monitored full-build successes, both starting above6GiB, and one fail-closed sampling-gap refusal. No successful3-5GiBstart is established. The ordinary5382->814 interruption and all three6500before-child refusals remain historical.4071admission does not guarantee fit. A reserve/gap/identity failure must terminate only the created job and remain refused, with no current artifact/native/completion claim. Root inspects the actual natural0/emptyjob/current-byte receipt before any finalize command. No foreign process, OS/pagefile/globalDocker setting or remote action is changed.

The actual22:16:18Z original-policy attempt admitted4027MiBcommit/947physical, then reached1486MiB after75samples (maximumgap313ms). It refused on live_commit_reserve_breached, terminated only its exclusive created job and proved jobEmptytrue. No worker build-result/current artifact or permitted record exists. This supplies a real resource failure at a3-5GiBstart, not a compiler diagnostic. Preserve the receipt and do not repeat a build absent meaningful environmental change; no threshold/coverage/heap/deadline reduction is a remedy.

C's later component admission actually observed7073MiB at22:20:28Z and all93cases passed/closed. Root selected one strict6500attempt after that measured change, but its own22:22:21Z preflight observed3103MiB and refused beforechild. The earlier7073was not a reservation or current-memory guarantee. Allfive supervisorreceipts are embedded with their original hashes in task-70-evidence.json. The current checkpoint has no fresh checked API, finalization or native13 result; future compilation still requires an actual suitable environment and the preserved safeguards.

## Exact restoration after private recipient task

T99 completed locally at e6a53bad2 with its own51 components,13 HTTP/SQL cases and ordinary checked build. The19 previously parked T70 paths were restored to their exact prior hashes; receipt b9ba538c and current freeze .cache/t70-after99-current-inputs-20261117/manifest.json preserve that identity. No test expectation or graph query source was changed. Four older untracked Root75 files were parked with exact hashes before future C75 integration, independently of these API inputs.

After M55 returned its own naturally completed checked build and closed processes, Root received the sole runtime window. validate_tasks --execute passed0 with two existing granularity warnings. The complete unfiltered906 component cohort is now being rerun once on this changed committed base because private99 added schema/DI/tenant registration since the historical T70 run. Its actual runner result remains authoritative. A fresh ordinary5168 checked build and actual13 native public graph/SQL/gateway cases still follow; no stale Root99 artifact, dependency copy, reduced heap or relaxed deadline is permitted. Any refusal remains partial evidence rather than task completion.


## Final local Full gate

After the exact original19-path restoration, whole906 components passed on the99 base. The unchanged ordinary checked build passed with2554 productive sources (input1850c014,artifactdd8a8b68), and remained current after the dashboard-only75 integration. The first native13 run failed11/2 with opaque canonical/socket errors; it remains in evidence without an inferred cause. Reviewed R2 adds only best-effort sanitized failure observations to two MJS files. All12 native bodies/finally, runtime, guards, API algorithms and budgets stay unchanged. Both syntax checks and12 existing ownership/TCP contracts passed.

The complete native file then passed13/13,0skip/cancel/todo, natural0 in97.1s; normal closed acknowledgment/disconnected cleanup. It used actual owned graph/SQL/gateway and no provider calls. No failure observation fired, so no retrospective cause/fix claim is made for the earlier intermittent errors. Gates cover T70 fixed templates/admission only; T71 consumer/live/final-answer composition and final same-HEAD independent verification remain open. One focused local T70 commit follows, no remote action.
