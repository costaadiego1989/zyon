import { Inject, Injectable, NotFoundException , Logger, Optional} from "@nestjs/common";
import type { CartItem, ChatTurn, CheckoutExperienceSnapshot } from "@zyon/shared-types";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository
} from "../../checkout/domain/ports/checkout-session.repository.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../merchant/domain/ports/merchant-repository.port.js";
import { buildExperienceFromSession } from "../../checkout/application/services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../checkout/domain/checkout-experience.config.js";
import { STOREFRONT_CATALOG_PORT, type StorefrontCatalogPort } from "../domain/ports/storefront-catalog.port.js";
import { CROSS_SELL_RESOLVER_PORT, type CrossSellResolverPort } from "../domain/ports/cross-sell-resolver.port.js";
import { addOrUpdateCartItem } from "../domain/cart-item-updater.js";
import { crossSellCartItemToProduct } from "../domain/catalog.mappers.js";
import { RecordFunnelEventUseCase } from "../../experiments/application/use-cases/record-funnel-event.use-case.js";

@Injectable()
export class AddStorefrontItemUseCase {
  private readonly logger = new Logger(AddStorefrontItemUseCase.name);

  constructor(
    @Inject(STOREFRONT_CATALOG_PORT) private readonly catalog: StorefrontCatalogPort,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Inject(CROSS_SELL_RESOLVER_PORT) private readonly crossSell: CrossSellResolverPort,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 },
    @Optional() private readonly recordFunnelEvent?: RecordFunnelEventUseCase
  ) {}

  async execute(input: {
    merchant_id: string;
    session_id: string;
    sku: string;
    quantity?: number;
  }): Promise<{ experience: CheckoutExperienceSnapshot; agent_turn: ChatTurn }> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const sku = input.sku.trim();
    const catalogProduct = await this.catalog.findBySku(
      input.merchant_id,
      sku,
    );
    if (!catalogProduct && !this.crossSell.isKnownCrossSellSku(sku)) {
      throw new NotFoundException("storefront_product_not_found");
    }
    let product = catalogProduct;
    if (!product) {
      const crossSellItem = this.crossSell.resolveCartItem(sku);
      if (!crossSellItem) {
        throw new NotFoundException("storefront_product_not_found");
      }
      product = crossSellCartItemToProduct(crossSellItem);
    }

    const quantity = Math.max(1, Math.min(Number(input.quantity ?? 1), 99));
    const next = addOrUpdateCartItem(session, product, quantity);
    await this.sessions.saveSession(next);

    if (session.promptVariantId && this.recordFunnelEvent) {
      const timeFromStart = session.createdAt
        ? Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000)
        : undefined;
      await this.recordFunnelEvent.execute({
        merchantId: input.merchant_id,
        sessionId: input.session_id,
        stage: 'cart_item_added',
        metadata: { cartItemsAdded: quantity, timeFromStart },
      }).catch((err) => this.logger.warn(`Funnel event failed: ${err}`));
    }

    const agentTurn: ChatTurn = {
      role: "agent",
      text: `Adicionei ${product.name} ao seu pedido. Quando quiser, seguimos com o cadastro.`,
      occurredAt: new Date().toISOString()
    };
    const updated = await this.sessions.appendChatTurn(input.merchant_id, input.session_id, agentTurn);
    const merchant = await this.merchants.getProfile(input.merchant_id);
    const rules = await this.merchants.getRules(input.merchant_id);

    return {
      experience: buildExperienceFromSession(updated, {
        merchantName: merchant?.name,
        theme: merchant?.theme,
        couponBoxEnabled: rules.couponBoxEnabled,
        rules,
        serviceFee: this.experienceConfig.platformFeeBrl
      }),
      agent_turn: agentTurn
    };
  }
}
