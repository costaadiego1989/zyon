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
});
export type StorefrontSemanticIntent = z.infer<typeof storefrontIntentOutputShape>;
export const storefrontIntentOutputSchema = storefrontIntentOutputShape.refine(isConsistentStorefrontIntent);
const generated = z.toJSONSchema(storefrontIntentOutputSchema, { target: "draft-7" });
export const storefrontIntentJsonSchema = {
  ...generated,
  properties: { ...generated.properties,
    schemaVersion: { type: "integer", enum: [2] } },
};
export const storefrontIntentUsageSchema = z.object({
  promptTokens: z.number().int().min(0).max(100_000_000), completionTokens: z.number().int().min(0).max(100_000_000),
  totalTokens: z.number().int().min(0).max(200_000_000),
});
export function isConsistentStorefrontIntent(value: StorefrontSemanticIntent): boolean {
  if ((value.domain === "OUT_OF_SCOPE" || value.domain === "UNCLEAR")
    && (value.intent !== "COMPLEX_QUESTION" || value.requiresTool || value.needsProductDiscovery)) return false;
  if (value.intent === "GREETING" && (value.requiresTool || value.needsProductDiscovery)) return false;
  if (value.needsProductDiscovery && (!value.requiresTool
    || (value.intent !== "PRODUCT_SEARCH" && value.intent !== "RECOMMEND_PERSONALIZED"))) return false;
  return true;
}

