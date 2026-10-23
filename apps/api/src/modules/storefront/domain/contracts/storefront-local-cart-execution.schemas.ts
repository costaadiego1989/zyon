import { z } from "zod";

/** Internal application outcomes only, not public receipts or completion.
 * No claim capability, fingerprint, exception or commercial snapshot escapes. */
export const storefrontLocalCartExecutionResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local_effect_recorded"), requestId: z.uuid(), effectId: z.uuid(),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ kind: z.literal("receipt_required"), requestId: z.uuid(), state: z.enum(["processing", "unknown"]) }),
  z.strictObject({ kind: z.literal("identity_conflict") }),
  z.strictObject({ kind: z.literal("lane_blocked") }),
  z.strictObject({ kind: z.literal("revision_conflict") }),
  z.strictObject({ kind: z.literal("scope_unavailable") }),
  z.strictObject({ kind: z.literal("admission_unknown") }),
  z.strictObject({ kind: z.literal("outcome_unknown"), requestId: z.uuid() }),
]);

export type StorefrontLocalCartExecutionResult = z.infer<typeof storefrontLocalCartExecutionResultSchema>;

