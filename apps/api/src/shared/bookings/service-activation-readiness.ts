import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { resolveServiceBusinessPolicy, type ServiceBusinessPolicyInput } from "../../modules/merchant/domain/service-business-policy.js";
import { currentServiceReleaseArtifact, ImmutableServiceReleaseArtifact } from "./service-release-artifact.js";
import type { ServiceReleaseBlocker } from "./service-release-manifest.js";
import { hasUnclassifiedServiceReservations } from "./service-legacy-readiness.js";

export type ServiceActivationBlocker = ServiceReleaseBlocker | "products_mode" | "classification_required" | "policy_not_configured" | "policy_invalid" | "legacy_mapping_required";
export interface ServiceActivationReadiness { ready: boolean; blockers: ServiceActivationBlocker[]; policyVersion: number | null }
/** This is a prospective policy composed by the original locked writer after
 * parsing. A public body cannot supply version/configuredAt or release facts. */
type CandidatePolicy = NonNullable<ServiceBusinessPolicyInput["policy"]>;
export async function serviceActivationReadinessWithin(tx: Prisma.TransactionClient, merchantId: string,
  candidate?: CandidatePolicy, artifact = currentServiceReleaseArtifact()): Promise<ServiceActivationReadiness> {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function") throw new ConflictException("service_activation_transaction_required");
  if (!(artifact instanceof ImmutableServiceReleaseArtifact)) throw new ConflictException("service_activation_release_source_required");
  const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: { businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
  if (!merchant) throw new NotFoundException("merchant_not_found");
  const policy = candidate ?? await tx.serviceBusinessPolicy.findUnique({ where: { merchantId } });
  const business = resolveServiceBusinessPolicy({ ...merchant, hasLegacyServiceData: false, policy });
  const blockers: ServiceActivationBlocker[] = [];
  if (business.businessMode !== "services") blockers.push("products_mode");
  if (business.selectionState === "review_required" || !merchant.businessModeSelectedAt) blockers.push("classification_required");
  if (business.policyStatus !== "configured") blockers.push(business.policyStatus === "invalid" ? "policy_invalid" : "policy_not_configured");
  if (await hasUnclassifiedServiceReservations(tx, merchantId)) blockers.push("legacy_mapping_required");
  const release = artifact.read();
  if (release.kind !== "verified") blockers.push(release.blocker);
  else {
    try {
      const rows = await tx.$queryRaw<Array<{ migration_name: string; checksum: string }>>`SELECT migration_name, checksum FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      if (release.manifest.managedSchema.some(required => !rows.some(row => row.migration_name === required.migrationId && row.checksum === required.checksum))) blockers.push("migration_incompatible");
    } catch { blockers.push("migration_incompatible"); }
  }
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], policyVersion: business.policyVersion };
}
/** New admission only. Caller retains its original merchant lock and writes. */
export async function assertServiceActivationWithin(tx: Prisma.TransactionClient, merchantId: string, candidate?: CandidatePolicy): Promise<void> {
  const result = await serviceActivationReadinessWithin(tx, merchantId, candidate);
  if (!result.ready) throw new ConflictException({ code: "service_activation_not_ready", blockers: result.blockers });
}
