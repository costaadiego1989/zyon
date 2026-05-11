import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BuyerAgentProfile, type AgentPersonality } from "../../domain/entities/buyer-agent-profile.entity.js";

export interface UpsertBuyerAgentRequest {
  globalUserId: string;
  name: string;
  personality: AgentPersonality;
  maxRounds: number;
  targetDiscountPercent: number;
  minimumAcceptableDiscountPercent: number;
  autoAcceptThreshold?: number;
}

@Injectable()
export class UpsertBuyerAgentUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository
  ) {}

  async execute(input: UpsertBuyerAgentRequest): Promise<BuyerAgentProfile> {
    const account = await this.repo.findByGlobalUserId(input.globalUserId);
    if (!account) throw new NotFoundException("buyer_account_not_found");

    const existing = await this.repo.findAgentByGlobalUserId(input.globalUserId);
    const now = new Date();

    const agent = new BuyerAgentProfile({
      id: existing?.id ?? `agent_${crypto.randomUUID().replace(/-/g, "")}`,
      globalUserId: input.globalUserId,
      name: input.name,
      personality: input.personality,
      maxRounds: input.maxRounds,
      targetDiscountPercent: input.targetDiscountPercent,
      minimumAcceptableDiscountPercent: input.minimumAcceptableDiscountPercent,
      autoAcceptThreshold: input.autoAcceptThreshold,
      m2mEnabled: existing?.m2mEnabled ?? false,
      m2mTokenHash: existing?.m2mTokenHash,
      m2mTokenCreatedAt: existing?.m2mTokenCreatedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    await this.repo.saveAgent(agent);
    return agent;
  }
}
