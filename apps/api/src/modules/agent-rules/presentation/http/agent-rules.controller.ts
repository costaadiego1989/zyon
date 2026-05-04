import { Body, Controller, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import type { AgentRulesPatch } from "../../domain/agent-rules.types.js";
import {
  GetAgentContextUseCase,
  GetAgentRulesUseCase,
  UpdateAgentRulesUseCase
} from "../../application/agent-rules.use-cases.js";

@UseGuards(AuthGuard)
@Controller("agent-rules")
export class AgentRulesController {
  constructor(
    private readonly getRules: GetAgentRulesUseCase,
    private readonly updateRules: UpdateAgentRulesUseCase,
    private readonly getContext: GetAgentContextUseCase
  ) {}

  @Get()
  defaultRules(@Req() request: unknown) {
    const user = currentUser(request as { user?: unknown });
    return this.getRules.execute({ merchantId: user.merchantId, userId: user.userId });
  }

  @Put()
  updateDefault(@Req() request: unknown, @Body() body: AgentRulesPatch) {
    const user = currentUser(request as { user?: unknown });
    return this.updateRules.execute({ merchantId: user.merchantId, userId: user.userId }, body);
  }

  @Get("context")
  defaultContext(@Req() request: unknown) {
    const user = currentUser(request as { user?: unknown });
    return this.getContext.execute({ merchantId: user.merchantId, userId: user.userId });
  }

  @Get(":agentId")
  byAgent(@Req() request: unknown, @Param("agentId") agentId: string) {
    const user = currentUser(request as { user?: unknown });
    return this.getRules.execute({ merchantId: user.merchantId, userId: user.userId }, agentId);
  }

  @Put(":agentId")
  updateAgent(@Req() request: unknown, @Param("agentId") agentId: string, @Body() body: AgentRulesPatch) {
    const user = currentUser(request as { user?: unknown });
    return this.updateRules.execute({ merchantId: user.merchantId, userId: user.userId }, body, agentId);
  }

  @Get(":agentId/context")
  contextByAgent(@Req() request: unknown, @Param("agentId") agentId: string) {
    const user = currentUser(request as { user?: unknown });
    return this.getContext.execute({ merchantId: user.merchantId, userId: user.userId }, agentId);
  }
}
