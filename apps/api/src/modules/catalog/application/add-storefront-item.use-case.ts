import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException , Logger, Optional} from "@nestjs/common";
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
import { DEFAULT_PLATFORM_FEE_BRL } from "../../../shared/config/platform-fee.config.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { assertCartStock } from "./services/cart-stock-authority.js";

@Injectable()
export class AddStorefrontItemUseCase {
  private readonly logger = new Logger(AddStorefrontItemUseCase.name);

  constructor(
    @Inject(STOREFRONT_CATALOG_PORT) private readonly catalog: StorefrontCatalogPort,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Inject(CROSS_SELL_RESOLVER_PORT) private readonly crossSell: CrossSellResolverPort,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: DEFAULT_PLATFORM_FEE_BRL },
    @Optional() private readonly recordFunnelEvent?: RecordFunnelEventUseCase,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: Pick<PrismaClient, "productVariant"> & Partial<Pick<PrismaClient, "paymentIntent">>
  ) {}

  async execute(input: {
    merchant_id: string;
    session_id: string;
    sku: string;
    quantity?: number;
    replace_sku?: string;
    replace_variant?: string;
  }): Promise<{ experience: CheckoutExperienceSnapshot; agent_turn: ChatTurn }> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    if (input.replace_sku) {
      if (!this.prisma?.paymentIntent) throw new ConflictException("checkout_replacement_unavailable");
      const payment = await this.prisma.paymentIntent.findFirst({
        where: { merchantId: input.merchant_id, sessionId: input.session_id, status: { notIn: ["failed", "cancelled", "expired"] } },
        select: { id: true },
      });
      if (payment || session.crossStoreItems?.length || session.cart.items.some(item => item.marketplace)) {
        throw new ConflictException("checkout_replacement_unavailable");
      }
    }

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

    const quantity = input.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) throw new BadRequestException("cart_quantity_invalid");
    let source = session;
    if (input.replace_sku) {
      const matches = session.cart.items.filter(item => item.sku === input.replace_sku &&
        (input.replace_variant === undefined || item.variant === input.replace_variant));
      if (matches.length !== 1 || input.replace_sku === sku) throw new BadRequestException("checkout_replacement_item_invalid");
      source = { ...session, cart: { ...session.cart, items: session.cart.items.filter(item => item !== matches[0]) } };
    }
    const next = addOrUpdateCartItem(source, product, quantity);
    if (input.replace_sku) {
      next.shipping = undefined;
      next.shippingOptions = undefined;
      next.cart = { ...next.cart, currentDiscount: 0, commercialNudge: undefined };
    }
    // Validate the entire result before writing: a failed replacement preserves the original cart.
    if (this.prisma) await assertCartStock(this.prisma, input.merchant_id, next.cart.items);
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
      text: input.replace_sku ? `Troquei o item por ${quantity} unidade(s) de ${product.name}. Revise o carrinho e confirme a entrega.`
        : `Adicionei ${product.name} ao seu pedido. Quando quiser, seguimos com o cadastro.`,
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
