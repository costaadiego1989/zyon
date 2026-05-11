import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";

@Injectable()
export class RevokeM2mAgentUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository
  ) {}

  async execute(globalUserId: string): Promise<void> {
    const agent = await this.repo.findAgentByGlobalUserId(globalUserId);
    if (!agent) throw new NotFoundException("buyer_agent_not_found");
    const updated = agent.withM2mRevoked();
    await this.repo.saveAgent(updated);
  }
}
