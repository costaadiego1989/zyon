import { Injectable, Inject, Optional } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { POLICY_REPOSITORY, type PolicyRepositoryPort, type MerchantPolicyData } from "../../domain/ports/policy-repository.port.js";
import { IndexPolicyUseCase } from "./index-policy.use-case.js";

@Injectable()
export class UpdatePolicyUseCase {
  constructor(
    @Inject(POLICY_REPOSITORY) private readonly policyRepo: PolicyRepositoryPort,
    private readonly indexPolicy: IndexPolicyUseCase,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly events?: DomainEventBus,
  ) {}

  async execute(merchantId: string, data: MerchantPolicyData): Promise<MerchantPolicyData> {
    const saved = await this.policyRepo.upsert(merchantId, data);
    await this.indexPolicy.execute({ merchantId, policy: saved });
    // Derived search must never turn a successful policy update into a failure.
    await this.events?.publish({ eventType: "knowledge.policy_updated", merchantId, payload: {} }).catch(() => undefined);
    return saved;
  }
}
