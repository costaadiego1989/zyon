import { storefrontWriteAdmissionInputSchema } from "../contracts/storefront-local-cart-write.schemas.js";
import { snapshotStorefrontWriteIdentity } from "./storefront-write-identity.js";

export type StorefrontWriteAdmissionDecision = "claim_required" | "receipt_required" | "identity_conflict"
  | "lane_blocked" | "revision_conflict" | "inconsistent_state";

/** Pure prerequisite decision, NOT admission/execution authority or DB locking.
 * Future infrastructure must obtain a fenced atomic claim and recheck all data.
 * No clocks, state transitions, timeout takeover, effects or implicit recovery.
 */
export function decideStorefrontWriteAdmission(input: unknown): StorefrontWriteAdmissionDecision {
  const data = storefrontWriteAdmissionInputSchema.parse(input);
  const incoming = snapshotStorefrontWriteIdentity(data.scope, data.intent);
  const existing = data.existing && snapshotStorefrontWriteIdentity(data.existing.scope, data.existing.intent);
  const active = data.active && snapshotStorefrontWriteIdentity(data.active.scope, data.active.intent);
  const sameLane = (other: typeof incoming) => other.scope.merchantId === incoming.scope.merchantId
    && other.scope.conversationId === incoming.scope.conversationId;

  if (existing && (!sameLane(existing) || existing.namespaceKey !== incoming.namespaceKey)) return "inconsistent_state";
  if (active && (!sameLane(active) || active.scope.cartId !== incoming.scope.cartId)) return "inconsistent_state";
  if (existing && active && existing.namespaceKey === active.namespaceKey
    && (existing.canonicalMaterial !== active.canonicalMaterial || data.existing!.state !== data.active!.state)) return "inconsistent_state";

  // A duplicate lookup wins over the current revision: never reinterpret an old
  // completed/rejected/unknown request as permission to execute it again.
  if (existing) return existing.canonicalMaterial === incoming.canonicalMaterial ? "receipt_required" : "identity_conflict";
  if (active) {
    if (active.namespaceKey === incoming.namespaceKey)
      return active.canonicalMaterial === incoming.canonicalMaterial ? "receipt_required" : "identity_conflict";
    return "lane_blocked";
  }
  if (data.intent.expected_revision !== data.currentRevision) return "revision_conflict";
  return "claim_required";
}

