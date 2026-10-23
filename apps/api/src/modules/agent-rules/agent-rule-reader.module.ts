import { Module } from "@nestjs/common";
import { MERCHANT_AGENT_RULE_READER } from "./domain/ports/merchant-agent-rule-reader.port.js";
import { PrismaMerchantAgentRuleReader } from "./infrastructure/merchant-agent-rule-reader.adapter.js";

/** Uses the existing global persistence token; no auth/controllers or new pool. */
@Module({
  providers: [
    PrismaMerchantAgentRuleReader,
    { provide: MERCHANT_AGENT_RULE_READER, useExisting: PrismaMerchantAgentRuleReader },
  ],
  exports: [MERCHANT_AGENT_RULE_READER],
})
export class AgentRuleReaderModule {}

