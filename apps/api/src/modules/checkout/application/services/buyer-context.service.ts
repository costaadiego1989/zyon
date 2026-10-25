import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import {
  INTENT_MEMORY_REPOSITORY,
  BUYER_INTENT_CONSENT_REPOSITORY,
  type IntentMemoryRepositoryPort,
  type BuyerIntentConsentRepositoryPort
} from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import { BuyerIntentMemoryConsentEntity } from "../../../intent-memory/domain/entities/buyer-intent-memory-consent.entity.js";

interface BuyerContextResult {
  agent: Awaited<ReturnType<AgentContextPort["get"]>> | undefined;
  buyerIntent: { primary_intent?: string; urgency?: string; budget_tier?: string; pain_points?: string[] } | undefined;
}

/** Loads agent context and buyer intent memory under LGPD consent compliance. */
@Injectable()
export class BuyerContextService {
  private readonly logger = new Logger(BuyerContextService.name);

  constructor(
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(INTENT_MEMORY_REPOSITORY) private readonly intentMemory?: IntentMemoryRepositoryPort,
    @Optional() @Inject(BUYER_INTENT_CONSENT_REPOSITORY) private readonly intentConsent?: BuyerIntentConsentRepositoryPort
  ) {}

  /**
   * Loads agent context and buyer intent memory (only under active LGPD consent).
   * Returns agent context and intent if available and consented.
   */
  async load(merchantId: string, globalUserId: string): Promise<BuyerContextResult> {
    const agent = await this.agentContext?.get({
      merchantId,
      globalUserId
    });

    let buyerIntent = undefined;
    if (this.intentConsent && this.intentMemory && globalUserId) {
      try {
        const consent = await this.intentConsent.getConsent(merchantId, globalUserId);
        if (consent) {
          const entity = BuyerIntentMemoryConsentEntity.rehydrate(consent);
          if (entity.isActive()) {
            const record = await this.intentMemory.getLatest(merchantId, globalUserId);
            if (record) {
              buyerIntent = {
                primary_intent: record.primary_intent,
                urgency: record.urgency,
                budget_tier: record.budget_tier,
                pain_points: record.pain_points
              };
            }
          }
        }
      } catch (err) {
        this.logger.warn(`intent-memory load failed (non-blocking)`, {
          merchantId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return { agent, buyerIntent };
  }
}
