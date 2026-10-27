import { z } from "zod";
import { STOREFRONT_CONTRACT_FALLBACK } from "./storefront-conversation.schemas.js";

export const storefrontModelOutputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  message: z.string().trim().min(1).max(8000),
});

const generatedSchema = z.toJSONSchema(storefrontModelOutputSchema, { target: "draft-7" });
export const storefrontModelJsonSchema = {
  ...generatedSchema,
  properties: {
    ...generatedSchema.properties,
    schemaVersion: { type: "integer", enum: [1] },
  },
};

export function parseStorefrontModelOutput(result: { content: string; finishReason?: string; refusal?: string }): string | undefined {
  if (result.refusal || (result.finishReason && result.finishReason !== "stop")) return undefined;
  // Bound the wire payload before parsing; do not repair fences or extract fragments.
  if (result.content.length > 64_000) return undefined;
  try {
    const parsed = storefrontModelOutputSchema.safeParse(JSON.parse(result.content));
    return parsed.success ? parsed.data.message : undefined;
  } catch {
    return undefined;
  }
}

export const STOREFRONT_MODEL_FALLBACK = STOREFRONT_CONTRACT_FALLBACK;

