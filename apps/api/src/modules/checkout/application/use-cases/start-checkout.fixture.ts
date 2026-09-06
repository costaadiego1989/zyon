import { StartCheckoutUseCase } from "./start-checkout.use-case.js";
import { BuyerResolutionService } from "../services/buyer-resolution.service.js";
import { BuyerContextService } from "../services/buyer-context.service.js";
import { CheckoutBootstrapService } from "../services/checkout-bootstrap.service.js";
import { CartPromoResolutionService } from "../services/cart-promo-resolution.service.js";
import { InterventionRuleTextBuilder } from "../services/intervention-rule-text.builder.js";
import type { CheckoutCustomerService } from "../services/checkout-customer.service.js";
import type { CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import type { CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { CheckoutCrossSellRecommenderPort } from "../../domain/ports/cross-sell-recommender.port.js";
import type { MerchantPlanPort } from "../../domain/ports/merchant-plan.port.js";
import type { CheckoutExperienceConfig } from "../../domain/checkout-experience.config.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import type { IntentMemoryRepositoryPort, BuyerIntentConsentRepositoryPort } from "../../../intent-memory/domain/ports/intent-memory-repository.port.js";
import type { HoldoutGroupService } from "../../../revenue-lift/domain/services/holdout-group.service.js";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import type { CheckoutCartAuthorityService } from "../services/checkout-cart-authority.service.js";

interface FixtureOverrides {
  checkoutSettings?: CheckoutSettingsPort;
  merchantRepository?: MerchantRepository;
  merchantPlan?: MerchantPlanPort;
  crossSell?: CheckoutCrossSellRecommenderPort;
  experienceConfig?: CheckoutExperienceConfig;
  customerService?: CheckoutCustomerService;
  agentContext?: AgentContextPort;
  intentMemory?: IntentMemoryRepositoryPort;
  intentConsent?: BuyerIntentConsentRepositoryPort;
  holdoutGroupService?: HoldoutGroupService;
  promoRepository?: ProductPromotionRepositoryPort;
  cartAuthority?: CheckoutCartAuthorityService;
}

/**
 * Factory for creating StartCheckoutUseCase instances in tests.
 * Handles creation of all collaborator services with sensible defaults.
 */
export function createStartCheckoutUseCase(
  sessions: CheckoutSessionRepository,
  outbox: any,
  overrides?: FixtureOverrides
): StartCheckoutUseCase {
  const buyerResolution = new BuyerResolutionService(sessions as any);
  const buyerContext = new BuyerContextService(
    overrides?.agentContext,
    overrides?.intentMemory,
    overrides?.intentConsent
  );
  const promoResolution = new CartPromoResolutionService(overrides?.promoRepository);
  const bootstrap = new CheckoutBootstrapService(
    sessions,
    outbox,
    overrides?.customerService,
    overrides?.holdoutGroupService,
    undefined,
    undefined,
    promoResolution
  );
  const ruleBuilder = new InterventionRuleTextBuilder();

  return new StartCheckoutUseCase(
    sessions,
    buyerResolution,
    buyerContext,
    bootstrap,
    ruleBuilder,
    overrides?.checkoutSettings,
    overrides?.merchantRepository,
    overrides?.merchantPlan,
    overrides?.crossSell,
    overrides?.experienceConfig,
    overrides?.cartAuthority,
  );
}
