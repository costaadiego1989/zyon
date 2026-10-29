import { commitCheckoutMutation } from "../../checkout/application/services/commit-checkout-mutation.js";
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import type { Cart, CartItem, CheckoutSession } from "@zyon/shared-types";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository,
} from "../../checkout/domain/ports/checkout-session.repository.port.js";
import {
  PRODUCT_VARIANT_LOOKUP_PORT,
  type ProductVariantLookupPort,
} from "../../checkout/domain/ports/product-variant-lookup.port.js";
import { UpdateCartUseCase } from "../../checkout/application/use-cases/update-cart.use-case.js";

export interface AcpLineItemInput {
  id: string;
  quantity: number;
}

/**
 * Resolves agent-submitted line items against the merchant catalog.
 *
 * - When every requested SKU already exists on the session cart, delegates
 *   to {@link UpdateCartUseCase} (the platform's existing path).
 * - Otherwise fetches missing SKUs from the catalog, merges with existing
 *   items, recomputes the total, and persists via the session repository.
 */
@Injectable()
export class AcpLineItemsResolver {
  constructor(
    private readonly updateCart: UpdateCartUseCase,
    @Inject(CHECKOUT_SESSION_REPOSITORY)
    private readonly sessions: CheckoutSessionRepository,
    @Optional() @Inject(PRODUCT_VARIANT_LOOKUP_PORT)
    private readonly variantLookup?: ProductVariantLookupPort,
  ) {}

  async resolveAndApply(
    _merchantId: string,
    session: CheckoutSession,
    lineItems: ReadonlyArray<AcpLineItemInput>,
  ): Promise<void> {
    if (!lineItems.length) throw new BadRequestException("acp_line_items_required");
    for (const item of lineItems) {
      if (!item.id?.trim()) throw new BadRequestException("acp_line_item_id_required");
      if (!Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 99) {
        throw new BadRequestException("acp_line_item_quantity_invalid");
      }
      if (session.cart.items.filter(existing => existing.sku === item.id.trim()).length > 1) {
        throw new BadRequestException("acp_line_item_variant_required");
      }
    }
    const existingSkus = new Set(session.cart.items.map((i) => i.sku));
    const allExisting = lineItems.every((li) => existingSkus.has(li.id?.trim() ?? ""));

    if (allExisting) {
      await this.updateCart.execute({
        merchant_id: session.merchantId,
        session_id: session.sessionId,
        items: lineItems.map((li) => ({
          sku: li.id.trim(),
          quantity: li.quantity,
        })),
      });
      return;
    }

    const existingBySku = new Map(session.cart.items.map((i) => [i.sku, { ...i }]));

    for (const item of lineItems) {
      const sku = item.id?.trim();
      if (!sku) throw new BadRequestException("acp_line_item_id_required");

      const quantity = item.quantity;
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new BadRequestException("acp_line_item_quantity_invalid");
      }

      const existing = existingBySku.get(sku);
      if (existing) {
        if (quantity === 0) {
          existingBySku.delete(sku);
        } else {
          existing.quantity = quantity;
        }
      } else if (quantity > 0) {
        if (!this.variantLookup) {
          throw new BadRequestException("acp_catalog_unavailable");
        }
        const variant = await this.variantLookup.findBySku(session.merchantId, sku);
        if (!variant || variant.price == null || !Number.isFinite(variant.price) || variant.price < 0) {
          throw new BadRequestException(`acp_sku_not_found:${sku}`);
        }
        if (variant.currency && variant.currency !== session.cart.currency) throw new BadRequestException("acp_sku_currency_mismatch");
        existingBySku.set(sku, {
          sku,
          name: variant.name ?? sku,
          price: variant.price,
          quantity,
          ...(variant.cost !== undefined && Number.isFinite(variant.cost) && variant.cost >= 0 ? { cost: variant.cost } : {}),
        });
      }
    }

    const mergedItems: CartItem[] = Array.from(existingBySku.values());
    const total = AcpLineItemsResolver.roundCurrency(
      mergedItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    );
    if (!Number.isSafeInteger(Math.round(total * 100))) throw new BadRequestException("acp_cart_total_invalid");

    const nextCart: Cart = {
      ...session.cart,
      items: mergedItems,
      total,
      source: session.cart.source ?? "platform_api",
    };

    await commitCheckoutMutation(this.sessions, { expected: session, next: {
      ...session,
      cart: nextCart,
      updatedAt: new Date().toISOString(),
    } });
  }

  static roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
