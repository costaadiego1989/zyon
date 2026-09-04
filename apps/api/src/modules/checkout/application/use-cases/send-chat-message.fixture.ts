import { SendChatMessageUseCase } from "./send-chat-message.use-case.js";
import { ChatContextService } from "../services/chat-context.service.js";
import { ChatResponseBuilder } from "../services/chat-response.builder.js";
import { InterventionRuleTextBuilder } from "../services/intervention-rule-text.builder.js";
import type { CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import type { CheckoutCustomerService } from "../services/checkout-customer.service.js";
import type { CheckoutShippingService } from "../services/checkout-shipping.service.js";
import type { CheckoutOfferService } from "../services/checkout-offer.service.js";
import type { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { CheckoutCrossSellRecommenderPort } from "../../domain/ports/cross-sell-recommender.port.js";
import type { ProductSearchPort } from "../../domain/ports/product-search.port.js";
import type { BuyerConversationRepository } from "../../../buyer-account/domain/ports/buyer-conversation.port.js";
import type { CheckoutExperienceConfig } from "../../domain/checkout-experience.config.js";

interface SendChatFixtureOverrides {
  conversation?: ConversationPort;
  customerService?: CheckoutCustomerService;
  shippingService?: CheckoutShippingService;
  offerService?: CheckoutOfferService;
  agentContext?: AgentContextPort;
  merchantRepository?: MerchantRepository;
  crossSellRecommender?: CheckoutCrossSellRecommenderPort;
  productSearch?: ProductSearchPort;
  conversationRepo?: BuyerConversationRepository;
  experienceConfig?: CheckoutExperienceConfig;
  createPaymentIntent?: CreatePaymentIntentUseCase;
}

/**
 * Factory for creating SendChatMessageUseCase instances in tests.
 * Handles creation of all collaborator services (ChatContextService, ChatResponseBuilder,
 * rule builder) and optionally accepts prebuilt collaborator services (customer/shipping/offer).
 */
export function createSendChatUseCase(
  sessions: CheckoutSessionRepository,
  overrides: SendChatFixtureOverrides = {}
): SendChatMessageUseCase {
  const ruleBuilder = new InterventionRuleTextBuilder();
  const chatContextService = new ChatContextService(
    sessions,
    ruleBuilder,
    overrides.agentContext,
    overrides.merchantRepository,
    undefined,
    overrides.productSearch
  );
  const chatResponseBuilder = new ChatResponseBuilder(
    sessions,
    overrides.crossSellRecommender,
    overrides.createPaymentIntent,
    overrides.conversationRepo,
    overrides.experienceConfig
  );

  return new SendChatMessageUseCase(
    sessions,
    overrides.conversation as ConversationPort,
    overrides.customerService as CheckoutCustomerService,
    overrides.shippingService as CheckoutShippingService,
    overrides.offerService as CheckoutOfferService,
    chatContextService,
    chatResponseBuilder,
    overrides.experienceConfig ?? { platformFeeBrl: 1.99 },
    overrides.agentContext,
    overrides.merchantRepository
  );
}
