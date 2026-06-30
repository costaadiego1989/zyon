import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { AgentContext } from "@zyon/shared-types";
import { GetAgentContextUseCase } from "../../../agent-rules/application/agent-rules.use-cases.js";
import { GetBuyerPurchaseContextUseCase } from "../../../buyer-purchase-history/application/buyer-purchase-history.use-cases.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";

@Injectable()
export class AgentRulesContextAdapter implements AgentContextPort {
  constructor(
    private readonly getAgentContext: GetAgentContextUseCase,
    @Optional() private readonly getBuyerPurchaseContext?: GetBuyerPurchaseContextUseCase
  ) {}

  async get(input: {
    merchantId: string;
    userId?: string;
    agentId?: string;
    globalUserId?: string;
  }): Promise<AgentContext | undefined> {
    try {
      const context = await this.getAgentContext.execute(
        {
          merchantId: input.merchantId,
          userId: input.userId
        },
        input.agentId
      );
      return this.withPurchaseHistory(context, input);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }

  private async withPurchaseHistory(
    context: AgentContext,
    input: { merchantId: string; globalUserId?: string }
  ): Promise<AgentContext> {
    if (!this.getBuyerPurchaseContext || !input.globalUserId) return context;
    const purchaseContext = await this.getBuyerPurchaseContext.execute({
      merchantId: input.merchantId,
      globalUserId: input.globalUserId
    });
    return {
      ...context,
      purchase_history: purchaseContext.purchase_history,
      copy_constraints: [
        ...context.copy_constraints,
        "Use purchase history only as compact context for tone and relevance; never reveal private purchase details."
      ]
    };
  }
}
