/**
 * Register a custom domain for a merchant.
 */

import { Injectable, Inject, BadRequestException, NotFoundException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { domainOwnershipChallenge } from "../../domain-ownership.js";
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
  txt_name: string;
  txt_value: string;
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
    const domain = typeof input.domain === "string" ? input.domain.trim().toLowerCase().replace(/\.$/, "") : "";
    const labels = domain.split(".");
    if (domain.length > 253 || labels.length < 2 || !/^[a-z]{2,63}$/.test(labels.at(-1) ?? "") ||
        labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new BadRequestException("invalid_domain");
    }

    // Check uniqueness
    const existing = await this.prisma.merchantDomain.findUnique({
      where: { domain },
    });
    if (existing) throw new BadRequestException("domain_already_registered");

    const cnameTarget = process.env.STOREFRONT_CNAME_TARGET?.trim() || "stores.zyon.com";
    const created = await this.prisma.merchantDomain.create({
      data: {
        merchantId: input.merchant_id,
        domain,
        cnameTarget,
        verified: false,
      },
    }).catch(error => {
      if ((error as { code?: string }).code === "P2002") throw new BadRequestException("domain_already_registered");
      throw error;
    });

    return {
      ...domainOwnershipChallenge(created),
      domain_id: created.id,
      domain: created.domain,
      cname_target: cnameTarget,
      instructions: `Add a CNAME record for "${domain}" pointing to "${cnameTarget}", add the TXT ownership record returned with this registration, then call verify.`,
    };
  }
}
