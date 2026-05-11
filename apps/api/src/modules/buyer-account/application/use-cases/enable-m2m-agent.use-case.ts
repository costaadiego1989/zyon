import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { M2mTokenService } from "../../domain/services/m2m-token.service.js";

export interface EnableM2mResult {
  token: string;
}

@Injectable()
export class EnableM2mAgentUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    private readonly m2mTokenService: M2mTokenService
  ) {}

  async execute(globalUserId: string): Promise<EnableM2mResult> {
    const agent = await this.repo.findAgentByGlobalUserId(globalUserId);
    if (!agent) throw new NotFoundException("buyer_agent_not_found");

    const { plain, hash } = this.m2mTokenService.generate();
    const updated = agent.withM2mEnabled(hash);
    await this.repo.saveAgent(updated);

    return { token: plain };
  }
}
