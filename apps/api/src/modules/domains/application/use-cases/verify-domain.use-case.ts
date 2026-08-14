/**
 * Verify a registered domain via DNS CNAME check.
 */

import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { DnsVerificationService } from "../../infrastructure/dns-verification.service.js";

export interface VerifyDomainInput {
  merchant_id: string;
  domain_id: string;
}

export interface VerifyDomainOutput {
  domain: string;
  verified: boolean;
  verified_at?: Date;
}

@Injectable()
export class VerifyDomainUseCase {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly dnsService: DnsVerificationService,
  ) {}

  async execute(input: VerifyDomainInput): Promise<VerifyDomainOutput> {
    const record = await this.prisma.merchantDomain.findFirst({
      where: { id: input.domain_id, merchantId: input.merchant_id },
    });
    if (!record) throw new NotFoundException("domain_not_found");

    const verified = await this.dnsService.verifyCname(
      record.domain,
      record.cnameTarget,
    );

    if (verified) {
      const updated = await this.prisma.merchantDomain.update({
        where: { id: record.id },
        data: { verified: true, verifiedAt: new Date() },
      });
      return {
        domain: updated.domain,
        verified: true,
        verified_at: updated.verifiedAt ?? undefined,
      };
    }

    return { domain: record.domain, verified: false };
  }
}
