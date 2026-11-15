# Phase 3 Preparation

Worker: service_professional_agenda. Branch: feat/service-professional-agenda-20261114. Base: ae2cb48e7. Local implementation only. T9 is the integration barrier before any task is marked or committed. T17 depends on T9 under parallel-execution.md.

Future T18–T25 preparatory new files are preserved under .cache/service-phase3-prepared with a SHA256 manifest. They are outside productive source/build fingerprints and will be restored, hash-checked, by their task before each independent gate/commit. No stash, discard or foreign source is involved. T17's first integration gate sees only T17 productive changes.

Current execution: T17 committed as f263e4035. T18 Full gate passed after the real Prisma input correction: unit4/4, native7/7 and checked build0; status is closed before its atomic commit. Next is T19, restoring its4 preserved files with hashes. Parent coordinates heavy slots. Root restored the digital SQL separately as8701e0ddf and proved8/8 there; the earlier P supplemental failure remains recorded honestly and the integrated final Build will incorporate root's recovery.

## T17

Assumptions: Product and ProductVariant remain the canonical offer and price. A products merchant can create physical, digital and food offers. A services merchant can create service offers before configuring booking admissions. A legacy service or mixed merchant requires explicit classification. Disabling/deleting an offer and reading or reconciling historical commerce must remain possible. The merchant row lock already used by catalog writers serializes guard facts with business changes.

T9 incorporated by fast-forward at15e6957d019e8d7c9001da7bc11b7c54fc269f24. Canonical legacy fallback includes serviceReservation even when no current service offer exists. Root confirmed ONB-01 blocks new offers while canonical registration_pending/oauth_registration_pending=true and selectedAt=null. Ordinary legacy products without those markers remain allowed. Withdrawals continue even when an old offer fails today's publication validation; no historical checkout/payment writer is gated by this catalog guard.

Files: catalog infrastructure repositories/prisma-product.repository.ts; catalog application/services/catalog-variant.service.ts; shared/persistence/catalog-business-mode.ts; inventory application/services/erp-sync.service.ts; companion prisma-product.repository.spec.ts; tests/service-catalog-mode.integration.spec.mjs. Minimum fixture updates are allowed only where the guard needs canonical merchant facts; assertions are preserved.

Success: unit branches for both modes and classification; actual AppModule HTTP create/update/publication/variant writers/public API; owned DB direct create/addVariant/SKU reimport/ERP; refused writes preserve state. Preserve physical/digital snapshots and existing financial processing. No dependencies, builds or runtime started before root grants their slots.

Inventory: dashboard and public API create/update/publication delegate to PrismaProductRepository. Replace/edit variants uses CatalogVariantService. Spreadsheet create delegates to AddProductUseCase and duplicate SKU imports to updateVariantBySku. ERP sync has independent physical create and update in applySnapshot. Soft delete and category detachment withdraw or reorganize existing offers; content publication edits presentation without creating an offer. Fulfillment QA fixtures are explicitly synthetic and not a commercial entry point.

First T17 native run failed honestly:10 subcases passed, CSV fixture failed and final provider-attempt invariant failed (12reported/10pass/2fail/0skip). The new CSV fixture used an unsupported deterministic alias weight_grams; changed only that header to existing peso g, preserving success/failure/price assertions. Real product events trigger LocalEmbeddingService's optimistic first model load. Root authorized the local worker only to set Transformers allowRemoteModels=false before AppModule and expose the actual flag in runtime evidence. Provider trap, zero attempts, owned resources and repository/auth implementations stay intact. This proves the actual missing-model fallback, not successful embeddings or RAG. Checked source/build artifacts remain unchanged by tests/*.mjs; assertServiceArtifacts must still pass before rerun.

## T18-T25

Proceed sequentially after T17. ServiceProfessional is the shared capacity resource without login coupling. ProfessionalService links Product(id, merchantId). Recurrence/exceptions use existing schema and a shared professional lock. Availability unions offered intervals and subtracts blocks and confirmed occupancy; category never creates capacity. Every endpoint is registered in CatalogModule in its own commit and receives real AppModule HTTP/DB negative cases.

Shared lock contract agreed with root: export lockServiceProfessional(tx, merchantId, professionalId) from shared/bookings/service-professional-lock.ts. Parameterized Prisma.sql takes FOR UPDATE on id plus merchant_id and rejects a missing row before any write. Do not filter active/published, since reconciliation and cancellation need the same resource after deactivation. New admission validates eligibility separately. Commands acquiring several professionals order IDs stably. T26/T31/rescheduling must reuse this lock.

## T18 Preparation

Assumptions: owner/admin maintain profiles and service links; staff reads are explicit. Profile fields are public description and specialties, no auth account or private contact copy. Edit uses expectedVersion. Deactivation withdraws public eligibility and preserves appointments, service links and snapshots. Product and category remain canonical.

