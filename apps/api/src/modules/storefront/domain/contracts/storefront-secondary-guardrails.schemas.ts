import { z } from "zod";

export const storefrontCopyReviewInputSchema = z.strictObject({
  candidate: z.string().trim().min(1).max(500),
  task: z.string().trim().min(1).max(8000),
});
export const storefrontCopyReviewOutputSchema = z.strictObject({
  schemaVersion: z.literal(1), verdict: z.enum(["ALLOW", "REJECT", "UNCLEAR"]),
  confidence: z.number().finite().min(0).max(1),
});
export const storefrontCopyReviewJsonSchema = z.toJSONSchema(storefrontCopyReviewOutputSchema, { target: "draft-7" });

export const storefrontReplyReviewInputSchema = z.strictObject({
  candidate: z.string().trim().min(1).max(2000),
  userRequest: z.string().trim().min(1).max(4000),
  productReferences: z.array(z.string().min(1).max(160)).max(12),
  toolsUsed: z.array(z.string().min(1).max(80)).max(32),
});

export const storefrontVisionInputSchema = z.strictObject({
  kind: z.literal("image"), name: z.string().max(10000).optional(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataBase64: z.string().trim().min(1).max(4 * 1024 * 1024),
});

const productReference = z.strictObject({
  name: z.string().trim().min(1).max(120), brand: z.string().trim().min(1).max(80).nullable(),
  presentation: z.string().trim().min(1).max(100).nullable(),
  quantity: z.number().int().min(1).max(999).nullable(),
  confidence: z.number().finite().min(0.8).max(1),
});
export const storefrontVisionExtractionSchema = z.discriminatedUnion("status", [
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal("PRODUCTS"),
    products: z.array(productReference).min(1).max(12) }),
  z.strictObject({ schemaVersion: z.literal(1), status: z.enum(["NO_PRODUCTS", "UNCLEAR"]),
    products: z.array(z.never()).max(0) }),
]);
export const storefrontVisionWireSchema = z.object({ choices: z.array(z.object({
  finish_reason: z.literal("stop"),
  message: z.object({ content: z.string().min(1).max(8000), refusal: z.string().max(0).nullish(),
    tool_calls: z.array(z.never()).max(0).optional(), function_call: z.never().optional() }),
})).length(1) });
