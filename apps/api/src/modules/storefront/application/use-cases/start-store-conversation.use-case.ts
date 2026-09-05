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
import { randomUUID } from "node:crypto";

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

    const conversationId = `conv_${randomUUID()}`;

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
          const selected = this.weightedRandomVariant(running.variants as any[]);
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

  private weightedRandomVariant(variants: Array<{ id: string; name: string; systemPrompt: string; weight: number }>): { id: string; name: string; systemPrompt: string } {
    const totalWeight = variants.reduce((sum, v) => sum + (v.weight || 1), 0);
    let random = Math.random() * totalWeight;

    for (const variant of variants) {
      random -= (variant.weight || 1);
      if (random <= 0) {
        return { id: variant.id, name: variant.name, systemPrompt: variant.systemPrompt };
      }
    }

    // Fallback to first variant
    const first = variants[0];
    return { id: first.id, name: first.name, systemPrompt: first.systemPrompt };
  }
}
