import { Injectable, Inject } from "@nestjs/common";
import { POLICY_REPOSITORY, type PolicyRepositoryPort, type MerchantPolicyData } from "../../domain/ports/policy-repository.port.js";
import { IndexPolicyUseCase } from "./index-policy.use-case.js";

@Injectable()
export class UpdatePolicyUseCase {
  constructor(
    @Inject(POLICY_REPOSITORY) private readonly policyRepo: PolicyRepositoryPort,
    private readonly indexPolicy: IndexPolicyUseCase,
  ) {}

  async execute(merchantId: string, data: MerchantPolicyData): Promise<MerchantPolicyData> {
    const saved = await this.policyRepo.upsert(merchantId, data);
    await this.indexPolicy.execute({ merchantId, policy: saved });
    return saved;
  }
}
