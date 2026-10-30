# Internal audited recovery for missing informational consumers

The durable outbox had no dead-event recovery use case. Re-appending an event did not reopen it; the webhook-delivery replay endpoint operates on a different table. This patch adds `RedriveInformationalEventUseCase` and `INFORMATIONAL_EVENT_REDRIVE` to the existing MessagingModule's providers/exports. There is no public endpoint or model tool.

The operator must invoke the use case from the integrated application DI context after initialization, so the real registered handlers are checked. Do not create a synthetic bus or call handlers/direct publish to claim recovery. The only allowed types are `shipping.quote.created` and `shipment.created`, schema1, expected producer and payload, with exactly their existing stable audit consumer registered. Extra/missing/duplicate/wrong consumers fail before any transaction. Actor ID and purpose are mandatory.

The Prisma adapter locks the original tenant/event row and uses a compare-and-set to requeue only dead rows with exactly5 attempts, `outbox_handler_missing`, no lease and no delivery timestamp. It preserves envelope, payload, event ID, correlation, causation, original creation timestamp and all handler execution receipts. Queue reset and immutable operational audit commit in one database transaction. Audit includes prior status/attempts/error/timing, actor/purpose, granted retry budget and canonical envelope fingerprint; it contains no raw payload/address/ZIP. If the audit fails or the CAS loses, the queue reset rolls back.

An event can receive this recovery budget only once. A deterministic audit ID fences duplicate/concurrent calls. Subsequent queued/processing/dead calls return `already_requested`; a delivered event returns `already_delivered` without resetting it. A second failure after the granted budget is exhausted requires a separate reviewed repair; this command never grants an infinite retry loop. A changed original envelope fails against its recorded fingerprint. The ordinary leased dispatcher owns delivery and handler acknowledgements.

Operational input example, to be run only by the release owner after the integrated deployment and registry are verified:

```ts
const recovery = app.get(RedriveInformationalEventUseCase);
await recovery.execute({
  merchantId: "mrc_696a583b-e0b8-4956-aea7-4f15037de32b",
  eventId: "evt_d9f4801d-1afd-49dd-b8e4-2434e0f05403",
  expectedEventType: "shipping.quote.created",
  actorId: "<actual authenticated release operator id>",
  purpose: "Recover original informational quote audit after missing-consumer correction",
});
```

The second authorized original event is shipment `evt_892a9d0f-870f-4935-aaa0-5f60668b4e63`, expected type `shipment.created`, same Athom tenant. Record both results. Observe the same original event IDs reach outbox delivered, their stable handler execution receipts, and the informational audits. Confirm the paid order/payment/stock counts remain unchanged. This recovery does not create a quote/shipment, select freight, buy a label, dispatch a package, issue notifications or replay order/payment/inventory events. Shipment creation is not physical dispatch.

Validation uses the actual Prisma adapter with a serialized rollback-capable transaction double, module provider/export metadata, actual dispatcher, and actual informational consumers. It covers concurrent duplicate calls, audit rollback, CAS loss, tenant/type/schema/producer/payload/state/attempt/lease guards, strict operator input and registry proof, unchanged envelopes and existing handler receipts. These are local contract tests, not a PostgreSQL engine or production execution claim. Full integrated compilation, real DB transaction verification, publication and the two explicitly authorized production recoveries remain release-owner gates. This patch author executed none of them.

Local network-guarded gate: 56/56 tests passed across the recovery, dispatcher, BullMQ relay and informational audit suites. Diff check passed. Independent reviewer was assigned to the buyer-cleanup critical path and did not review this recovery patch; release owner must review before integration/execution.
