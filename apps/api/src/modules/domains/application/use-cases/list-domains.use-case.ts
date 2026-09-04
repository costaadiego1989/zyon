/**
 * List domains for a merchant.
 */

import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface DomainInfo {
  id: string;
  domain: string;
  verified: boolean;
  cname_target: string;
  verified_at?: Date;
  created_at: Date;
}

@Injectable()
export class ListDomainsUseCase {
  private readonly logger = new Logger(ListDomainsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchant_id: string): Promise<DomainInfo[]> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchant_id },
    });
    if (!merchant) throw new NotFoundException("merchant_not_found");

    const domains = await this.prisma.merchantDomain.findMany({
      where: { merchantId: merchant_id },
      orderBy: { createdAt: "desc" },
    });

    return domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      verified: d.verified,
      cname_target: d.cnameTarget,
      verified_at: d.verifiedAt ?? undefined,
      created_at: d.createdAt,
    }));
  }
}
