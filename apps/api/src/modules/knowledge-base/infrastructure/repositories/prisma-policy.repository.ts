import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { MerchantPolicyData, PolicyRepositoryPort } from "../../domain/ports/policy-repository.port.js";

export class PrismaPolicyRepository implements PolicyRepositoryPort {
  private readonly logger = new Logger(PrismaPolicyRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async get(merchantId: string): Promise<MerchantPolicyData | null> {
    try {
      const row = await this.prisma.merchantPolicy.findUnique({
        where: { merchantId },
      });
      if (!row) return null;
      return {
        returns: row.returns,
        shipping: row.shipping,
        warranty: row.warranty,
        payment: row.payment,
        general: row.general,
      };
    } catch (err) {
      this.logger.error(`Failed to get policy: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async upsert(merchantId: string, data: MerchantPolicyData): Promise<MerchantPolicyData> {
    try {
      const row = await this.prisma.merchantPolicy.upsert({
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
          returns: data.returns ?? null,
          shipping: data.shipping ?? null,
          warranty: data.warranty ?? null,
          payment: data.payment ?? null,
          general: data.general ?? null,
        },
      });
      return {
        returns: row.returns,
        shipping: row.shipping,
        warranty: row.warranty,
        payment: row.payment,
        general: row.general,
      };
    } catch (err) {
      this.logger.error(`Failed to upsert policy: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
