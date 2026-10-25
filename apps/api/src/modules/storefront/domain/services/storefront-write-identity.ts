import { storefrontLocalCartWriteIntentSchema, storefrontWriteScopeSchema } from "../contracts/storefront-local-cart-write.schemas.js";

/** Ephemeral canonical material only: never log/store as a digest or raw receipt.
 * Hash/HMAC and durable principal creation remain separate reviewed decisions.
 * Caller must derive scope from verified authority; schema validity is not auth.
 */
export function snapshotStorefrontWriteIdentity(scope: unknown, intent: unknown) {
  const parsedScope = storefrontWriteScopeSchema.parse(scope);
  const parsedIntent = storefrontLocalCartWriteIntentSchema.parse(intent);
  const args = Object.freeze(parsedIntent.command.args);
  const command = Object.freeze({ ...parsedIntent.command, args });
  const snapshotIntent = Object.freeze({ ...parsedIntent, command });
  return Object.freeze({
    scope: Object.freeze(parsedScope),
    intent: snapshotIntent,
    namespaceKey: JSON.stringify([parsedScope.merchantId, parsedScope.conversationId, parsedIntent.message_id]),
    canonicalMaterial: JSON.stringify(["storefront-local-cart-write/identity-v1", parsedScope.merchantId,
      parsedScope.conversationId, parsedScope.cartId, parsedScope.principalId, parsedIntent.version,
      parsedIntent.expected_revision, command.tool, args.variantId, args.quantity]),
  });
}

