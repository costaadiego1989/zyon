import { z } from "zod";
import type { StorefrontSuggestedReadActions } from "@zyon/shared-types";
import { storefrontCatalogReadUiActionSchema } from "./storefront-public-read-ui-action.schemas.js";

const nonblank = (maximum: number) => z.string().min(1).max(maximum).refine(value => value.trim().length > 0);
export const storefrontSuggestedReadActionSchema = z.strictObject({
  id: nonblank(191), label: nonblank(500), action: storefrontCatalogReadUiActionSchema,
});

/** Presentation hints only. The existing authenticated action endpoint remains
 * the authority for origin, tenant, cart, identity, quota and tool execution. */
export const storefrontSuggestedReadActionsSchema: z.ZodType<StorefrontSuggestedReadActions> = z.strictObject({
  version: z.literal(1), items: z.array(storefrontSuggestedReadActionSchema).max(12),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.items.forEach((item, index) => {
    if (ids.has(item.id)) context.addIssue({ code: "custom", path: ["items", index, "id"], message: "duplicate_suggestion_id" });
    ids.add(item.id);
  });
});

