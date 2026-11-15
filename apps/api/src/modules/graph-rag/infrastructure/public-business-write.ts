import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { withdrawnPublicBusinessSource, type PublicBusinessSourceType } from "../domain/public-business-source.js";
import { enqueuePublicSourceProjections } from "../application/public-source-work.service.js";
import { readCanonicalPublicBusinessSourcesWithin } from "./prisma-public-business.sources.js";
import { PUBLIC_POLICY_LABELS } from "../../knowledge-base/domain/public-knowledge-content.js";

export interface PublicBusinessSourceIdentity { sourceType: PublicBusinessSourceType; sourceId: string }

export function publicServiceBusinessPublished(row: {
  businessMode: string; businessModeSelectedAt?: Date | null; businessModeNeedsReview?: boolean;
}) {
  return row.businessMode === "services" && Boolean(row.businessModeSelectedAt) && !row.businessModeNeedsReview;
}

/** Called in the canonical source writer's transaction, after its own auth and
 * merchant row lock and before commit. No provider, embedding or model calls.
 */
export async function enqueueCanonicalPublicBusinessSources(tx: Prisma.TransactionClient,
  merchantId: string, identities: PublicBusinessSourceIdentity[]) {
  const seen = new Set<string>(), unique: PublicBusinessSourceIdentity[] = [];
  for (const { sourceType, sourceId } of identities) {
    const key = JSON.stringify([sourceType, sourceId]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ sourceType, sourceId });
  }
  const current = await readCanonicalPublicBusinessSourcesWithin(tx, merchantId, unique);
  const sources = unique.map(({ sourceType, sourceId }, index) => current[index]
    ?? withdrawnPublicBusinessSource(merchantId, sourceType, sourceId, "missing-source"));
  await enqueuePublicSourceProjections(tx, merchantId, sources);
}

/** Company content keeps the existing UUID signals. Hours and resolved policy
 * aliases use their own canonical identities in the same settings transaction.
 */
export async function enqueueOtherPublicSettingsSources(tx: Prisma.TransactionClient,
  merchantId: string, patch: Record<string, unknown>) {
  const identities: PublicBusinessSourceIdentity[] = [];
  if (patch.businessHours !== undefined) identities.push({ sourceType: "business_hours", sourceId: merchantId });
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const policies = object(patch.policies) ? patch.policies : {}, links = object(patch.checkoutPolicyLinks) ? patch.checkoutPolicyLinks : {};
  // Legacy settings routes permit replacing a whole container. A null/scalar
  // changes fallback resolution just as clearing each of its public fields.
  const replacedPolicies = patch.policies !== undefined && !object(patch.policies);
  const replacedLinks = patch.checkoutPolicyLinks !== undefined && !object(patch.checkoutPolicyLinks);
  const aliases: Record<string, string> = { returns: "refundUrl", shipping: "shippingUrl" };
  for (const sourceId of Object.keys(PUBLIC_POLICY_LABELS)) {
    if (replacedPolicies || policies[sourceId] !== undefined || aliases[sourceId] && (replacedLinks || links[aliases[sourceId]!] !== undefined))
      identities.push({ sourceType: "policy", sourceId });
  }
  await enqueueCanonicalPublicBusinessSources(tx, merchantId, identities);
}

/** Publication transitions invalidate the old corpus immediately. Opaque dirty
 * signals retain every identity until canonical normalization, including an
 * offline services/products/services round trip with the same final hash.
 * They are never embedding or graph provenance. Caller holds the merchant lock.
 */
export async function invalidateServiceBusinessPublicationWithin(tx: Prisma.TransactionClient,
  merchantId: string, transitionId = randomUUID()) {
  const sourceVersion = "publication-dirty-v1:" + transitionId;
  // A transition's markers commit atomically and remain after normalization.
  // Do not invalidate rebuilt chunks when that same transition is replayed.
  const previous = await tx.publicSourceWork.findFirst({ where: { merchantId, sourceVersion,
    sourceType: { in: ["professional", "service"] } }, select: { id: true } });
  if (previous) return;
  const identities = await tx.$queryRaw<Array<{ sourceType: "professional" | "service"; sourceId: string }>>`
    SELECT identities.source_type AS "sourceType", identities.source_id AS "sourceId" FROM (
      SELECT 'professional'::text AS source_type, id AS source_id FROM service_professionals WHERE merchant_id=${merchantId}
      UNION SELECT 'service'::text, id FROM products WHERE merchant_id=${merchantId} AND type='service'
      UNION SELECT source_type::text, source_id FROM public_source_work WHERE merchant_id=${merchantId} AND source_type::text IN ('professional','service')
      UNION SELECT source_type, source_id FROM knowledge_chunks WHERE merchant_id=${merchantId} AND source_type IN ('professional','service')
    ) identities WHERE length(btrim(identities.source_id)) > 0 AND length(identities.source_id) <= 191
    ORDER BY identities.source_type, identities.source_id COLLATE "C"`;
  for (let offset = 0; offset < identities.length; offset += 1000) {
    await tx.publicSourceWork.createMany({ data: identities.slice(offset, offset + 1000).map(identity => ({
      merchantId, ...identity, sourceVersion, publicationState: "withdrawn" as const,
      sourceHash: withdrawnPublicBusinessSource(merchantId, identity.sourceType, identity.sourceId, sourceVersion).sourceHash,
    })), skipDuplicates: true });
  }
  await tx.knowledgeChunk.deleteMany({ where: { merchantId, sourceType: { in: ["professional", "service"] } } });
}
