import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import type { PublicBusinessSourceType } from "../domain/public-business-source.js";
import type { PublicBusinessSourcePagePort } from "../application/public-business-reconciler.js";
import { parsePublicSupportFaqItems } from "../../support/public-support-knowledge.module.js";
import { PUBLIC_POLICY_LABELS } from "../../knowledge-base/domain/public-knowledge-content.js";

const types = ["company", "business_hours", "professional", "service", "faq", "policy"];

/** Current and historical public identities, never content or private records.
 * Historical identities remain discoverable so hard deletion becomes a tombstone.
 */
export class PrismaPublicBusinessSourcePages implements PublicBusinessSourcePagePort {
  constructor(private readonly prisma: PrismaClient, private readonly tenant: TenantContextService) {}

  async pageIdentities(merchantId: string, sourceType: PublicBusinessSourceType, cursor?: string, limit = 100) {
    if (this.tenant.get()?.merchantId !== merchantId) throw new Error("public_source_foreign_tenant");
    if (!merchantId.trim() || merchantId.length > 191 || !types.includes(sourceType)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || cursor !== undefined && (!cursor.trim() || cursor.length > 191)) throw new Error("public_source_invalid");
    return this.prisma.$transaction(async tx => {
      let current: Prisma.Sql;
      if (sourceType === "company" || sourceType === "business_hours") {
        current = Prisma.sql`SELECT id FROM merchants WHERE id=${merchantId}`;
      } else if (sourceType === "professional") {
        current = Prisma.sql`SELECT id FROM service_professionals WHERE merchant_id=${merchantId}`;
      } else if (sourceType === "service") {
        current = Prisma.sql`SELECT id FROM products WHERE merchant_id=${merchantId} AND type='service'`;
      } else {
        const ids = sourceType === "policy" ? Object.keys(PUBLIC_POLICY_LABELS) : parsePublicSupportFaqItems(
          (await tx.supportSetting.findUnique({ where: { merchantId }, select: { faqItems: true } }))?.faqItems,
        ).map(item => item.id);
        current = ids.length ? Prisma.sql`SELECT public_ids.id FROM (VALUES ${Prisma.join(ids.map(id => Prisma.sql`(${id}::text)`))}) AS public_ids(id)
          WHERE EXISTS (SELECT 1 FROM merchants WHERE id=${merchantId})`
          : Prisma.sql`SELECT NULL::text AS id WHERE FALSE`;
      }
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT sources.id FROM (
          ${current}
          UNION SELECT source_id AS id FROM public_source_work WHERE merchant_id=${merchantId} AND source_type::text=${sourceType}
          UNION SELECT source_id AS id FROM knowledge_chunks WHERE merchant_id=${merchantId} AND source_type=${sourceType}
            AND NOT (${sourceType}='faq' AND source_id='faq-collection')
        ) sources WHERE sources.id IS NOT NULL AND length(btrim(sources.id)) > 0 AND length(sources.id) <= 191
          AND (${cursor ?? null}::text IS NULL OR sources.id COLLATE "C" > ${cursor ?? null}::text COLLATE "C")
        ORDER BY sources.id COLLATE "C" LIMIT ${limit + 1}`);
      const sourceIds = rows.slice(0, limit).map(row => row.id);
      return { sourceIds, ...(rows.length > limit ? { nextCursor: sourceIds.at(-1)! } : {}) };
    }, { isolationLevel: "RepeatableRead" });
  }
}
