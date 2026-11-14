import type { StorefrontReadUiAction, StorefrontSuggestedReadActions } from "@zyon/shared-types";
import { isStorefrontReadUiAction } from "./storefront-read-ui-action";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const boundedText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && value.trim().length > 0;

/** Validate the entire optional group; never repair or convert invalid labels to text commands. */
export function parseSuggestedReadActions(value: unknown): StorefrontSuggestedReadActions | null {
  try {
    if (!record(value) || !keys(value, ["version", "items"]) || value.version !== 1 || !Array.isArray(value.items) || value.items.length > 12) return null;
    const items: StorefrontSuggestedReadActions["items"] = [];
    const seen = new Set<string>();
    for (const candidate of value.items) {
      if (!record(candidate) || !keys(candidate, ["id", "label", "action"])) return null;
      const { id, label, action: selected } = candidate;
      if (!boundedText(id, 191) || !boundedText(label, 500) || seen.has(id) || !isStorefrontReadUiAction(selected)) return null;
      seen.add(id);
      const action: StorefrontReadUiAction = selected.tool === "get_product_details"
        ? { tool: "get_product_details", args: { productId: selected.args.productId } }
        : { tool: "search_products", args: { query: "*", categoryId: selected.args.categoryId, ...(selected.args.cursor === undefined ? {} : { cursor: selected.args.cursor }) } };
      if (!isStorefrontReadUiAction(action)) return null;
      items.push({ id, label, action });
    }
    return { version: 1, items };
  } catch {
    // Non-JSON objects/getters are not a trusted response snapshot either.
    return null;
  }
}
