# T65 writer integration

T25 is integrated at1a415411a. All26 prepared file hashes matched before restoration. T65 is in progress; no completion or indexing claim. T63/T64 and C96/C97 remain regression gates.

An isolated draft in .cache/t65-prepared passed7/7 pure orchestration tests: six kinds without a graph dependency, bounded paging/resume, replay after normalization failure, tenant cursor separation/restart, stop after an awaited read, and invalid/looping pages. These are preparatory unit results, not the T65 gate. The transaction-bound reader/helper draft records its base SHA in reader-manifest.json; productive source is unchanged.

## Assumptions and boundaries

- Existing ordinary company, public hours, professional, service, category/link, FAQ and policy editors remain the only content entry points. No RAG administration page or second content form is introduced.
- The public company service-name list is informational and only applies to canonical services businesses. Products keep historical JSON without publishing those names. Names do not create priced or scheduled offers.
- Writes and their public work/invalidation commit together under the existing merchant row lock. This precedes professional and source-row locks. Embeddings, graph requests and in-memory event subscribers never hold the canonical write transaction.
- Private profile details, appointment data, availability exceptions/reasons, live slots, stock and prices do not become source text. A resource version or merchant timestamp changing without a public hash/publication change does not create a public revision.
- Existing T13/T96 UUID/company-only signals retain their contracts. Reconciliation explicitly normalizes the canonical six-source projection; it never compares a legacy UUID to the public-v1 sequence or equates the two fingerprint formats.
- Existing three settings routes keep their one legacy company signal per actual company edit. Do not add a second canonical company job in those same writers: the unchanged T64 native test deliberately proves three legacy signals before normalization. New hours/policy jobs apply only when those public fields change. New professional/service writers may use the canonical transaction helper directly.
- ClaimNext deliberately accepts legacy pending work, as proven by T64. A future index worker must recognize and normalize that identity before any embedding/graph submission, and must never treat the legacy leased hash/version as canonical provenance. Do not silently filter legacy claims or weaken the existing regression.
- Local implementation only. Queue completion, graph indexing, model responses, browser fixtures, real Meta delivery and production publication remain different proofs.

## Actual writer inventory

| Source | Existing writer | Integration requirement |
| --- | --- | --- |
| Company and hours | PrismaMerchantRepository.updateStoreSettings; store-settings UpdateStoreSettingsUseCase; public-api settings use case | Keep three routes, nested merge, mode guard and the existing company signal; enqueue changed hours/public policies in the same transaction, then normalize company explicitly. |
| Company name/category | Existing merchant category/profile writers | Canonical stored identity contributes to company projection; do not use owner email/phone as public contact fallback. |
| Mode/publication | ChangeBusinessModeUseCase | Withdraw affected new service/professional sources on products, retain history; no active commercial mode guard is weakened. |
| Professional and offer links | PrismaServiceProfessionalRepository.create/update/deactivate | Queue professional and affected old/new linked service identities in that same transaction; public link/name changes must not leave stale service evidence. |
| Professional timezone | SaveProfessionalAvailabilityUseCase.execute | Timezone is a public profile field; grid, validity, reasons and live occupancy remain operational. Final T25 source mapping is still pending. |
| Service and variants | PrismaProductRepository.create/update/softDelete/addVariant/updateVariantBySku and actual public API variant writers | Apply only to service sources; preserve existing physical/digital/food stock, price and import contracts. Withdrawal and last-active-variant changes must be durable. |
| Categories | Catalog UpdateCategoryUseCase/DeleteCategoryUseCase | Queue affected service sources when name/publication/link changes; category is not capacity. Use explicit tenant predicates and merchant-before-source locking. |
| FAQ | PrismaSupportSettingsRepository.save/delete | Preserve old and new public item identities, including generated IDs, so removed items become tombstones. Empty lists are real removals. |
| Policy | PrismaPolicyRepository.upsert and settings aliases | Acquire merchant lock before policy/source rows, atomically invalidate affected public policy chunks and create work for the canonical resolved content. |

