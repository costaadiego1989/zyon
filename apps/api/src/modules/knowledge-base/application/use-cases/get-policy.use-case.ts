import { Injectable, Inject } from "@nestjs/common";
import { POLICY_REPOSITORY, type PolicyRepositoryPort, type MerchantPolicyData } from "../../domain/ports/policy-repository.port.js";

@Injectable()
export class GetPolicyUseCase {
  constructor(
    @Inject(POLICY_REPOSITORY) private readonly policyRepo: PolicyRepositoryPort,
  ) {}

  async execute(merchantId: string): Promise<MerchantPolicyData> {
    const policy = await this.policyRepo.get(merchantId);
    return policy ?? {};
  }
}
