import { ConflictException } from "@nestjs/common";
import { validateFoodOptionGroups } from "../../../catalog/domain/services/food-options-validation.js";

/** Until option identities/prices are part of the frozen allocation, a required
 * option must never disappear just because the cart omitted selected_options. */
export function assertMarketplaceProductOptions(metadata: unknown, selectedOptions?: unknown): void {
  if (selectedOptions !== undefined && (!Array.isArray(selectedOptions) || selectedOptions.length)) {
    throw new ConflictException("marketplace_product_options_required");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return;
  const groups = (metadata as Record<string, unknown>).optionGroups;
  if (groups === undefined) return;
  if (!Array.isArray(groups) || validateFoodOptionGroups(groups) || groups.some(group => !group || typeof group !== "object" ||
      typeof group.required !== "boolean" || group.required || Number(group.minSelections ?? 0) > 0)) {
    throw new ConflictException("marketplace_product_options_required");
  }
}
