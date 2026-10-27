import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { AgentContext } from "@zyon/shared-types";
import { GetAgentContextUseCase } from "../../../agent-rules/application/agent-rules.use-cases.js";
import { GetBuyerPurchaseContextUseCase } from "../../../buyer-purchase-history/application/buyer-purchase-history.use-cases.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import {
  INTENT_MEMORY_REPOSITORY,
  BUYER_INTENT_CONSENT_REPOSITORY,
  type IntentMemoryRepositoryPort,
  type BuyerIntentConsentRepositoryPort
} from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import { BuyerIntentMemoryConsentEntity } from "../../../intent-memory/domain/entities/buyer-intent-memory-consent.entity.js";

@Injectable()
export class AgentRulesContextAdapter implements AgentContextPort {
  constructor(
    private readonly getAgentContext: GetAgentContextUseCase,
    @Optional() private readonly getBuyerPurchaseContext?: GetBuyerPurchaseContextUseCase,
    @Optional() @Inject(INTENT_MEMORY_REPOSITORY) private readonly intentMemory?: IntentMemoryRepositoryPort,
    @Optional() @Inject(BUYER_INTENT_CONSENT_REPOSITORY) private readonly intentConsent?: BuyerIntentConsentRepositoryPort
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
      const withHistory = await this.withPurchaseHistory(context, input);
      return this.withIntent(withHistory, input);
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

  /**
   * Injects buyer intent into agentContext when consent is active.
   * conversation-engine system prompt includes this: "Buyer intent: price_sensitive, urgency: high"
   */
  private async withIntent(
    context: AgentContext,
    input: { merchantId: string; globalUserId?: string }
  ): Promise<AgentContext> {
    if (!this.intentConsent || !this.intentMemory || !input.globalUserId) {
      return context;
    }

    try {
      const consent = await this.intentConsent.getConsent(input.merchantId, input.globalUserId);
      if (!consent) return context;

      const entity = BuyerIntentMemoryConsentEntity.rehydrate(consent);
      if (!entity.isActive()) return context;

      const record = await this.intentMemory.getLatest(input.merchantId, input.globalUserId);
      if (!record) return context;

      return {
        ...context,
        intent: {
          primary_intent: record.primary_intent,
          urgency: record.urgency,
          budget_tier: record.budget_tier,
          pain_points: record.pain_points
        },
        copy_constraints: [
          ...context.copy_constraints,
          "Use buyer intent only to adapt tone and focus; never reveal that you know their prior intentions explicitly."
        ]
      };
    } catch {
      // Non-blocking: if intent loading fails, context proceeds without it
      return context;
    }
  }
}
