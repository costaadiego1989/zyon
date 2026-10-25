import { Body, Controller, Delete, Get, NotFoundException, Post, Put, Req, UseGuards } from "@nestjs/common";
import { UpsertBuyerAgentUseCase } from "../../application/use-cases/upsert-buyer-agent.use-case.js";
import { EnableM2mAgentUseCase } from "../../application/use-cases/enable-m2m-agent.use-case.js";
import { RevokeM2mAgentUseCase } from "../../application/use-cases/revoke-m2m-agent.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";
import type { BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY } from "../../domain/ports/buyer-account-repository.port.js";
import { Inject } from "@nestjs/common";
import type { AgentPersonality } from "../../domain/entities/buyer-agent-profile.entity.js";

@Controller("buyer/me/agent")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerAgentController {
  constructor(
    private readonly upsertAgent: UpsertBuyerAgentUseCase,
    private readonly enableM2m: EnableM2mAgentUseCase,
    private readonly revokeM2m: RevokeM2mAgentUseCase,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository
  ) {}

  @Get()
  async getAgent(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    const agent = await this.repo.findAgentByGlobalUserId(buyer.globalUserId);
    if (!agent) throw new NotFoundException("buyer_agent_not_found");
    return {
      agent_name: agent.name,
      personality: agent.personality,
      target_discount_percent: agent.targetDiscountPercent,
      auto_accept_threshold: agent.autoAcceptThreshold ?? 0
    };
  }

  @Put()
  async putAgent(
    @Req() req: { user?: unknown },
    @Body()
    body: {
      agent_name?: string;
      name?: string;
      personality: AgentPersonality;
      target_discount_percent?: number;
      targetDiscountPercent?: number;
      auto_accept_threshold?: number;
      autoAcceptThreshold?: number;
    }
  ) {
    const buyer = currentBuyer(req);
    const result = await this.upsertAgent.execute({
      globalUserId: buyer.globalUserId,
      name: body.agent_name ?? body.name ?? "Agente",
      personality: body.personality,
      maxRounds: 5,
      targetDiscountPercent: body.target_discount_percent ?? body.targetDiscountPercent ?? 5,
      minimumAcceptableDiscountPercent: 0,
      autoAcceptThreshold: body.auto_accept_threshold ?? body.autoAcceptThreshold ?? 0
    });
    return {
      agent_name: result.name,
      personality: result.personality,
      target_discount_percent: result.targetDiscountPercent,
      auto_accept_threshold: result.autoAcceptThreshold ?? 0
    };
  }

  @Post("m2m/enable")
  async enableM2mRoute(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    return this.enableM2m.execute(buyer.globalUserId);
  }

  @Delete("m2m/revoke")
  async revokeM2mRoute(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    await this.revokeM2m.execute(buyer.globalUserId);
    return { success: true };
  }
}
