export const POLICY_REPOSITORY = Symbol("POLICY_REPOSITORY");

export interface MerchantPolicyData {
  returns?: string | null;
  shipping?: string | null;
  warranty?: string | null;
  payment?: string | null;
  general?: string | null;
}

export interface PolicyRepositoryPort {
  get(merchantId: string): Promise<MerchantPolicyData | null>;
  upsert(merchantId: string, data: MerchantPolicyData): Promise<MerchantPolicyData>;
}