Files: prisma-service-professional.repository.ts and companion unit spec; domain/services/service-professional-input.ts; shared/bookings/service-business-access.ts and service-professional-lock.ts; tests/service-professionals.integration.spec.mjs; minimum CatalogModule provider factory. Success: own DB create/edit/deactivate, foreign/invalid/mode, constraints, concurrent versions, rollback and unchanged appointment history.

## T19 Preparation

Files: presentation/http/service-professionals.controller.ts and companion spec; minimum CatalogModule registration; tests/service-professionals-http.integration.spec.mjs. Success: real authenticated HTTP list/create/edit/deactivate, owner/admin role, staff read only, products/foreign/invalid/stale denied with unchanged DB; public event carries only source identity, version and publication state after persistence.

Plan contract reviewed by root: approved Atendimento is conditioned on services mode, with no newly approved commercial tier. Existing operations orders/customers/payments do not inherit StoreBuilder's RequirePlan; CHECKOUT_ONLY is already treated as BOTH there. The preserved drafts correctly contain auth/ownership/mode/role only. Do not add STORE_ONLY/BOTH by analogy or invent an API-plan exclusion. Preserve applicable existing limits/entitlements and new-sales quotas; no billing rule is changed here. During T19 replay, add real API-plan-positive professional CRUD coverage so accidental inheritance of catalog plan policy cannot stay green.

## T20 Preparation

Files: domain/services/professional-service-link.ts/spec.ts; tests/service-professional-links.integration.spec.mjs; minimal eligibility HTTP route in its own controller and CatalogModule registration. Success: explicit same-tenant active/published professional, active canonical service and variant, positive canonical variant price, active same-tenant category, validated duration from metadata.serviceSchedule. Category is classification and never a capacity resource or price authority.

Replay fixture correction: service-eligibility-http's new draft mixes root Product.merchantId with nested category.create. Use a separate real category create followed by scalar categoryId on the product, consistent with the generated unchecked Product input. Preserve every eligibility assertion. This avoids repeating the T18 checked/unchecked nested-input mismatch; production schema and catalog writers remain unchanged.

## T23 Contract

getProfessionalAvailability(tx, {merchantId,productId,variantId,professionalId,fromDate,toDate,now,expectedVersion?}) in application/get-professional-availability.ts returns ready/empty/stale, professionalVersion, policyVersion (nullable for administrative preview), timeZone, durationMinutes, dates, slots and asOf. Expected version is the professional version, incremented by profile/recurrence/exception changes. Bounded local-date window <=31 inclusive days; DB failures throw instead of becoming empty. Domain resolves professional intervals, never category intervals. T26 can reuse its transaction and clock with locks held.

Existing isServiceOfferAvailable/publicServiceSchedule knows static offer slots only. A service with duration and slots:[] can have real professional capacity. Do not change the legacy global helper. T42/43/46 must select this canonical reader for services businesses, including this fixture, so catalog search does not hide the service. Embeddings never determine capacity.

Root review corrected a preparatory T23 expectation before commit: subtracting occupancy must not re-anchor the offered slot grid. Candidates remain anchored to the union of offered intervals and are filtered against occupancy/blocks. The new draft assertion expecting shifted10:45/11:15 was corrected to11:00/11:30 with root's explicit review instruction; all existing approved/committed tests are preserved. Added AGENDA-04/05 evidence that another service consuming10:00–10:20 preserves the free10:30 slot.

## T21 Preparation

Files: application/save-professional-availability.use-case.ts/spec.ts; domain/services/professional-availability-input.ts; tests/service-recurring-availability.integration.spec.mjs. Success: replace recurring grid with expected professional version, IANA timezone and effective UTC boundaries; bounded valid intervals, one concurrent winner, old rows inactive and appointment snapshots unchanged; public change event contains identity/version only. Merchant lock precedes professional lock.

## T22 Preparation

Files: application/save-availability-exception.use-case.ts/spec.ts; tests/service-availability-exceptions.integration.spec.mjs. Success: same professional lock/version; one_off/block UTC [start,end), timezone explicit and equal to professional; block/one_off conflict with confirmed occupancy rolls back, adjacency succeeds, block withdraws available capacity without cancelling history. SQL overlap check and ordered row lock are reusable by T26.

Replay step for T22/T31 composition: export saveAvailabilityException(tx,actor,professionalId,expectedVersion,input), using the same validation and merchant-before-professional locks inside the caller's transaction, returning professionalId/version/exception. The HTTP class owns its transaction and publishes only after commit. T31 can create its explicitly authorized one_off and admit inside one transaction, using the returned resource version; it must not open a nested transaction or duplicate the command's rules. Phase4 worker has this contract. Add rollback proof for a later failing operation in the same transaction.
