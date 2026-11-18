import { ConflictException } from "@nestjs/common";
import type { ServicePolicyConfiguration } from "../../modules/merchant/domain/service-business-policy.js";
import type { ActiveSlotLeaseProof, RedisServiceSlots } from "./redis-service-slots.js";
import { professionalHoldRequests, type ProfessionalCheckoutSelection } from "./service-checkout-selection.js";

export type ProfessionalLeaseStore = Pick<RedisServiceSlots, "acquire" | "assertActive" | "get" | "release">;
/** Internal context: the application binds ownerId to its authenticated session
 * or operator command. It is never copied from a public request body. */
export interface ProfessionalLeaseOwner { ownerId: string; store: () => ProfessionalLeaseStore }

export async function acquireProfessionalLease(merchantId: string, selections: ProfessionalCheckoutSelection[],
  policy: ServicePolicyConfiguration, owner: ProfessionalLeaseOwner) {
  if (!policy.holdEnabled) return undefined;
  if (!owner.ownerId || !policy.holdMinutes) throw new ConflictException("service_hold_required");
  return owner.store().acquire(merchantId, owner.ownerId, professionalHoldRequests(selections), policy.holdMinutes * 60_000);
}

export async function assertProfessionalLease(merchantId: string, selections: ProfessionalCheckoutSelection[],
  policy: ServicePolicyConfiguration, owner?: ProfessionalLeaseOwner): Promise<ActiveSlotLeaseProof | undefined> {
  // Off deliberately does not instantiate/connect to Redis.
  if (!policy.holdEnabled) return;
  if (!owner?.ownerId) throw new ConflictException("service_hold_required");
  return owner.store().assertActive(merchantId, owner.ownerId, professionalHoldRequests(selections));
}
