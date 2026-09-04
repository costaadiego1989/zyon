import { Body, Controller, Get, Param, Put, Req, UseGuards, ValidationPipe } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import {
  GetAgentContextUseCase,
  GetAgentRulesUseCase,
  UpdateAgentRulesUseCase
} from "../../application/agent-rules.use-cases.js";
import { AgentRulesPatchDto } from "./dto/agent-rules-patch.dto.js";

/**
 * Authenticated request shape populated by AuthGuard. H3 fix: type-safe extraction;
 * `currentUser` throws UnauthorizedException if `request.user` is missing.
 */
interface AuthenticatedRequest {
  user: { userId: string; merchantId: string; email: string; role: "owner" | "admin" };
}

@UseGuards(AuthGuard)
@Controller("agent-rules")
export class AgentRulesController {
  constructor(
    private readonly getRules: GetAgentRulesUseCase,
    private readonly updateRules: UpdateAgentRulesUseCase,
    private readonly getContext: GetAgentContextUseCase
  ) {}

  @Get()
  defaultRules(@Req() request: AuthenticatedRequest) {
    const user = currentUser(request);
    return this.getRules.execute({ merchantId: user.merchantId, userId: user.userId });
  }

  @Put()
  updateDefault(
    @Req() request: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: AgentRulesPatchDto
  ) {
    const user = currentUser(request);
    return this.updateRules.execute({ merchantId: user.merchantId, userId: user.userId }, body);
  }

  @Get("context")
  defaultContext(@Req() request: AuthenticatedRequest) {
    const user = currentUser(request);
    return this.getContext.execute({ merchantId: user.merchantId, userId: user.userId });
  }

  @Get(":agentId")
  byAgent(@Req() request: AuthenticatedRequest, @Param("agentId") agentId: string) {
    const user = currentUser(request);
    return this.getRules.execute({ merchantId: user.merchantId, userId: user.userId }, agentId);
  }

  @Put(":agentId")
  updateAgent(
    @Req() request: AuthenticatedRequest,
    @Param("agentId") agentId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: AgentRulesPatchDto
  ) {
    const user = currentUser(request);
    return this.updateRules.execute({ merchantId: user.merchantId, userId: user.userId }, body, agentId);
  }

  @Get(":agentId/context")
  contextByAgent(@Req() request: AuthenticatedRequest, @Param("agentId") agentId: string) {
    const user = currentUser(request);
    return this.getContext.execute({ merchantId: user.merchantId, userId: user.userId }, agentId);
  }
}
