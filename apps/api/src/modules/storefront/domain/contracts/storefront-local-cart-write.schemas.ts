import { z } from "zod";

// PostgreSQL text cannot contain NUL. Reject unpaired UTF-16 surrogates before
// UTF-8 transport can silently replace them; valid Unicode remains untouched.
function sqlCompatibleIdentifier(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
const id = z.string().min(1).max(191).refine(value => value.trim().length > 0 && sqlCompatibleIdentifier(value));
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Internal candidate only; parsing neither authenticates scope nor authorizes stock/price/type. */
export const storefrontWriteScopeSchema = z.strictObject({
  merchantId: id, conversationId: id, cartId: id, principalId: id,
});

/** Not exposed by any endpoint/capability. Public read-ui v1 remains unchanged. */
export const storefrontLocalCartWriteIntentSchema = z.strictObject({
  version: z.literal(1),
  message_id: id,
  expected_revision: revision,
  command: z.strictObject({
    tool: z.literal("add_item_to_cart"),
    args: z.strictObject({ variantId: id, quantity: z.number().int().min(1).max(99).default(1) }),
  }),
});

const record = z.strictObject({
  scope: storefrontWriteScopeSchema,
  intent: storefrontLocalCartWriteIntentSchema,
  state: z.enum(["processing", "unknown", "completed", "rejected", "reconciled"]),
});

/** In-memory evaluation values, NOT a persistence model, proof or HTTP response. */
export const storefrontWriteAdmissionInputSchema = z.strictObject({
  scope: storefrontWriteScopeSchema,
  intent: storefrontLocalCartWriteIntentSchema,
  currentRevision: revision,
  existing: record.optional(),
  active: record.extend({ state: z.enum(["processing", "unknown"]) }).optional(),
});

