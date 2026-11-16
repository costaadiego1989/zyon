import type { Prisma, PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { resolveStorePolicies } from "../../../shared/legal/store-policies.js";
import { PUBLIC_POLICY_LABELS } from "../../knowledge-base/domain/public-knowledge-content.js";
import { parsePublicSupportFaqItems } from "../../support/public-support-knowledge.module.js";
import { projectPublicBusinessSource, type PublicBusinessSourceInput, type PublicBusinessSourceProjection,
  type PublicBusinessSourceType } from "../domain/public-business-source.js";

const sourceTypes = ["company", "business_hours", "professional", "service", "faq", "policy"] as const;
const validId = (value: string) => typeof value === "string" && Boolean(value.trim()) && value.length <= 191;
const version = (...dates: Array<Date | null | undefined>) => String(Math.max(0, ...dates.map(date => date?.getTime() ?? 0)));
type SourceBody<T> = T extends PublicBusinessSourceInput ? Omit<T, "merchantId" | "sourceId"> : never;

/** Canonical public snapshots only. Operational data is read by its own tools. */
export class PrismaPublicBusinessSources {
  constructor(private readonly prisma: PrismaClient, private readonly tenant: TenantContextService) {}
  private assertInput(merchantId: string, sourceType: PublicBusinessSourceType, sourceId: string) {
    if (this.tenant.get()?.merchantId !== merchantId) throw new Error("public_source_foreign_tenant");
    if (![merchantId, sourceId].every(validId) || !(sourceTypes as readonly string[]).includes(sourceType))
      throw new Error("public_source_invalid");
  }

  async read(merchantId: string, sourceType: PublicBusinessSourceType, sourceId: string): Promise<PublicBusinessSourceProjection | null> {
    this.assertInput(merchantId, sourceType, sourceId);
    return this.prisma.$transaction(tx => this.readWithin(tx, merchantId, sourceType, sourceId), { isolationLevel: "RepeatableRead" });
  }

  async readManyWithin(tx: Prisma.TransactionClient, merchantId: string,
    identities: Array<{ sourceType: PublicBusinessSourceType; sourceId: string }>): Promise<Array<PublicBusinessSourceProjection | null>> {
    if (this.tenant.get()?.merchantId !== merchantId) throw new Error("public_source_foreign_tenant");
    for (const identity of identities) this.assertInput(merchantId, identity.sourceType, identity.sourceId);
    return readCanonicalPublicBusinessSourcesWithin(tx, merchantId, identities);
  }

  async readWithin(tx: Prisma.TransactionClient, merchantId: string, sourceType: PublicBusinessSourceType, sourceId: string): Promise<PublicBusinessSourceProjection | null> {
    this.assertInput(merchantId, sourceType, sourceId);
    return readCanonicalPublicBusinessSourceWithin(tx, merchantId, sourceType, sourceId);
  }
}

/** Internal transaction-bound read for already-authorized canonical writers.
 * Public callers must use the scoped reader above; this helper grants no access. */
export async function readCanonicalPublicBusinessSourceWithin(tx: Prisma.TransactionClient, merchantId: string,
  sourceType: PublicBusinessSourceType, sourceId: string): Promise<PublicBusinessSourceProjection | null> {
  return (await readCanonicalPublicBusinessSourcesWithin(tx, merchantId, [{ sourceType, sourceId }]))[0] ?? null;
}

/** The same canonical allowlist, loaded in sets for writers with many affected
 * services. Source loading remains inside the caller's source transaction. */
export async function readCanonicalPublicBusinessSourcesWithin(tx: Prisma.TransactionClient, merchantId: string,
  identities: Array<{ sourceType: PublicBusinessSourceType; sourceId: string }>): Promise<Array<PublicBusinessSourceProjection | null>> {
  for (const { sourceType, sourceId } of identities)
    if (![merchantId, sourceId].every(validId) || !(sourceTypes as readonly string[]).includes(sourceType)) throw new Error("public_source_invalid");
  if (!identities.length) return [];
      const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: {
        id: true, name: true, storeCategory: true, storeSettings: true, updatedAt: true,
        businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
      } });
      if (!merchant) return identities.map(() => null);

      const professionalIds = identities.filter(item => item.sourceType === "professional").map(item => item.sourceId);
      const serviceIds = identities.filter(item => item.sourceType === "service").map(item => item.sourceId);
        const professionalRows = professionalIds.length ? await tx.serviceProfessional.findMany({ where: { id: { in: professionalIds }, merchantId }, select: {
          id: true,
          publicName: true, publicProfile: true, timeZone: true, isActive: true, isPublished: true, version: true, updatedAt: true,
        } }) : [];
        const serviceRows = serviceIds.length ? await tx.product.findMany({ where: { id: { in: serviceIds }, merchantId, type: "service" }, select: {
          id: true,
          name: true, description: true, type: true, metadata: true, isActive: true, deletedAt: true, updatedAt: true,
          variants: { select: { isActive: true, updatedAt: true } },
          category: { select: { merchantId: true, id: true, name: true, isActive: true, updatedAt: true } },
          professionalServices: { where: { merchantId }, select: { merchantId: true, professionalId: true, isActive: true, updatedAt: true,
            professional: { select: { merchantId: true, publicName: true, isActive: true, isPublished: true, updatedAt: true } } } },
        } }) : [];

      const professionals = new Map(professionalRows.map(row => [row.id, row]));
      const services = new Map(serviceRows.map(row => [row.id, row]));
      const settings = identities.some(item => item.sourceType === "faq")
        ? await tx.supportSetting.findUnique({ where: { merchantId }, select: { faqItems: true, updatedAt: true } }) : null;
      const policy = identities.some(item => item.sourceType === "policy" && Object.hasOwn(PUBLIC_POLICY_LABELS, item.sourceId))
        ? await tx.merchantPolicy.findUnique({ where: { merchantId } }) : null;
      return identities.map(({ sourceType, sourceId }) => {
      const servicesPublished = merchant.businessMode === "services" && merchant.businessModeSelectedAt !== null && !merchant.businessModeNeedsReview;
      const publicationVersion = `${merchant.businessMode}:${merchant.businessModeSelectedAt?.toISOString() ?? "legacy"}:${merchant.businessModeNeedsReview}:${version(merchant.updatedAt)}`;
      const project = (input: SourceBody<PublicBusinessSourceInput>) => {
        const result = projectPublicBusinessSource(merchantId, { ...input, merchantId, sourceId });
        // An opaque snapshot marker, never a lexicographic queue sequence.
        return { ...result, sourceVersion: `${result.sourceVersion}:${result.sourceHash}` };
      };
      if (sourceType === "company" || sourceType === "business_hours") {
        if (sourceId !== merchantId) return null;
        return project({ sourceType, sourceVersion: version(merchant.updatedAt), publicationState: "published", row: merchant });
      }
      if (sourceType === "professional") {
        const row = professionals.get(sourceId);
        return row ? project({ sourceType, sourceVersion: `${row.version}:${publicationVersion}`, publicationState: servicesPublished ? "published" : "withdrawn", row }) : null;
      }
      if (sourceType === "service") {
        const row = services.get(sourceId);
        if (!row) return null;
        const professionals = row.professionalServices.map(link => {
          if (link.professional.merchantId !== merchantId) throw new Error("public_source_foreign_tenant");
          return { merchantId: link.merchantId, professionalId: link.professionalId, publicName: link.professional.publicName,
            isActive: link.professional.isActive, isPublished: link.professional.isPublished, linkIsActive: link.isActive };
        });
        return project({ sourceType, sourceVersion: `${version(row.updatedAt, row.category?.updatedAt, ...row.variants.map(variant => variant.updatedAt),
          ...row.professionalServices.flatMap(link => [link.updatedAt, link.professional.updatedAt]))}:${publicationVersion}`,
        publicationState: servicesPublished ? "published" : "withdrawn", row: { ...row, isActive: row.isActive && row.variants.some(variant => variant.isActive), professionals } });
      }
      if (sourceType === "faq") {
        const matches = parsePublicSupportFaqItems(settings?.faqItems).filter(item => item.id === sourceId);
        if (matches.length > 1) throw new Error("public_source_ambiguous");
        return matches.length ? project({ sourceType, sourceVersion: version(settings?.updatedAt), publicationState: "published", row: matches[0]! }) : null;
      }
      if (!Object.hasOwn(PUBLIC_POLICY_LABELS, sourceId)) return null;
      const field = sourceId as keyof typeof PUBLIC_POLICY_LABELS;
      const content = resolveStorePolicies(merchant.storeSettings, policy)[field]?.trim() ?? "";
      return project({ sourceType, sourceVersion: version(merchant.updatedAt, policy?.updatedAt), publicationState: content ? "published" : "withdrawn",
        row: { title: PUBLIC_POLICY_LABELS[field], content } });
  });
}
