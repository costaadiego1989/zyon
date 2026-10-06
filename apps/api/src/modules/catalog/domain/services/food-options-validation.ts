export interface FoodSelectionGroup {
  required?: boolean;
  selectionType?: string;
  minSelections?: number;
  maxSelections?: number;
  items: readonly unknown[];
}

export function foodSelectionLimits(group: FoodSelectionGroup) {
  return { min: group.minSelections ?? (group.required ? 1 : 0),
    max: group.maxSelections ?? (group.selectionType === "multiple" ? group.items.length : 1) };
}

/** Configuration is checked before publication/admission. Missing price/bounds
 * retain legacy defaults; malformed required choices must not disappear.
 */
export function validateFoodOptionGroups(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 5) return "invalid_food_options";
  const groups = new Set<string>(), items = new Set<string>();
  const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
  const validName = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200;
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid_food_options";
    const group = value as Record<string, unknown>;
    if (!validId(group.id) || groups.has(group.id) || !validName(group.name)
      || (group.selectionType !== undefined && group.selectionType !== "single" && group.selectionType !== "multiple")
      || (group.required !== undefined && typeof group.required !== "boolean")
      || !Array.isArray(group.items) || !group.items.length || group.items.length > 50) return "invalid_food_options";
    groups.add(group.id);
    const { min, max } = foodSelectionLimits(group as unknown as FoodSelectionGroup);
    if ((group.minSelections !== undefined && !Number.isSafeInteger(group.minSelections))
      || (group.maxSelections !== undefined && !Number.isSafeInteger(group.maxSelections))
      || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < 1 || min > max
      || max > group.items.length || (group.required === true && min < 1)
      || (group.selectionType !== "multiple" && max !== 1)) return "invalid_food_options";
    for (const value of group.items) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid_food_options";
      const item = value as Record<string, unknown>;
      const price = item.priceModifierInCents === undefined ? 0 : item.priceModifierInCents;
      if (!validId(item.id) || items.has(item.id) || !validName(item.name)
        || !Number.isSafeInteger(price) || Number(price) < 0 || Number(price) > 2_147_483_647) return "invalid_food_options";
      items.add(item.id);
    }
  }
  return undefined;
}

export function validateFoodMetadata(metadata: unknown): string | undefined {
  if (metadata === null || metadata === undefined) return undefined;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return "invalid_food_options";
  return validateFoodOptionGroups((metadata as Record<string, unknown>).optionGroups);
}
