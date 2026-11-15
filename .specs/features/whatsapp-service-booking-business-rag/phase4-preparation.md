# Phase4 Preparation

P owns T26-T32 after the integrated green T16+T25 barrier, confirmed by Root at N1a415411a. P starts from its clean T25 commit423ed1d3c. The frozen M transfer has45 files and manifest SHA2560A05611ACD56B4158C51956B6B78B6289574D08FD11ABA35EFF5D74A03E458F3; all45 hashes were reverified after disk recovery. Preparation feedback from M is not a task gate. Compose one task at a time against the current base and keep later drafts outside the checked fingerprint. No dependencies, schema or production/provider resources are copied.

## T26 Assumptions

Admission is a caller-owned Prisma transaction. Reuse merchant-then-professional locking and getProfessionalAvailability in that transaction. No new root transaction, artificial HTTP route or capacity authority. Existing Product/Variant remain the offer/price/duration authorities. Confirmed appointments alone consume new SQL capacity; pending attempts remain separate. Unknown legacy reservations require explicit classification without guessed professional or timestamp cutoff. Scoped command replay stays available after admissions close.

Capture a fresh internal decision clock after merchant and professional locks, then use that one instant consistently for capacity and admission snapshots/audit/outbox. The default clock reads server time; the controlled clock is an internal test seam rather than client input. Preserve generic historical timestamp precision and exact-minute new selection. An actual PostgreSQL wait with a controlled clock crossing the selected start must reject with zero appointment/audit/outbox effects.

## T26 Files

- apps/api/src/shared/bookings/service-appointment-admission.service.ts and its unit companion
- apps/api/src/shared/bookings/service-legacy-readiness.ts
- apps/api/tests/service-booking.integration.spec.ts
- this preparation note, task/spec/status and task evidence after the green gate

No endpoint/provider is introduced by this transaction function, so no facade/module registration is invented. Later use cases register their own actual production composition.

## T26 Success

Preserve every transferred assertion. Prove real migrated PostgreSQL contention across manual/WhatsApp/storefront requests, different services and different starts; at most one overlapping confirmed appointment, while adjacency and parallel professionals remain possible. Prove scoped replay, canonical price/duration/policy snapshots, explicit financial evidence, stale/foreign refusals, legacy classification and atomic audit/outbox rollback. Add post-lock clock outcome tests and actual lock-wait zero-effect refusal. Full means units plus one official checked API build and the owned DB companion with original compiler/test/transaction deadlines and no skips. Root owns the current heavy slot for T65; only source/preparation and coordinated light units run before it releases.

## Later Contracts

T27 overlays authenticated-owner Redis leases on T23 SQL capacity, honoring current policy TTL and hold-off without leases. T28/T29 preserve physical/digital/food fingerprint bytes and actual checkout/payment paths. A newly registered service uses the complete existing serviceSchedule shape; static slots:[] remains unavailable only in the old helper, while professional booking uses T23. SQL fixture reads are distinct from actual HTTP offer creation.

T30/T31 reuse final T22 saveAvailabilityException in the same transaction, with no duplicated minute validator or nested transaction. New one-offs use exact minutes; existing withdrawal retains its precise history. Operational T32 transitions do not settle finance.

M51's planned shared/whatsapp/whatsapp-automation-context.ts exports admitWhatsAppEffectInTransaction(tx,merchantId). Once committed/integrated, call it in the real transaction before merchant/professional locks; it is a no-op outside trusted WhatsApp context and preserves original origin/epoch/lease. Do not import a nonexistent module or block T26 on this later composition. Record and prepare the call externally until both sources exist. No outer wrapper can fence an independently committing inner writer. Final HUM03 coexistence needs the actual new booking writer in flight, beyond seeded T50 rows.

M51 payment composition also requires the canonical pending intent/creation lease/input and its checkout session to match the original WhatsApp checkout context before PSP start. Preserve the canonical WhatsApp state plus own-context receipt atomically, without recapturing the epoch or trusting a local checkoutSessionId. The prepared T28 returns checkout/summary only; it does not start a PSP. T29/payment and the later T46 dispatcher must compose the actual committed51 seam before dispatch. Do not change business drafts to bypass that pending contract.

All test holders release in finally and all started promises drain naturally. No foreign processes/containers, credentials, messages, charges, remote databases or deployments are touched.

## T26 Replay Feedback

Four original API files were copied with exact manifest hashes before composing current contracts. The new post-lock clock assertions first produced RED10pass/3fail including the root, then GREEN13/13 with no skipped cases. The controlled internal clock replaces the old caller-captured now argument; all original snapshot/refusal/replay assertions remain. The native draft now retains the ten original cases and adds four (15 total including root): independent parallel resources, exact-PID merchant and professional waits crossing the selected start with zero effects, and a positive wait with one shared fresh timestamp in appointment/audit/outbox. Its helper drains both transactions in finally. The old unexecuted packet's15-second transaction override is removed; native admission and holders use Prisma's ordinary default transaction budget. No checked build, native gate, completion or commitT26 has run yet. The45 frozen source files in M remain untouched.

The caller-owned transaction review found that a root PrismaClient structurally satisfies Prisma.TransactionClient in TypeScript, so the old draft could autocommit if called incorrectly. A new unit first failed with RED12pass/2fail including root, then a minimal runtime refusal before writes produced GREEN14/14. The native draft adds the actual root Prisma instance with zero appointment/audit/outbox effects (16 expected total including root). No previously gated assertion is changed. Build/native remain pending the Root65 slot; no T26 completion is claimed from unit feedback.

The native tenant matrix is expanded with actual existing foreign professional, product, variant and canonical link rows rather than only a mismatched merchant path. Every individual identity and the paired foreign offer are refused with zero owner/foreign appointment/audit/outbox writes and unchanged foreign source rows. This brings the pending native expectation to17 including root. It remains unexecuted preparation; units are still14/14 and no new unit rerun is required for this native-only addition.

The paid-evidence review found three additional mismatches in the uncommitted draft: a coherent USD order/payment could back a BRL offer, and paid schedule timezone/duration were not compared to the canonical slot. Four added unit cases (a valid approved control plus each mismatch) first produced RED14pass/4fail including root, then the minimal canonical comparisons passed18/18. The existing native financial case now covers both currencies changing together and incompatible stored timezone/duration, with zero-effect assertions. Native expectation remains17 including root; build/native still pending. This changes neither legacy fulfillment eligibility nor provider state and does not claim PSP/webhook acceptance.

T26 Full passed after merge17192587a incorporated committed N65:18/18 combined units, checked0/2523, actual owned PostgreSQL17/17 and cleanup0. Exact merchant/professional waits crossed the selected start under the controlled internal clock, with zero durable effects; the fresh positive timestamp, root-client refusal, real foreign IDs, parallel resources and paid currency/timezone/duration negatives passed. No assertion or deadline expanded. Heavy slot released to M51. Status/spec/evidence marked before the atomic task commit; T27+ remain unexecuted drafts and the planned51 seam is not imported before its green commit.
