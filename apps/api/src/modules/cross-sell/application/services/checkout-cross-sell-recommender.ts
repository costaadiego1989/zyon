import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { SuggestedProduct, CrossSellConfig } from "@zyon/shared-types";
import { DEFAULT_CROSS_SELL_CONFIG } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { CheckoutCrossSellRecommenderPort } from "../../../checkout/domain/ports/cross-sell-recommender.port.js";
import { ListEligibleCrossSellsUseCase } from "../use-cases/list-eligible-cross-sells.use-case.js";
import { resolveCrossSellProduct } from "./cross-sell-product-resolver.js";

@Injectable()
export class CheckoutCrossSellRecommender implements CheckoutCrossSellRecommenderPort {
  private readonly logger = new Logger(CheckoutCrossSellRecommender.name);

  constructor(
    private readonly listEligible: ListEligibleCrossSellsUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async suggest(input: Parameters<CheckoutCrossSellRecommenderPort["suggest"]>[0]): Promise<SuggestedProduct[]> {
    const config = await this.loadConfig(input.merchant_id);

    if (!config.enabled) return [];

    const touchpoint = (input as any).touchpoint as string | undefined;
    if (touchpoint && !this.isTouchpointActive(config, touchpoint)) return [];

    // Cooldown enforcement: skip if last suggestion for this session is within cooldownSeconds
    if (config.limits.cooldownSeconds > 0) {
      try {
        const lastSuggestion = await this.prisma.crossSellSuggestion.findFirst({
          where: { sessionId: input.session_id, merchantId: input.merchant_id },
          orderBy: { suggestedAt: "desc" },
          select: { suggestedAt: true },
        });
        if (lastSuggestion) {
          const elapsed = Date.now() - lastSuggestion.suggestedAt.getTime();
          if (elapsed < config.limits.cooldownSeconds * 1000) {
            this.logger.debug(`[cross-sell] cooldown active (${Math.round(elapsed / 1000)}s / ${config.limits.cooldownSeconds}s)`);
            return [];
          }
        }
      } catch (err) {
        this.logger.warn("[cross-sell] cooldown check failed, proceeding without", err);
      }
    }

    const suggestions = await this.listEligible.execute({
      merchant_id: input.merchant_id,
      session_id: input.session_id,
      cart: input.cart,
      enabled_strategies: config.strategies,
    });

    const max = config.limits.maxSuggestionsPerSession;
    const limited = suggestions.slice(0, max);

    return limited.flatMap((suggestion) =>
      suggestion.ranked_items.map((sku) => ({
        ...resolveCrossSellProduct(sku, suggestion.id),
        display_mode: config.display.mode
      }))
    );
  }

  private async loadConfig(merchantId: string): Promise<CrossSellConfig> {
    try {
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { storeSettings: true },
      });
      const settings = (merchant?.storeSettings as Record<string, any>) ?? {};
      return { ...DEFAULT_CROSS_SELL_CONFIG, ...settings.crossSell };
    } catch {
      return DEFAULT_CROSS_SELL_CONFIG;
    }
  }

  private isTouchpointActive(config: CrossSellConfig, touchpoint: string): boolean {
    const map: Record<string, keyof CrossSellConfig["touchpoints"]> = {
      browsing: "browsing",
      pre_cart: "pre_cart",
      pre_payment: "pre_payment",
      post_purchase: "post_purchase",
    };
    const key = map[touchpoint];
    if (!key) return true;
    return config.touchpoints[key] !== false;
  }
}
