import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Cart, CartItem, FulfillmentSchedule } from "@zyon/shared-types";
import { readProfessionalCheckout } from "./read-professional-checkout.js";
import type { ProfessionalCheckoutSelection } from "./service-checkout-selection.js";
import { admitWhatsAppEffectInTransaction } from "../whatsapp/whatsapp-automation-context.js";

export function professionalScheduleSnapshot(selected: ProfessionalCheckoutSelection): FulfillmentSchedule {
  return { slotId: selected.slotId, professionalId: selected.professionalId, professionalVersion: selected.professionalVersion,
    policyVersion: selected.policyVersion, date: selected.date, startsAt: selected.startsAt, endsAt: selected.endsAt,
    timeZone: selected.timeZone, durationMinutes: selected.durationMinutes };
}

/** Reconstruct the quote while its canonical merchant/professional locks remain
 * held. The caller owns the transaction; presentation is never read before it. */
export async function canonicalizeProfessionalServiceCart(
  tx: Prisma.TransactionClient,
  merchantId: string,
  cart: Cart,
  clock: () => Date = () => new Date(),
): Promise<Cart> {
  await admitWhatsAppEffectInTransaction(tx, merchantId);
  if (!cart.items.length || cart.items.some(item => item.productType !== "service" || item.fulfillmentStrategy !== "scheduled_service"))
    throw new BadRequestException("service_checkout_selection_required");
  const { selections } = await readProfessionalCheckout(tx, { merchantId, cart }, clock);
  const variants = await tx.productVariant.findMany({ where: { id: { in: selections.map(item => item.variantId) },
    isActive: true, product: { merchantId, type: "service", isActive: true, deletedAt: null } },
    include: { product: true, price: true, media: { orderBy: { order: "asc" }, take: 1 } } });
  const items: CartItem[] = selections.map((slot, index) => {
    const variant = variants.find(value => value.id === slot.variantId && value.productId === slot.productId);
    if (!variant?.price || variant.sku !== cart.items[index]!.sku || variant.price.basePriceInCents !== slot.priceInCents
      || variant.price.currency !== slot.currency) throw new ConflictException("service_offer_changed");
    return { sku: variant.sku, product_id: variant.productId, variantId: variant.id, name: variant.product.name,
      quantity: 1, price: variant.price.basePriceInCents / 100, productType: "service", fulfillmentStrategy: "scheduled_service",
      fulfillmentSchedule: professionalScheduleSnapshot(slot), ...(variant.media[0]?.url ? { imageUrl: variant.media[0].url } : {}) };
  });
  return { ...cart, items, total: items.reduce((sum, item) => sum + Math.round(item.price * 100), 0) / 100 };
}
