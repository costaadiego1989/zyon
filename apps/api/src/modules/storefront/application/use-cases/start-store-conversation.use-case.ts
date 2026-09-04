/**
 * Start store conversation use-case.
 *
 * Initializes a new storefront conversation session.
 */

import { Injectable, Inject, NotFoundException , Logger, Optional} from "@nestjs/common";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../domain/ports/conversation.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

export interface StartStoreConversationInput {
  merchant_id: string;
  initial_message?: string;
}

export interface ExperimentVariant {
  variant_id: string;
  variant_name: string;
  system_prompt: string;
}

export interface StartStoreConversationOutput {
  conversation_id: string;
  merchant_id: string;
  created_at: string;
  experiment?: ExperimentVariant | null;
}

@Injectable()
export class StartStoreConversationUseCase {
  private readonly logger = new Logger(StartStoreConversationUseCase.name);

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchant: MerchantRepository,
    @Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient
  ) {}

  async execute(input: StartStoreConversationInput): Promise<StartStoreConversationOutput> {
    const merchant = await this.merchant.getProfile(input.merchant_id);
    if (!merchant) throw new NotFoundException("merchant_not_found");

    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // Try to assign a variant from running experiment
    let experiment: ExperimentVariant | null = null;
    try {
      if (this.prisma) {
        const running = await this.prisma.promptExperiment.findFirst({
          where: {
            merchantId: input.merchant_id,
            status: "running"
          },
          include: {
            variants: true
          }
        });

        if (running && running.variants.length > 0) {
          // Deterministic assignment by conversationId hash (djb2) — MUST match the
          // formula used in storefront.controller `/events` and checkout
          // send-chat-message.hashSessionId, so the variant whose systemPrompt drives
          // the greeting is the SAME variant that later gets the conversion credited.
          const selected = this.assignVariantByHash(conversationId, running.variants as any[]);
          experiment = {
            variant_id: selected.id,
            variant_name: selected.name,
            system_prompt: selected.systemPrompt
          };
          this.logger.debug(`Assigned variant "${selected.name}" to conversation ${conversationId}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to assign experiment variant: ${error instanceof Error ? error.message : String(error)}`);
      // Non-critical — continue without experiment
    }

    return {
      conversation_id: conversationId,
      merchant_id: input.merchant_id,
      created_at: new Date().toISOString(),
      experiment: experiment || null
    };
  }

  /**
   * Deterministic weighted variant selection by session/conversation hash.
   * djb2 hash — identical to storefront.controller `/events` and
   * send-chat-message.hashSessionId. Same id → same variant, always, so the
   * greeting prompt and the conversion attribution never diverge.
   */
  private assignVariantByHash(
    sessionId: string,
    variants: Array<{ id: string; name: string; systemPrompt: string; weight: number }>,
  ): { id: string; name: string; systemPrompt: string } {
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
      hash |= 0;
    }
    const totalWeight = variants.reduce((sum, v) => sum + (v.weight || 1), 0);
    let target = Math.abs(hash) % totalWeight;
    for (const variant of variants) {
      target -= (variant.weight || 1);
      if (target <= 0) {
        return { id: variant.id, name: variant.name, systemPrompt: variant.systemPrompt };
      }
    }
    const first = variants[0];
    return { id: first.id, name: first.name, systemPrompt: first.systemPrompt };
  }
}
