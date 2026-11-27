import { z } from "zod";
import { graphReadSchema, type GraphReadInput } from "./graph-query.js";
import type { GraphReadResult } from "./graph-rag.port.js";
const identity = z.string().min(1).max(191), hash = z.string().regex(/^[a-f0-9]{64}$/);
const common = { merchantId: identity, sourceVersion: z.number().int().safe().nonnegative(), sourceHash: hash,
  modelId: z.string().min(1).max(250), projectedAt: z.number().int().safe().nonnegative(),
  vectorScore: z.number().finite().min(0).max(1), score: z.number().finite().min(0).max(1) };
const catalogHit = z.strictObject({ ...common, productId: identity, variantId: identity });
const knowledgeHit = z.strictObject({ ...common, sourceType: z.enum(["faq", "policy"]), sourceId: identity,
  chunkId: identity, contentHash: hash });
const merchantGuideHit = z.strictObject({ ...common, sourceType: z.literal("merchant_guide"), audience: z.literal("merchant"),
  context: z.literal("cashback"), sourceId: identity, chunkId: identity, contentHash: hash });
export class GraphResultError extends Error {}
export function admitGraphRows(value: GraphReadInput, rows: unknown[], clock: () => number = Date.now): GraphReadResult {
  const input = graphReadSchema.parse(value);
  if (rows.length > input.limit) throw new GraphResultError();
  const hits = rows.map(row => {
    const parsed = (input.kind === "catalog" ? catalogHit : input.kind === "merchant_help" ? merchantGuideHit : knowledgeHit).safeParse(row);
    if (!parsed.success) throw new GraphResultError();
    const hit = parsed.data;
    if (hit.merchantId !== input.merchantId || hit.modelId !== input.modelId
      || hit.projectedAt < input.nowEpochMs - input.maxAgeMs || hit.projectedAt > clock() + 30_000
      || hit.sourceVersion > clock() + 30_000 || hit.vectorScore < input.threshold) throw new GraphResultError();
    return hit;
  });
  return { status: "ready", kind: input.kind, hits, partial: true };
}
