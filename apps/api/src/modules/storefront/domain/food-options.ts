/**
 * Food option-groups: shared parsing, validation and price computation.
 *
 * Option groups are authored in the dashboard and stored on
 * `product.metadata.optionGroups`. This module is the single source of truth for
 * reading that (untyped JSON) metadata into a validated shape, and for computing
 * the authoritative unit price from a buyer's selection.
 *
 * Invariant: the buyer's client never dictates price. The server re-derives the
 * price modifier from the stored group definition using only the selected item
 * ids — a tampered or stale client price is ignored (deterministic offer-math).
 */

export interface FoodOptionItem {
  id: string;
  name: string;
  priceModifierInCents: number;
}

export interface FoodOptionGroup {
  id: string;
  name: string;
  required: boolean;
  selectionType: "single" | "multiple";
  items: FoodOptionItem[];
}

/** A resolved selection snapshot, stored on the cart line / order line. */
export interface SelectedFoodOption {
  groupId: string;
  groupName: string;
  itemId: string;
  itemName: string;
  priceModifierInCents: number;
}

export class FoodOptionValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "required_group_missing"
      | "unknown_option_item"
      | "single_group_multiple_selected",
  ) {
    super(message);
    this.name = "FoodOptionValidationError";
  }
}

/**
 * Reads and normalizes `metadata.optionGroups` into a validated array. Returns an
 * empty array when the product has no food options. Silently drops malformed
 * groups/items rather than throwing — authoring is the dashboard's concern; here
 * we only surface what is well-formed to buyers.
 */
export function extractOptionGroups(metadata: unknown): FoodOptionGroup[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>).optionGroups;
  if (!Array.isArray(raw)) return [];

  const groups: FoodOptionGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const go = g as Record<string, unknown>;
    const id = typeof go.id === "string" ? go.id : "";
    const name = typeof go.name === "string" ? go.name.trim() : "";
    if (!id || !name) continue;
    const selectionType = go.selectionType === "multiple" ? "multiple" : "single";
    const required = go.required === true;
    const itemsRaw = Array.isArray(go.items) ? go.items : [];
    const items: FoodOptionItem[] = [];
    for (const it of itemsRaw) {
      if (!it || typeof it !== "object") continue;
      const io = it as Record<string, unknown>;
      const itemId = typeof io.id === "string" ? io.id : "";
      const itemName = typeof io.name === "string" ? io.name.trim() : "";
      if (!itemId || !itemName) continue;
      const mod =
        typeof io.priceModifierInCents === "number" && Number.isFinite(io.priceModifierInCents)
          ? Math.max(0, Math.round(io.priceModifierInCents))
          : 0;
      items.push({ id: itemId, name: itemName, priceModifierInCents: mod });
    }
    if (items.length === 0) continue;
    groups.push({ id, name, required, selectionType, items });
  }
  return groups;
}

/**
 * Validates a buyer's selected item ids against the product's stored groups and
 * returns the resolved selection snapshot plus the total price modifier (cents).
 *
 * Throws FoodOptionValidationError when a required group has no selection, an id
 * is unknown, or a single-selection group has more than one item chosen.
 */
export function resolveSelectedOptions(
  groups: FoodOptionGroup[],
  selectedItemIds: string[],
): { selected: SelectedFoodOption[]; priceModifierInCents: number } {
  const idSet = new Set(selectedItemIds);
  const selected: SelectedFoodOption[] = [];
  let priceModifierInCents = 0;

  for (const group of groups) {
    const chosen = group.items.filter((it) => idSet.has(it.id));

    if (group.required && chosen.length === 0) {
      throw new FoodOptionValidationError(
        `required_group_missing:${group.name}`,
        "required_group_missing",
      );
    }
    if (group.selectionType === "single" && chosen.length > 1) {
      throw new FoodOptionValidationError(
        `single_group_multiple_selected:${group.name}`,
        "single_group_multiple_selected",
      );
    }

    for (const item of chosen) {
      selected.push({
        groupId: group.id,
        groupName: group.name,
        itemId: item.id,
        itemName: item.name,
        priceModifierInCents: item.priceModifierInCents,
      });
      priceModifierInCents += item.priceModifierInCents;
    }
  }

  // Any selected id that did not match a known item is a tamper/stale signal.
  const knownIds = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
  for (const id of selectedItemIds) {
    if (!knownIds.has(id)) {
      throw new FoodOptionValidationError(`unknown_option_item:${id}`, "unknown_option_item");
    }
  }

  return { selected, priceModifierInCents };
}

/** Maps validated groups to the storefront block shape (camelCase, cents kept). */
export function toBlockOptionGroups(groups: FoodOptionGroup[]) {
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    required: g.required,
    selectionType: g.selectionType,
    items: g.items.map((i) => ({
      id: i.id,
      name: i.name,
      priceModifierInCents: i.priceModifierInCents,
    })),
  }));
}
