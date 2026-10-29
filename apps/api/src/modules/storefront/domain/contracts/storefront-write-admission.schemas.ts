import { z } from "zod";
import { storefrontLocalCartWriteIntentSchema, storefrontWriteScopeSchema } from "./storefront-local-cart-write.schemas.js";

/** Isolated infrastructure admission contract, never a public action or auth.
 * Bytes are opaque: no digest/HMAC policy or principal lifecycle is selected. */
const fingerprint = z.strictObject({
  version: z.number().int().min(1).max(32767),
  bytes: z.instanceof(Uint8Array).refine(value => value.byteLength >= 16 && value.byteLength <= 128)
    .transform(value => Uint8Array.from(value)),
});

export const storefrontWriteClaimSchema = z.strictObject({
  requestId: z.uuid(), claimToken: z.uuid(), claimGeneration: z.literal(1),
});

export const storefrontWriteAdmissionRequestSchema = z.strictObject({
  scope: storefrontWriteScopeSchema, intent: storefrontLocalCartWriteIntentSchema, fingerprint,
});

export const storefrontWriteAdmissionResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("claimed"), claim: storefrontWriteClaimSchema }),
  z.strictObject({ kind: z.literal("receipt_required"), requestId: z.uuid(), state: z.enum(["processing", "unknown"]) }),
  z.strictObject({ kind: z.literal("identity_conflict") }),
  z.strictObject({ kind: z.literal("lane_blocked") }),
  z.strictObject({ kind: z.literal("revision_conflict") }),
  z.strictObject({ kind: z.literal("scope_unavailable") }),
]);

export const storefrontWriteMarkUnknownRequestSchema = z.strictObject({
  scope: storefrontWriteScopeSchema, claim: storefrontWriteClaimSchema,
});
export const storefrontWriteMarkUnknownResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("marked_unknown") }),
  z.strictObject({ kind: z.literal("not_current") }),
]);

export type StorefrontWriteClaim = z.infer<typeof storefrontWriteClaimSchema>;
export type StorefrontWriteAdmissionRequest = z.input<typeof storefrontWriteAdmissionRequestSchema>;
export type StorefrontWriteAdmissionResult = z.infer<typeof storefrontWriteAdmissionResultSchema>;
export type StorefrontWriteMarkUnknownRequest = z.input<typeof storefrontWriteMarkUnknownRequestSchema>;
export type StorefrontWriteMarkUnknownResult = z.infer<typeof storefrontWriteMarkUnknownResultSchema>;

/** Synchronous, detached snapshot. Call before the adapter's first await.
 * Uint8Array.from in the schema also detaches Buffer/subarray backing storage.
 * Typed-array elements cannot be frozen; the private copy is never shared with
 * the caller. Only its containing fingerprint object is frozen. */
export function snapshotStorefrontWriteAdmissionRequest(value: unknown) {
  const parsed = storefrontWriteAdmissionRequestSchema.parse(value);
  Object.freeze(parsed.intent.command.args);
  Object.freeze(parsed.intent.command);
  Object.freeze(parsed.intent);
  Object.freeze(parsed.scope);
  Object.freeze(parsed.fingerprint);
  return Object.freeze(parsed);
}

export function snapshotStorefrontWriteMarkUnknownRequest(value: unknown) {
  const parsed = storefrontWriteMarkUnknownRequestSchema.parse(value);
  Object.freeze(parsed.scope);
  Object.freeze(parsed.claim);
  return Object.freeze(parsed);
}

