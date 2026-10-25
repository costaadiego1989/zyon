import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { MerchantPolicyData, PolicyRepositoryPort } from "../../domain/ports/policy-repository.port.js";
import { resolveStorePolicies } from "../../../../shared/legal/store-policies.js";

export class PrismaPolicyRepository implements PolicyRepositoryPort {
  private readonly logger = new Logger(PrismaPolicyRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async get(merchantId: string): Promise<MerchantPolicyData | null> {
    try {
      const [row, merchant] = await Promise.all([
        this.prisma.merchantPolicy.findUnique({ where: { merchantId } }),
        this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true } }),
      ]);
      const policies = resolveStorePolicies(merchant?.storeSettings, row);
      if (!row && !Object.keys(policies).length) return null;
      return {
        returns: policies.returns ?? null,
        shipping: policies.shipping ?? null,
        warranty: policies.warranty ?? null,
        payment: policies.payment ?? null,
        general: policies.general ?? null,
      };
    } catch (err) {
      this.logger.error(`Failed to get policy: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async upsert(merchantId: string, data: MerchantPolicyData): Promise<MerchantPolicyData> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Both editors update the same commercial fields atomically.
        const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true } });
        const settings = (merchant?.storeSettings as Record<string, unknown>) ?? {};
        const shared = Object.fromEntries(["returns", "shipping"].filter(field => Object.hasOwn(data, field)).map(field => [field, data[field as keyof MerchantPolicyData] ?? ""]));
        if (Object.keys(shared).length) await tx.merchant.update({
          where: { id: merchantId }, data: { storeSettings: { ...settings, policies: { ...((settings.policies as object) ?? {}), ...shared } } },
        });
        await tx.knowledgeChunk.deleteMany({ where: { merchantId, sourceType: "policy", sourceId: { in: Object.keys(data) } } });
        const saved = await tx.merchantPolicy.upsert({
        where: { merchantId },
        create: {
          merchantId,
          returns: data.returns ?? null,
          shipping: data.shipping ?? null,
          warranty: data.warranty ?? null,
          payment: data.payment ?? null,
          general: data.general ?? null,
        },
        update: {
          ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
        },
        });
        return resolveStorePolicies({ ...settings, policies: { ...((settings.policies as object) ?? {}), ...shared } }, saved);
      });
      return {
        returns: row.returns ?? null,
        shipping: row.shipping ?? null,
        warranty: row.warranty ?? null,
        payment: row.payment ?? null,
        general: row.general ?? null,
      };
    } catch (err) {
      this.logger.error(`Failed to upsert policy: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
