import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isDigitalContentReady } from "../../../catalog/domain/services/product-type-validation.js";
import { validateFoodMetadata } from "../../../catalog/domain/services/food-options-validation.js";
import { extractOptionGroups, resolveSelectedOptions, FoodOptionValidationError } from "../../domain/food-options.js";
import type { StorefrontCartSelectedOption } from "../../domain/ports/storefront-cart.port.js";
import { resolveSelectedServiceSlot, ServiceSlotError, serviceSlotSnapshotMatches, type SelectedServiceSlot } from "../../../catalog/domain/services/service-schedule.js";

/** Run under the cart writer lock, using the final quantity across option lines.
 * A local cart is not a reservation; checkout still reserves authoritative stock.
 */
export async function assertLocalCartAdmission(tx: Prisma.TransactionClient, merchantId: string, variantId: string, quantity: number, selectedOptions: StorefrontCartSelectedOption[] = [], selectedServiceSlot?: SelectedServiceSlot) {
  const variant = await tx.productVariant.findFirst({
    where: { id: variantId, isActive: true, product: { merchantId, isActive: true, deletedAt: null } },
    select: { product: { select: { type: true, metadata: true } }, stock: { select: { quantity: true, reserved: true } } },
  });
  if (!variant) throw new BadRequestException("product_unavailable");
  const metadata = variant.product.metadata;
  if (validateFoodMetadata(metadata))
    throw new BadRequestException("food_option_configuration_invalid");
  try {
    const { selected } = resolveSelectedOptions(extractOptionGroups(metadata), selectedOptions.map(option => option.itemId));
    if (selected.length !== selectedOptions.length || selected.some(option => !selectedOptions.some(snapshot => snapshot.itemId === option.itemId
      && snapshot.groupId === option.groupId && snapshot.priceModifierInCents === option.priceModifierInCents
      && snapshot.itemName === option.itemName))) throw new BadRequestException("food_option_selection_changed");
  } catch (error) {
    if (error instanceof FoodOptionValidationError) throw new BadRequestException(error.code);
    throw error;
  }
  if (selectedServiceSlot && variant.product.type !== "service") throw new BadRequestException("service_slot_unknown");
  if (variant.product.type === "digital") {
    if (!isDigitalContentReady(variant.product.metadata)) throw new BadRequestException("digital_content_unavailable");
    return;
  }
  if (variant.product.type === "service") {
    try {
      const current = resolveSelectedServiceSlot(metadata, selectedServiceSlot?.slotId);
      if (current && (quantity !== 1 || !selectedServiceSlot || !serviceSlotSnapshotMatches(current, selectedServiceSlot)))
        throw new BadRequestException(quantity !== 1 ? "service_slot_quantity_invalid" : "service_slot_selection_changed");
    } catch (error) {
      if (error instanceof ServiceSlotError) throw new BadRequestException(error.code);
      throw error;
    }
    return;
  }
  const available = Math.max(0, variant.stock.reduce((sum, stock) => sum + stock.quantity - stock.reserved, 0));
  if (quantity > available) throw new BadRequestException("variant_out_of_stock");
}