Two adjacent whole-JSON writers can otherwise overwrite a concurrent company edit: PrismaAuthRepository.setStoreSettings, reached by updateOwnerProfile/UpdateMeUseCase/PUT auth/me with owner_name/owner_phone only; and PrismaMerchantRepository.updateRules with checkoutPolicyLinks only. Their direct inputs cannot set serviceNames. T65 must lock and merge their actual stored JSON, with real controlled races proving that the list and unrelated settings survive. Preserve rules/defaults, owner data privacy and product behavior.

The final inventory found two additional whole-JSON paths: UpdateSeoSettingsUseCase.execute and StoreSettingsController.updateCrossSellConfig. They also read settings before a separate update and can overwrite concurrent public company data. The preparation wraps only those existing read/merge/write blocks in merchant-locked transactions, preserving their validation and results. The same native controlled-race child now exercises all four paths, with exact PostgreSQL blocker proof and resulting settings assertions. No new recommendation or SEO rule is introduced.

## Files and approach

Temporary preparation assignment: C prepares only FAQ and policy writer drafts plus their new rollback coverage in an external folder, after its completed Phase8 preparation. Root retains variant/category/company/settings/mode integration and the canonical companion. No productive files, task gates or completion change before T25. C reports base/draft hashes and exact insertion points; root reviews and merges the drafts. Phase8 remains C's next execution batch after T55.

After returning those drafts, C reviews the root's publication-dirty bulk helper and prepares additional external mode rollback/review-resolution cases. These use the same owned fixture and remain unexecuted until T25. C does not author root productive code or act as the final independent Verifier.

T65 requires graph synchronization/work/source-reader integration, a transaction-bound internal enqueue helper, and the actual writers above. New pure orchestration checks belong in graph-sync.service.spec.ts; actual AppModule/SQL/HTTP coverage belongs in a dedicated source-writer integration runner. The exact T25 writer list and remaining public API/ERP variant delegates must be reconciled before restoring drafts.

Use the existing public projection allowlist and canonical reader for current content. The internal transaction-bound read helper does not authorize public access; external readers keep the tenant guard before every lookup. Queue only public fingerprints, not administrative JSON or raw errors. Polling covers offline/restart gaps and historical missing-source tombstones. New pending work must survive a disabled or unavailable graph; activation remains explicitly tenant scoped.

Preserve existing product/catalog and legacy knowledge synchronization. Public business normalization runs independently of graph readiness so a reader admission failure cannot suppress durable source work. Batches and retries are bounded; shutdown stops new work and drains owned in-flight work before Prisma closes.

T66 owns embeddings, graph submission and publish fencing. The old ZyonGraphDocument version is an epoch timestamp, while public-v1 begins at1. New business-source projection must use a separate versioned namespace/label or an explicitly tested migration. Legacy FAQ collection IDs and new individual FAQ IDs are different contracts.

## Success criteria

- Actual authenticated HTTP writers create current scoped work while the worker/graph is offline; restarting/manual cron normalization finds it without synthetic source-only seeds.
- Edit, publish, unpublish, clear, removal and A-B-A are covered for all six source types; linked professional/category/variant changes update the service projection.
- A queue failure rolls back its source transaction. An unavailable graph does not roll back a committed source. Private-only churn preserves the last public revision and valid chunks.
- Exact PostgreSQL blocker PID proves auth/rules edits wait before reading JSON; both canonical source and unrelated owner/rule settings persist after release. Foreign tenant data and commerce snapshots are unchanged.
- Bounded retry/offline reconciliation and natural application shutdown pass without fragile sleeps or provider traffic. No skips or weakened original assertions.
- Full gate, checked build and atomic commit only after T25 is integrated. T65 does not claim T66 indexing or final RAG acceptance.

## Executed integration progress

