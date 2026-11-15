# T65 preparation

T65 depends on the green T25 writers and is not complete. Preparation stays outside the productive fingerprint until that barrier. T63 and T64 are complete; C/T96 is integrated at 5b5c07715 and P/T21 at 10787f3fc.

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

## Files and approach

Temporary preparation assignment: C prepares only FAQ and policy writer drafts plus their new rollback coverage in an external folder, after its completed Phase8 preparation. Root retains variant/category/company/settings/mode integration and the canonical companion. No productive files, task gates or completion change before T25. C reports base/draft hashes and exact insertion points; root reviews and merges the drafts. Phase8 remains C's next execution batch after T55.

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
