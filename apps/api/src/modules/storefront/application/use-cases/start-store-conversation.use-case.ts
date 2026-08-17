/**
 * Start store conversation use-case.
 *
 * Initializes a new storefront conversation session.
 */

import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../domain/ports/conversation.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface StartStoreConversationInput {
  merchant_id: string;
  initial_message?: string;
}

export interface StartStoreConversationOutput {
  conversation_id: string;
  merchant_id: string;
  created_at: string;
}

@Injectable()
export class StartStoreConversationUseCase {
  private readonly logger = new Logger(StartStoreConversationUseCase.name);

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchant: MerchantRepository,
    @Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort
  ) {}

  async execute(input: StartStoreConversationInput): Promise<StartStoreConversationOutput> {
    const merchant = await this.merchant.getProfile(input.merchant_id);
    if (!merchant) throw new NotFoundException("merchant_not_found");

    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    return {
      conversation_id: conversationId,
      merchant_id: input.merchant_id,
      created_at: new Date().toISOString()
    };
  }
}