- Productive restored files are in .cache/t65-restored-inputs.json. Additional source refinement limits policy enqueue to edited public keys/aliases. Whole-container null/scalar replacement dirties its affected canonical fields; omission preserves them. Two actual HTTP children cover policy fallback A-to-B and complete link withdrawal. Total native preparation39children, still pending execution.
- Existing unit fixtures changed only their database interface: merchant rules now supports the merchant SELECT FOR UPDATE; policy persistence now supports transactional work storage and both scalar/list chunk predicates. All original business assertions remain byte-identical. First selected run112tests/106pass/6missing-fake-interface failures; after repair112/112pass, zero skips. No productive bypass was introduced. The helper then gained the null-container correction from incremental review; final units must be repeated before commit.
- Storefront preparation passed. First attempt refused before build because this ignored launcher's filtered environment omitted its explicit cached-tool LOCALAPPDATA path. The launcher now provides only that local path; build then passed normally. No compiler or test budget changed.
- Fresh API capture/build/record passed:2521 checked compiler sources; source23f2058a50f0b641ed66e5ab4a9c447ef4be4c3b9f267b8a7d147d9bb4430b49, artifact11c067f8e9872d0f5aa2fc8cd2106c30ace7fc8d19287b9d13755047e2615047. Native Full gate is running; no result yet.
- Peer review found a residual legacy FAQ/policy embedding generation race: an old generation can complete after a newer writer commit. T65 claims atomic invalidation at source commit only. T66/T68 must fence or revalidate legacy publication and the separate new namespace; neither queue nor invalidation alone proves fresh retrieval.
- Potential category fanout timeout for large service catalogs is not yet reproduced. An external causal case is being prepared against default5s, with exact source/work/chunk/rollback assertions; do not classify an unexecuted risk as a test result.

## Native failures and bounded batch correction

First native Full:83tests/74pass/9fail/0skip. Unchanged64(12),63(14),96(17) were green. New65 failed its final guard: HTTP quota was exhausted, one new negative fixture reached the earlier tenant403 guard before its intended strict-field400 validator, and unrelated automatic paid product SEO attempted transport. No external request escaped the trap; no weakening or provider/auth override was used.

The40-child writer rerun (41including root) produced37pass/4fail/0skip. Two new whole-container cases hit a fixture audit path mismatch (canonical /merchants/:mid/store-settings versus its concrete HTTP URL); the fixture now supplies that canonical path while preserving the original exact audit assertion. The tenant negative keeps the exact400 validation assertion with its own merchantID and adds a separate exact403/code assertion for the foreign body. A new per-runtime/token helper honors real quota headers before requests and before taking controlled race locks; it does not retry a mutation, reset Redis, change limits or suppress a429 assertion.

The diagnostic-only trap now records at most3 stack traces without URLs, headers, payloads or credentials, retaining its exact evidence counts and mandatory refusal. All18 old construction contracts passed unchanged. A minimal product/FAQ diagnostic completed with0 provider attempts; its policy call was denied403 by the plan, so it does not prove policy indexing. Full writer traces identified GenerateProductSeoUseCase.callLlm through AddProductUseCase.autoGenerateSeo on the Growth fixture. The actual offline-AI scenario now seeds the existing merchant governance policy grants=[] and requires a real denied product_seo decision; transport remains trapped and repositories/auth/providers stay original.

The category case confirmed a productive integration defect: HTTP500 after5182ms,54 attempted work rows, actual TX age5011ms, unchanged default5s and complete source/work/chunk/finance rollback. Logs: .cache/t65-gates/2026-11-15T21-49-54.058Z/writers.log. A500 alone was not the diagnosis: diagnostic sequence and transaction observation established progress and the deadline boundary.

Correction retains canonical hashes/revisions for every identity. The canonical reader loads each source family in sets and applies the same allowlist projection; singleton external reads delegate to it with the original tenant guard. A transaction-bound bulk queue applies the same latest-counter/hash/legacy rules under the merchant lock, loads latest history/legacy presence in one parameterized query, creates batches1000, invalidates only changed identities and consumes only their pending legacy markers. Completed history and unchanged public chunks remain intact. No arbitrary batch threshold, opaque substitute evidence or larger timeout is introduced. The112 selected units passed after this correction. Fresh checked/native reruns are required; the1005 case now also checks exact revision2 and same-public-content replay preservation. This proves only exercised sizes, not constant time for unlimited catalogs.
