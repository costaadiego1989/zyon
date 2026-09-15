/**
 * Verify a registered domain via DNS CNAME check.
 */

import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { DnsVerificationService } from "../../infrastructure/dns-verification.service.js";
import { domainOwnershipChallenge } from "../../domain-ownership.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

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
  private readonly logger = new Logger(VerifyDomainUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly dnsService: DnsVerificationService,
  ) {}

  async execute(input: VerifyDomainInput): Promise<VerifyDomainOutput> {
    const record = await this.prisma.merchantDomain.findFirst({
      where: { id: input.domain_id, merchantId: input.merchant_id },
    });
    if (!record) throw new NotFoundException("domain_not_found");

    const cnameVerified = await this.dnsService.verifyCname(
      record.domain,
      record.cnameTarget,
    );

    const challenge = domainOwnershipChallenge(record);
    const ownershipVerified = await this.dnsService.verifyTxt(challenge.txt_name, challenge.txt_value);
    const verified = cnameVerified && ownershipVerified;
    if (verified) {
      const updated = await this.prisma.merchantDomain.update({
        where: { id: record.id },
        data: { verified: true, verifiedAt: new Date(), ownershipVerifiedAt: new Date() },
      });
      return {
        domain: updated.domain,
        verified: true,
        verified_at: updated.verifiedAt ?? undefined,
      };
    }

    // A confirmed mismatch must revoke routing as well as the dashboard badge.
    // Transient resolver failures throw before this point and preserve the last known state.
    await this.prisma.merchantDomain.update({
      where: { id: record.id },
      data: { verified: false, verifiedAt: null, ownershipVerifiedAt: null },
    });
    return { domain: record.domain, verified: false };
  }
}
