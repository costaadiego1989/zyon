import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

/** Fixed release contract, not an assertion that any writer/proof passed. */
export const SERVICE_RELEASE_WRITERS = Object.freeze([
  { id: "capacity-admission", contractVersion: 1 as const, emittedPath: "apps/api/dist/shared/bookings/service-appointment-admission.service.js" },
  { id: "manual-admission", contractVersion: 1 as const, emittedPath: "apps/api/dist/modules/operations/application/create-manual-service-appointment.use-case.js" },
  { id: "buyer-confirmation", contractVersion: 1 as const, emittedPath: "apps/api/dist/modules/checkout/application/confirm-service-appointment.use-case.js" },
  { id: "buyer-preparation", contractVersion: 1 as const, emittedPath: "apps/api/dist/modules/checkout/application/service-booking.service.js" },
  { id: "native-whatsapp", contractVersion: 1 as const, emittedPath: "apps/api/dist/modules/whatsapp-channel/application/services/whatsapp-service-booking.service.js" },
  { id: "paid-order-admission", contractVersion: 1 as const, emittedPath: "apps/api/dist/shared/bookings/service-order-appointment.js" },
  { id: "legacy-wrapper", contractVersion: 1 as const, emittedPath: "apps/api/dist/shared/persistence/order-fulfillment.js" },
  { id: "reschedule", contractVersion: 1 as const, emittedPath: "apps/api/dist/modules/operations/application/reschedule-service-appointment.use-case.js" },
  { id: "catalog-mode", contractVersion: 1 as const, emittedPath: "apps/api/dist/shared/persistence/catalog-business-mode.js" },
  { id: "professional-zone", contractVersion: 1 as const, emittedPath: "apps/api/dist/modules/catalog/domain/services/fixed-service-time-zone.js" },
  { id: "checkout-holds", contractVersion: 1 as const, emittedPath: "apps/api/dist/shared/bookings/service-slot-holds.service.js" },
  { id: "sandbox-seed-exclusion", contractVersion: 1 as const, emittedPath: "apps/api/dist/modules/operations/application/order-fulfillment.use-case.js" },
].map(value => Object.freeze(value)));
export const SERVICE_RELEASE_CHECKS = Object.freeze([
  { id: "policy-and-mode", origin: "local_http_sql_redis", files: ["apps/api/tests/service-business-policy-http.integration.spec.mjs", "apps/api/tests/service-business-mode-http.integration.spec.mjs", "apps/api/tests/service-catalog-mode.integration.spec.mjs"] },
  { id: "capacity-and-money", origin: "local_http_sql_redis", files: ["apps/api/tests/service-booking.integration.spec.ts", "apps/api/tests/service-local-confirmation.integration.spec.ts", "apps/api/tests/service-late-payment.integration.spec.ts", "apps/api/tests/service-late-payment-dispatch.integration.spec.ts"] },
  { id: "native-journey", origin: "local_http_sql_redis", files: ["apps/api/tests/service-channel-journey.integration.spec.ts"] },
  { id: "storefront-booking", origin: "local_http_sql_redis", files: ["apps/api/tests/service-buyer-booking-http.integration.spec.ts"] },
  { id: "buyer-coexistence", origin: "served_browser", files: ["apps/dashboard/e2e/service-product-coexistence.spec.ts"] },
  { id: "critical-rag", origin: "local_http_sql_redis", files: ["apps/api/tests/business-rag-evaluation.spec.mjs", "apps/api/tests/business-rag-canonical-live-observer.spec.mjs", "apps/api/tests/business-rag-evaluation.truth.spec.mjs", "apps/api/tests/business-rag-evaluation.integration.spec.mjs"] },
  { id: "activation-and-migration", origin: "local_http_sql_redis", files: ["apps/api/src/modules/merchant/application/service-activation-readiness.service.spec.ts", "apps/api/tests/service-activation-readiness.integration.spec.ts", "apps/api/tests/service-migration.integration.spec.mjs", "apps/api/tests/service-appointment-backfill.integration.spec.mjs"] },
].map(value => Object.freeze({ ...value, files: Object.freeze(value.files) })));
export const SERVICE_RELEASE_CRITICAL_CASE_IDS = Object.freeze(["clinic", "salon", "consulting"].flatMap(business =>
  ["company_hours", "professional_service", "price_and_availability", "missing_source", "contradictory_sources", "source_injection", "individual_decision"].map(id => business + "-" + id)));
const digest = z.string().regex(/^[a-f0-9]{64}$/), revision = z.string().regex(/^[a-f0-9]{40}$/), id = z.string().min(1).max(191);
const writer = z.strictObject({ id, contractVersion: z.literal(1), emittedPath: z.string().min(1).max(400), emittedSha256: digest });
const migration = z.strictObject({ migrationId: id, checksum: digest });
const proof = z.strictObject({ id, files: z.array(z.string().min(1).max(400)).min(1).max(100), sourceRevision: revision, apiPayloadSha256: digest,
  rawEvidenceSha256: digest, executed: z.number().int().positive(), passed: z.number().int().positive(), failed: z.literal(0), skipped: z.literal(0), exitCode: z.literal(0),
  origin: z.enum(["component", "local_http_sql_redis", "served_browser", "provider"]) });
