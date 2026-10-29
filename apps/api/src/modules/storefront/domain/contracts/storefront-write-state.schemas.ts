import { z } from "zod";
import { storefrontWriteScopeSchema } from "./storefront-local-cart-write.schemas.js";

/** Internal observation only. Parsing neither authenticates a scope nor grants
 * execution/replay permission. An existing request always keeps its lane blocked;
 * a missing reference never proves that an uncertain effect did not occur. */
export const storefrontWriteStateRequestSchema = z.strictObject({ scope: storefrontWriteScopeSchema });
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const effect = z.strictObject({ effectId: z.uuid(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) });
const request = z.strictObject({
  requestId: z.uuid(), messageId: storefrontWriteScopeSchema.shape.cartId,
  protocolVersion: z.number().int().min(1).max(32767), expectedRevision: revision,
  state: z.enum(["processing", "unknown"]), effect: effect.nullable(),
});
export const storefrontWriteStateResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scope_unavailable") }),
  z.strictObject({ kind: z.literal("state"), revision, request: request.nullable() }),
]);
export type StorefrontWriteStateRequest = z.infer<typeof storefrontWriteStateRequestSchema>;
export type StorefrontWriteStateResult = z.infer<typeof storefrontWriteStateResultSchema>;

/** Synchronous detached snapshot, taken before the query's first await. */
export function snapshotStorefrontWriteStateRequest(value: unknown) {
  const parsed = storefrontWriteStateRequestSchema.parse(value);
  Object.freeze(parsed.scope);
  return Object.freeze(parsed);
}

