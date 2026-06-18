import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CartItem, ChatTurn, CheckoutExperienceSnapshot, CheckoutSession } from "@aacp/shared-types";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository
} from "../../checkout/domain/ports/checkout-session.repository.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../merchant/domain/ports/merchant-repository.port.js";
import { buildExperienceFromSession } from "../../checkout/application/services/checkout-experience.service.js";
import { resolveCrossSellCartItem } from "../../cross-sell/application/services/cross-sell-product-resolver.js";
import { STOREFRONT_CATALOG_PORT, type StorefrontCatalogPort } from "../domain/ports/storefront-catalog.port.js";

@Injectable()
export class AddStorefrontItemUseCase {
  constructor(
    @Inject(STOREFRONT_CATALOG_PORT) private readonly catalog: StorefrontCatalogPort,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository
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
    if (!catalogProduct && !CROSS_SELL_SKUS.has(sku)) {
      throw new NotFoundException("storefront_product_not_found");
    }
    const product = catalogProduct ?? crossSellProductToSuggested(resolveCrossSellCartItem(sku));

    const quantity = Math.max(1, Math.min(Number(input.quantity ?? 1), 99));
    // P2 fix: build a new session via addCatalogItem (immutable — no in-place mutations).
    const next = addCatalogItem(session, product, quantity);
    // Combine cart save + chat turn into a single logical write.
    // saveSession persists the updated cart, then appendChatTurn adds the agent turn.
    // If appendChatTurn fails the cart is already saved; an idempotent retry will
    // re-add the same turn (deduplicated by occurredAt at display time).
    await this.sessions.saveSession(next);

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
        rules
      }),
      agent_turn: agentTurn
    };
  }
}

function addCatalogItem(
  session: CheckoutSession,
  product: { sku: string; name: string; unit_price: number; image_url?: string; product_url?: string; category?: string; variant?: string; description?: string },
  quantity: number
): CheckoutSession {
  // P2 fix: build new item objects — never mutate existing items in the loaded session.
  const existingItems = session.cart.items;
  const existingIndex = existingItems.findIndex((candidate) => candidate.sku === product.sku);
  let updatedItems: CartItem[];
  if (existingIndex >= 0) {
    // Create a new array with a new item object (no in-place mutation of existing).
    updatedItems = existingItems.map((item, i) =>
      i === existingIndex
        ? { ...item, quantity: item.quantity + quantity }
        : item
    );
  } else {
    const newItem: CartItem = {
      sku: product.sku,
      name: product.name,
      price: product.unit_price,
      quantity,
      imageUrl: product.image_url,
      productUrl: product.product_url,
      category: product.category,
      variant: product.variant,
      description: product.description?.slice(0, 100)
    };
    updatedItems = [...existingItems, newItem];
  }

  return {
    ...session,
    cart: {
      ...session.cart,
      items: updatedItems,
      total: roundCartTotal(updatedItems)
    },
    updatedAt: new Date().toISOString()
  };
}

function roundCartTotal(items: CartItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
}

const CROSS_SELL_SKUS = new Set(["NECS-001", "NECS-002", "CART-COE-01"]);

function crossSellProductToSuggested(item: CartItem): {
  sku: string;
  name: string;
  unit_price: number;
  image_url?: string;
  product_url?: string;
  category?: string;
  variant?: string;
  description?: string;
} {
  return {
    sku: item.sku,
    name: item.name,
    unit_price: item.price,
    image_url: item.imageUrl,
    product_url: item.productUrl,
    category: item.category,
    variant: item.variant,
    description: item.description
  };
}
