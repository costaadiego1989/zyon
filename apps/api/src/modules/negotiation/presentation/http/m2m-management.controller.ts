import { Body, Controller, Get, Param, Put, Post, UseGuards, Req } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import {
  ListM2MAgentsUseCase,
  CreateM2MAgentUseCase,
  SuspendM2MAgentUseCase,
  GetProtocolConfigUseCase,
  UpsertProtocolConfigUseCase,
} from "../../application/m2m-management.use-cases.js";

@Controller("m2m")
@UseGuards(AuthGuard)
export class M2MManagementController {
  constructor(
    private readonly listAgents: ListM2MAgentsUseCase,
    private readonly createAgent: CreateM2MAgentUseCase,
    private readonly suspendAgent: SuspendM2MAgentUseCase,
    private readonly getConfig: GetProtocolConfigUseCase,
    private readonly upsertConfig: UpsertProtocolConfigUseCase,
  ) {}

  @Get("agents")
  async getAgents(@Req() req: any) {
    const merchantId = req.user?.merchant_id;
    const agents = await this.listAgents.execute(merchantId);
    return { agents, total: agents.length };
  }

  @Post("agents")
  async registerAgent(@Req() req: any, @Body() body: { displayName: string; globalUserId: string; scopes?: string[] }) {
    const merchantId = req.user?.merchant_id;
    const agent = await this.createAgent.execute(merchantId, body);
    return agent;
  }

  @Put("agents/:id/suspend")
  async toggleSuspend(@Req() req: any, @Param("id") agentId: string, @Body() body: { suspend: boolean }) {
    const merchantId = req.user?.merchant_id;
    await this.suspendAgent.execute(merchantId, agentId, body.suspend);
    return { ok: true };
  }

  @Get("protocol/config")
  async getProtocolConfig(@Req() req: any) {
    const merchantId = req.user?.merchant_id;
    return this.getConfig.execute(merchantId);
  }

  @Put("protocol/config")
  async putProtocolConfig(@Req() req: any, @Body() body: { enabled?: boolean; webhookUrl?: string | null; maxSessionTtlMinutes?: number }) {
    const merchantId = req.user?.merchant_id;
    return this.upsertConfig.execute(merchantId, body);
  }
}
