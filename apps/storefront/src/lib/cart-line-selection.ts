export interface CartLineSelection { optionItemIds?: string[]; serviceSlotId?: string | null }
const invalid = (): never => { throw new Error("cart_line_selection_invalid"); };
const reference = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 191
  && value.trim() === value && !value.includes("\0");
function optionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 250 || !value.every(reference) || new Set(value).size !== value.length) return invalid();
  return [...value].sort();
}
/** Preserve legacy absence; it must never be silently converted into [] and
 * select the wrong line in a cart with options. Labels/prices are not IDs. */
export function readCartLineSelection(value: unknown): CartLineSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  let ids = row.optionItemIds === undefined ? undefined : optionIds(row.optionItemIds);
  if (Array.isArray(row.selectedOptions) && row.selectedOptions.every(option => option && typeof option === "object" && reference(option.itemId))) {
    const selected = optionIds(row.selectedOptions.map(option => option.itemId));
    if (ids && JSON.stringify(ids) !== JSON.stringify(selected)) return invalid();
    ids = selected;
  }
  const slot = row.selectedServiceSlot && typeof row.selectedServiceSlot === "object" ? (row.selectedServiceSlot as Record<string, unknown>).slotId : undefined;
  const slots = [row.serviceSlotId, row.selectedServiceSlotId, slot].filter(item => item !== undefined);
  if (!slots.every(item => item === null || reference(item)) || new Set(slots).size > 1) return invalid();
  const serviceSlotId = slots[0] as string | null | undefined;
  if (ids === undefined && serviceSlotId === undefined) return undefined;
  return { ...(ids === undefined ? {} : { optionItemIds: ids }), ...(serviceSlotId === undefined ? {} : { serviceSlotId }) };
}
export function cartLineKey(item: { variantId: string } & CartLineSelection): string {
  const selection = readCartLineSelection(item);
  return JSON.stringify([item.variantId, selection?.optionItemIds ?? null, selection?.serviceSlotId ?? null]);
}
