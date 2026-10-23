import { z } from "zod";

const reference = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
export const storefrontCartLineSelectorShape = {
  optionItemIds: z.array(reference).max(250).refine(ids => new Set(ids).size === ids.length).optional(),
  serviceSlotId: reference.nullable().optional(),
};
export const storefrontCartLineSelectorSchema = z.strictObject(storefrontCartLineSelectorShape);
export const storefrontCartQuantityUpdateSchema = z.strictObject({
  quantity: z.number().int().min(0).max(99), ...storefrontCartLineSelectorShape,
});
