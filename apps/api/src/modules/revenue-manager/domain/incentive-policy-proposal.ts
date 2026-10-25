import { digest, requiredSample } from "../../experiments/domain/services/measurement-plan.js";
import type { IncentivePlanningBaseline } from "./incentive-measurement.js";
import { incentivePolicySnapshot, type IncentivePolicySnapshot } from "./incentive-policy.js";

/** Proposed exposure, never spending authority. Approval materializes the exact
 * policy and binds it to the separate financial review in one transaction. */
export type IncentivePolicyProposal = {
  definition: "incentive-policy-proposal-v1";
  previousPolicyVersion: number;
  previousPolicyHash: string;
  basis: "observed_safe_offer_and_required_sample";
};

export function deriveProposedIncentivePolicy(previous: IncentivePolicySnapshot,
  baseline: IncentivePlanningBaseline, asOf: string, safeMaxDiscountCents: number) {
  if (digest(previous) !== digest(incentivePolicySnapshot(previous.merchantId, previous.version, previous))
    || previous.version >= 2147483647 || !baseline || !baseline.complete
    || !Number.isSafeInteger(baseline.buyers) || baseline.buyers < 100 || baseline.buyers > 10000
    || !Number.isSafeInteger(baseline.conversions) || baseline.conversions < 1 || baseline.conversions >= baseline.buyers
    || !Number.isFinite(Date.parse(asOf)) || Date.parse(baseline.windowEnd) !== Date.parse(asOf) - 7 * 86400000
    || Date.parse(baseline.windowEnd) - Date.parse(baseline.windowStart) !== 28 * 86400000
    || !Number.isSafeInteger(safeMaxDiscountCents) || safeMaxDiscountCents < 1 || safeMaxDiscountCents > 2147483647) return null;
  let required: number;
  try { required = requiredSample(baseline.conversions / baseline.buyers, .01); }
  catch (error) { if (error instanceof Error && /EXPERIMENT_(SAMPLE_NOT_FEASIBLE|INVALID_PLANNING_RATE)/.test(error.message)) return null; throw error; }
  // Fund exactly the planned treatment sample. No extrapolated conversions,
  // unused million-redemption envelope or silent lowering of sample criteria.
  if (required > Math.floor(baseline.buyers / 8) || required * safeMaxDiscountCents > 2147483647) return null;
  const policy = incentivePolicySnapshot(previous.merchantId, previous.version + 1, { enabled: true,
    maxDiscountCents: safeMaxDiscountCents, maxRedemptions: required, limitCents: required * safeMaxDiscountCents });
  const policyProposal: IncentivePolicyProposal = { definition: "incentive-policy-proposal-v1",
    previousPolicyVersion: previous.version, previousPolicyHash: previous.policyHash,
    basis: "observed_safe_offer_and_required_sample" };
  return { policy, policyProposal };
}

export function assertProposedIncentivePolicy(policy: IncentivePolicySnapshot, proposal: IncentivePolicyProposal,
  baseline: IncentivePlanningBaseline, asOf: string) {
  const invalid = () => { throw new Error("STRATEGY_INVALID_PROPOSED_INCENTIVE_POLICY"); };
  if (!proposal || proposal.definition !== "incentive-policy-proposal-v1"
    || proposal.basis !== "observed_safe_offer_and_required_sample" || !Number.isSafeInteger(proposal.previousPolicyVersion)
    || proposal.previousPolicyVersion < 0 || proposal.previousPolicyVersion !== policy.version - 1
    || !/^[a-f0-9]{64}$/.test(proposal.previousPolicyHash)
    || Object.keys(proposal).sort().join() !== ["basis", "definition", "previousPolicyHash", "previousPolicyVersion"].sort().join()
    || digest(policy) !== digest(incentivePolicySnapshot(policy.merchantId, policy.version, policy)) || !policy.enabled) invalid();
  // Reconstruct the size independently of the previous policy's limits, whose
  // hash/version are authenticated against the immutable run and current DB.
  const syntheticPrevious = incentivePolicySnapshot(policy.merchantId, proposal.previousPolicyVersion,
    { enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 });
  const expected = deriveProposedIncentivePolicy(syntheticPrevious, baseline, asOf, policy.maxDiscountCents);
  if (!expected || digest(expected.policy) !== digest(policy)) invalid();
}
