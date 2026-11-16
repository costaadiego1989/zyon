export type ExecutionAuthorityRequest =
  | { kind: 'manual'; actorId: string }
  | { kind: 'automatic'; policyId: string; policyVersion: number; policyDigest: string };
interface BaseAuthority {
  proposalId: string; proposalDigest: string; campaignId: string; campaignDigest: string; connectionEpoch: number;
}
export type ResolvedExecutionAuthority = BaseAuthority & (
  | { kind: 'manual'; actorId: string; approvedBy: string; approvedAt: string }
  | { kind: 'automatic'; actorId: 'service:meta-ads-agent'; policyId: string; policyVersion: number; policyDigest: string }
);
export interface ExecutionAuthorityPort {
  resolve(merchantId: string, proposalId: string, request: ExecutionAuthorityRequest): Promise<ResolvedExecutionAuthority>;
  assertCurrent(merchantId: string, proposalId: string, authority: ResolvedExecutionAuthority): Promise<void>;
}
