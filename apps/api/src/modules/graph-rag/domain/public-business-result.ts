import { z } from "zod";
import { GRAPH_EMBEDDING_ID } from "./graph-embedding-model.js";
import { publicBusinessReadSchema, publicBusinessSourceTypeSchema, type PublicBusinessReadInput } from "./public-business-query.js";
import { publicWorkSequence } from "../application/public-source-work-state.js";
import type { PublicEvidenceCandidate } from "../../knowledge-base/domain/public-source-evidence.js";
import type { GraphUnavailable } from "./graph-rag.port.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().min(1).max(191);
export const publicBusinessHitSchema = z.strictObject({
  merchantId: id, sourceType: publicBusinessSourceTypeSchema, sourceId: id,
  publicRevision: z.number().int().safe().positive(), sourceHash: hash,
  modelId: z.literal(GRAPH_EMBEDDING_ID), dimensions: z.literal(384),
  projectedAt: z.number().int().safe().nonnegative(), schemaVersion: z.literal(1), active: z.literal(true),
  chunkId: id, contentHash: hash,
  vectorScore: z.number().finite().min(0).max(1), score: z.number().finite().min(0).max(1),
});
export type PublicBusinessGraphHit = z.infer<typeof publicBusinessHitSchema>;
const pairSchema = z.strictObject({ service: publicBusinessHitSchema, professional: publicBusinessHitSchema,
  score: z.number().finite().min(0).max(1) });
export type PublicBusinessGraphPair = z.infer<typeof pairSchema>;
export type PublicBusinessReadResult = ReturnType<typeof admitPublicBusinessRows> | GraphUnavailable;
export interface PublicBusinessReadPort {
  readPublic(input: PublicBusinessReadInput): Promise<PublicBusinessReadResult>;
}

export function admitPublicBusinessRows(value: PublicBusinessReadInput, rows: unknown[], clock: () => number = Date.now) {
  const input = publicBusinessReadSchema.parse(value);
  if (rows.length > input.limit) throw new Error("public_graph_result_invalid");
  const admit = (row: unknown) => {
    const hit = publicBusinessHitSchema.parse(row);
    if (hit.merchantId !== input.merchantId || hit.vectorScore < input.threshold
      || hit.projectedAt > clock() + 30_000) throw new Error("public_graph_result_invalid");
    // Current static public evidence does not expire at an arbitrary300s age.
    // Canonical/latest-work/SQL publication admission is mandatory after this.
    return hit;
  };
  if (input.mode === "sources") {
    const hits = rows.map(admit);
    if (hits.some(hit => !input.sourceTypes.includes(hit.sourceType))) throw new Error("public_graph_result_invalid");
    return { status: "ready" as const, kind: "public_business" as const, mode: input.mode, hits, partial: true as const };
  }
  const requested = new Set(input.pairs.map(pair => JSON.stringify([pair.serviceId, pair.professionalId])));
  const pairs = rows.map(row => {
    const pair = pairSchema.parse(row), service = admit(pair.service), professional = admit(pair.professional);
    if (service.sourceType !== "service" || professional.sourceType !== "professional"
      || !requested.has(JSON.stringify([service.sourceId, professional.sourceId]))) throw new Error("public_graph_result_invalid");
    return { ...pair, service, professional };
  });
  return { status: "ready" as const, kind: "public_business" as const, mode: input.mode, pairs, partial: true as const };
}

export function publicGraphCandidate(hit: Readonly<PublicBusinessGraphHit>): PublicEvidenceCandidate {
  const sourceVersion = "public-v1:" + String(hit.publicRevision).padStart(20, "0");
  if (publicWorkSequence(sourceVersion) !== hit.publicRevision) throw new Error("public_graph_revision_invalid");
  return { origin: "public_graph", merchantId: hit.merchantId, sourceType: hit.sourceType, sourceId: hit.sourceId,
    publicSourceNamespace: "public-business-v1", schemaVersion: 1, sourceVersion, sourceHash: hit.sourceHash,
    publicationState: "published", chunkId: hit.chunkId, contentHash: hit.contentHash,
    embeddingModel: hit.modelId, embeddingDimensions: hit.dimensions, score: hit.score };
}
