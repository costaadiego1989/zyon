/**
 * Register a custom domain for a merchant.
 */

import { Injectable, Inject, BadRequestException, NotFoundException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface RegisterDomainInput {
  merchant_id: string;
  domain: string;
}

export interface RegisterDomainOutput {
  domain_id: string;
  domain: string;
  cname_target: string;
  instructions: string;
}

@Injectable()
export class RegisterDomainUseCase {
  private readonly logger = new Logger(RegisterDomainUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: RegisterDomainInput): Promise<RegisterDomainOutput> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: input.merchant_id },
    });
    if (!merchant) throw new NotFoundException("merchant_not_found");

    // Normalize domain
    const domain = input.domain.trim().toLowerCase();
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      throw new BadRequestException("invalid_domain");
    }

    // Check uniqueness
    const existing = await this.prisma.merchantDomain.findUnique({
      where: { domain },
    });
    if (existing) throw new BadRequestException("domain_already_registered");

    const cnameTarget = "stores.zyon.com";
    const created = await this.prisma.merchantDomain.create({
      data: {
        merchantId: input.merchant_id,
        domain,
        cnameTarget,
        verified: false,
      },
    });

    return {
      domain_id: created.id,
      domain: created.domain,
      cname_target: cnameTarget,
      instructions: `Add a CNAME record for "${domain}" pointing to "${cnameTarget}", then call verify.`,
    };
  }
}
