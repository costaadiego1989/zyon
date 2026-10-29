import { z } from "zod";
import { isSafeGeneratedMessageV2 } from "@zyon/conversation-engine";

const id = z.string().trim().min(1).max(191);
const sdp = z.string().trim().min(3).max(200000).refine(value => value.startsWith("v=0"));
export const storefrontProductNarrationRequestSchema = z.strictObject({
  productId: id, sdp,
  // Accepted only for mixed-version transport. Never used to build the script.
  summary: z.string().max(12000).optional(),
});
export const canonicalNarrationProductSchema = z.strictObject({
  id, merchantId: id, name: z.string().trim().min(1).max(1000),
  description: z.string().max(500000).nullable(), isActive: z.literal(true), deletedAt: z.null(),
});
export const canonicalProductNarrationSchema = z.strictObject({
  schemaVersion: z.literal(1), productId: id, title: z.string().trim().min(1).max(160),
  script: z.string().trim().min(1).max(1200),
});
export const storefrontProductNarrationResponseSchema = z.strictObject({
  sdp, providerCallId: z.string().min(1).max(191).optional(),
});

/** Presentation syntax only. No topic keywords or merchant/client prompt is
 * interpreted as authority. Facts come exclusively from the selected row. */
export function buildCanonicalProductNarration(value: unknown) {
  const parsed = canonicalNarrationProductSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const plain = (text: string) => text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim();
  const title = plain(parsed.data.name).slice(0, 160).trim();
  if (!title || !isSafeGeneratedMessageV2(title)) return undefined;
  const description = plain(parsed.data.description ?? "");
  const safeDescription = isSafeGeneratedMessageV2(description) ? description : "";
  const text = [title.endsWith(".") ? title : `${title}.`, safeDescription].filter(Boolean).join(" ");
  const words = text.split(/\s+/).filter(Boolean);
  const script = words.slice(0, 45).join(" ").slice(0, 1200).trim();
  const output = canonicalProductNarrationSchema.safeParse({ schemaVersion: 1,
    productId: parsed.data.id, title, script });
  return output.success && isSafeGeneratedMessageV2(output.data.script) ? output.data : undefined;
}