export const serviceActivationReleaseSchema = z.strictObject({ schemaVersion: z.literal(1), feature: z.literal("whatsapp-service-booking-business-rag"), contractVersion: z.literal(1),
  sourceRevision: revision, sourceInputSha256: digest, apiPayloadSha256: digest, criterionInventorySha256: digest,
  frontendArtifacts: z.array(z.strictObject({ id: z.enum(["storefront", "widget", "dashboard"]), sourceRevision: revision, artifactSha256: digest })).length(3),
  managedSchema: z.array(migration).min(1).max(2000), writers: z.array(writer).length(SERVICE_RELEASE_WRITERS.length), proofs: z.array(proof).length(SERVICE_RELEASE_CHECKS.length),
  ragEvaluation: z.strictObject({ sourceRevision: revision, datasetSha256: digest, contractSha256: digest, rawEvidenceSha256: digest,
    businesses: z.array(z.enum(["clinic", "salon", "consulting"])).length(3), criticalCaseIds: z.array(id).length(SERVICE_RELEASE_CRITICAL_CASE_IDS.length),
    passedCriticalCaseIds: z.array(id).length(SERVICE_RELEASE_CRITICAL_CASE_IDS.length), executed: z.number().int().positive(), invalidObservations: z.literal(0), failedCritical: z.literal(0), mode: z.literal("owned_runtime") }),
});
export type ServiceActivationRelease = z.infer<typeof serviceActivationReleaseSchema>;
export interface ServiceReleaseRuntimeFacts {
  sourceRevision: string; sourceInputSha256: string; apiPayloadSha256: string;
  writers: ServiceActivationRelease["writers"]; managedSchema: ServiceActivationRelease["managedSchema"];
}
export type ServiceReleaseBlocker = "release_manifest_missing" | "release_manifest_invalid" | "release_revision_mismatch" | "release_payload_changed"
  | "writer_evidence_incomplete" | "critical_proof_incomplete" | "migration_incompatible";
export type ServiceReleaseResult = Readonly<{ kind: "verified"; manifest: Readonly<ServiceActivationRelease> }>
  | Readonly<{ kind: "unavailable"; blocker: ServiceReleaseBlocker }>;
const unavailable = (blocker: ServiceReleaseBlocker): ServiceReleaseResult => Object.freeze({ kind: "unavailable", blocker });
const sameSet = (actual: readonly string[], expected: readonly string[]) => actual.length === expected.length && new Set(actual).size === actual.length
  && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
function freeze(value: object): void { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); Object.freeze(value); }

/** Pure verifier shared by production and private owned-fixture datasources.
 * Only the sealed artifact producer establishes truth of the proof outputs;
 * accepting matching unit fixture data does not certify an actual release. */
export function verifyServiceReleaseManifest(value: unknown, runtime: ServiceReleaseRuntimeFacts): ServiceReleaseResult {
  if (value === undefined || value === null) return unavailable("release_manifest_missing");
  const parsed = serviceActivationReleaseSchema.safeParse(value); if (!parsed.success) return unavailable("release_manifest_invalid");
  const data = parsed.data;
  if (!revision.safeParse(runtime.sourceRevision).success || data.sourceRevision !== runtime.sourceRevision
    || data.frontendArtifacts.some(frontend => frontend.sourceRevision !== runtime.sourceRevision)) return unavailable("release_revision_mismatch");
  if (!sameSet(data.frontendArtifacts.map(value => value.id), ["storefront", "widget", "dashboard"])) return unavailable("release_manifest_invalid");
  if (!digest.safeParse(runtime.sourceInputSha256).success || !digest.safeParse(runtime.apiPayloadSha256).success
    || data.sourceInputSha256 !== runtime.sourceInputSha256 || data.apiPayloadSha256 !== runtime.apiPayloadSha256) return unavailable("release_payload_changed");
  if (!sameSet(data.writers.map(value => value.id), SERVICE_RELEASE_WRITERS.map(value => value.id))
    || !sameSet(runtime.writers.map(value => value.id), SERVICE_RELEASE_WRITERS.map(value => value.id))) return unavailable("writer_evidence_incomplete");
  for (const expected of SERVICE_RELEASE_WRITERS) {
    const actual = data.writers.find(value => value.id === expected.id), own = runtime.writers.find(value => value.id === expected.id);
    if (!actual || !own || actual.contractVersion !== expected.contractVersion || actual.emittedPath !== expected.emittedPath
      || own.contractVersion !== expected.contractVersion || own.emittedPath !== expected.emittedPath || actual.emittedSha256 !== own.emittedSha256)
      return unavailable("writer_evidence_incomplete");
  }
  if (!sameSet(data.managedSchema.map(value => value.migrationId), runtime.managedSchema.map(value => value.migrationId))
    || data.managedSchema.some(actual => runtime.managedSchema.find(value => value.migrationId === actual.migrationId)?.checksum !== actual.checksum)) return unavailable("migration_incompatible");
  if (!sameSet(data.proofs.map(value => value.id), SERVICE_RELEASE_CHECKS.map(value => value.id))) return unavailable("critical_proof_incomplete");
  for (const required of SERVICE_RELEASE_CHECKS) {
    const actual = data.proofs.find(value => value.id === required.id)!;
    if (!isDeepStrictEqual([...actual.files].sort(), [...required.files].sort()) || new Set(actual.files).size !== actual.files.length
      || actual.sourceRevision !== data.sourceRevision || actual.apiPayloadSha256 !== data.apiPayloadSha256 || actual.origin !== required.origin
      || actual.executed !== actual.passed) return unavailable("critical_proof_incomplete");
  }
  const rag = data.ragEvaluation;
  if (rag.sourceRevision !== data.sourceRevision || !sameSet(rag.businesses, ["clinic", "salon", "consulting"])
    || !sameSet(rag.criticalCaseIds, SERVICE_RELEASE_CRITICAL_CASE_IDS) || !sameSet(rag.passedCriticalCaseIds, SERVICE_RELEASE_CRITICAL_CASE_IDS)
    || rag.executed < SERVICE_RELEASE_CRITICAL_CASE_IDS.length) return unavailable("critical_proof_incomplete");
  freeze(data); return Object.freeze({ kind: "verified", manifest: data });
}
