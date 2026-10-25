import type { FoodOptionGroupDraft } from "../hooks/useProductForm.js";

export function foodSelectionLimits(group: FoodOptionGroupDraft) {
  return { min: group.minSelections ?? (group.required ? 1 : 0),
    max: group.maxSelections ?? (group.selectionType === "single" ? 1 : group.items.length) };
}

export function foodOptionsError(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 5) return "Use até cinco categorias de opções.";
  const groupIds = new Set<string>(), itemIds = new Set<string>();
  for (const group of raw as FoodOptionGroupDraft[]) {
    if (!group || typeof group.name !== "string" || !group.name.trim() || group.name.trim().length > 200
      || typeof group.id !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(group.id) || groupIds.has(group.id)
      || !["single", "multiple"].includes(group.selectionType) || typeof group.required !== "boolean"
      || !Array.isArray(group.items) || !group.items.length || group.items.length > 50) return "Confira os nomes, identificadores e itens das categorias de opções.";
    groupIds.add(group.id);
    const { min, max } = foodSelectionLimits(group);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < 1 || min > max || max > group.items.length
      || (group.required && min < 1) || (group.selectionType === "single" && max !== 1)) return `Revise os limites de ${group.name}: mínimo e máximo devem caber na quantidade de itens.`;
    for (const item of group.items) {
      if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 200
        || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(item.id) || itemIds.has(item.id)
        || !Number.isSafeInteger(item.priceModifierInCents) || item.priceModifierInCents < 0 || item.priceModifierInCents > 2_147_483_647)
        return `Confira os nomes e acréscimos dos itens em ${group.name}.`;
      itemIds.add(item.id);
    }
  }
  return undefined;
}

export function maximumFoodOptionPrice(groups: FoodOptionGroupDraft[]): number | null {
  if (foodOptionsError(groups)) return null;
  return groups.reduce((total, group) => total + [...group.items].sort((a, b) => b.priceModifierInCents - a.priceModifierInCents)
    .slice(0, foodSelectionLimits(group).max).reduce((sum, item) => sum + item.priceModifierInCents, 0), 0);
}
