import { z } from "zod";

export const STOREFRONT_COPY_FALLBACK = "Posso ajudar você a escolher?";
export const copyMessageSchema = z.string().trim().min(1).max(500);
export const nudgePublicOutputSchema = z.strictObject({ message: z.string().trim().min(1).max(2000) });
const fallback = z.string().trim().min(1).max(2000);
const style = z.string().max(24000).optional();
const trigger = z.enum(["idle_30_seconds", "exit_intent_detected"]);
const stage = z.enum(["cart", "browsing"]).optional();
const merchantId = z.string().trim().min(1).max(191);

export const variantCopyInputSchema = z.strictObject({
  experimentSystemPrompt: style, instruction: z.string().trim().min(1).max(8000), fallback,
});
export const generateNudgeInputSchema = z.strictObject({ merchant_id: merchantId, trigger, stage, fallback });
export const nudgeCopyInputSchema = z.strictObject({
  merchantId, trigger, stage, fallback, experimentSystemPrompt: style,
  agentTone: z.string().max(4000).optional(), availableOffers: z.array(z.string().trim().min(1).max(500)).max(100),
});
export const variantCopyOutputSchema = z.strictObject({ schemaVersion: z.literal(1), message: copyMessageSchema });
export const nudgeCopyOutputSchema = z.strictObject({
  schemaVersion: z.literal(1), message: copyMessageSchema, offerIndex: z.number().int().min(0).max(99).nullable(),
});

export function copyJsonSchema(schema: typeof variantCopyOutputSchema | typeof nudgeCopyOutputSchema) {
  const generated = z.toJSONSchema(schema, { target: "draft-7" });
  return { ...generated, properties: { ...generated.properties, schemaVersion: { type: "integer", enum: [1] } } };
}

const wireResultSchema = z.object({ content: z.string().max(8000),
  finishReason: z.literal("stop").optional(), refusal: z.string().max(0).optional(),
  toolCalls: z.array(z.never()).max(0).optional(), tool_calls: z.array(z.never()).max(0).optional(),
  function_call: z.never().optional() });
export function parseCopyWireResult(result: unknown): unknown {
  const parsed = wireResultSchema.safeParse(result);
  if (!parsed.success) return undefined;
  try { return JSON.parse(parsed.data.content); } catch { return undefined; }
}

// Offer copy is server-owned. A model selects an index, never rewrites money or conditions.
export function nudgeOfferSuffix(offer: string): string {
  return ` Confira as condições: ${offer}.`;
}

