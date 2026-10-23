import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { MerchantAgentRuleProjection, MerchantAgentRuleReaderPort } from "../domain/ports/merchant-agent-rule-reader.port.js";
import { findMerchantAgentRule } from "./find-merchant-agent-rule.js";

@Injectable()
export class PrismaMerchantAgentRuleReader implements MerchantAgentRuleReaderPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findForMerchant(merchantId: string): Promise<MerchantAgentRuleProjection | null> {
    const rule = await findMerchantAgentRule(this.prisma, merchantId);
    return rule ? { identity: rule.identity, checkoutSettings: rule.checkoutSettings } : null;
  }
}

