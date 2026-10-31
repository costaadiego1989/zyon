import { z } from "zod";

export const storefrontIntentSchema = z.enum(["PRODUCT_SEARCH", "ADD_CART", "COMPARE_PRODUCTS", "NEGOTIATE_PRICE",
  "RECOMMEND_PERSONALIZED", "ORDER_STATUS", "RETURN_REQUEST", "GREETING", "COMPLEX_QUESTION"]);
export type StoreAgentIntent = z.infer<typeof storefrontIntentSchema>;
export const storefrontConversationDomainSchema = z.enum(["STORE_COMMERCE", "STORE_SUPPORT", "OUT_OF_SCOPE", "UNCLEAR"]);
export type StorefrontConversationDomain = z.infer<typeof storefrontConversationDomainSchema>;
export const storefrontIntentInputSchema = z.strictObject({
  userMessage: z.string().trim().min(1).max(4000),
  history: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(10),
});
const storefrontIntentOutputShape = z.strictObject({
  schemaVersion: z.literal(2), domain: storefrontConversationDomainSchema,
  intent: storefrontIntentSchema, confidence: z.number().min(0).max(1),
  requiresTool: z.boolean(), needsProductDiscovery: z.boolean(),
  // Optional for stored/older V2 classifications. New classifiers explicitly
  // distinguish a sales interview from a catalog read before planning search.
  // This is not a tool permit and contains no search arguments or IDs.
  shoppingPhase: z.enum(["clarify", "search"]).nullable().optional(),
});
export type StorefrontSemanticIntent = z.infer<typeof storefrontIntentOutputShape>;
export const storefrontIntentOutputSchema = storefrontIntentOutputShape.refine(isConsistentStorefrontIntent);
const generated = z.toJSONSchema(storefrontIntentOutputSchema, { target: "draft-7" });
export const storefrontIntentJsonSchema = {
  ...generated,
  // Strict structured-output providers require every field, with null for a
  // non-shopping turn. Runtime parsing still accepts historical V2 envelopes.
  required: [...new Set([...(generated.required ?? []), "shoppingPhase"])],
  properties: { ...generated.properties,
    schemaVersion: { type: "integer", enum: [2] } },
};
export const storefrontIntentUsageSchema = z.object({
  promptTokens: z.number().int().min(0).max(100_000_000), completionTokens: z.number().int().min(0).max(100_000_000),
  totalTokens: z.number().int().min(0).max(200_000_000),
});
export function isConsistentStorefrontIntent(value: StorefrontSemanticIntent): boolean {
  if (value.shoppingPhase != null && (value.domain !== "STORE_COMMERCE" || !value.needsProductDiscovery
    || !value.requiresTool || (value.intent !== "PRODUCT_SEARCH" && value.intent !== "RECOMMEND_PERSONALIZED"))) return false;
  if ((value.domain === "OUT_OF_SCOPE" || value.domain === "UNCLEAR")
    && (value.intent !== "COMPLEX_QUESTION" || value.requiresTool || value.needsProductDiscovery)) return false;
  if (value.intent === "GREETING" && (value.requiresTool || value.needsProductDiscovery)) return false;
  if (value.needsProductDiscovery && (!value.requiresTool
    || (value.intent !== "PRODUCT_SEARCH" && value.intent !== "RECOMMEND_PERSONALIZED"))) return false;
  return true;
}

