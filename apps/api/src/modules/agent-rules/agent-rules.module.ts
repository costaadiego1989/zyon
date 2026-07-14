import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutSettingsModule } from "../checkout-settings/checkout-settings.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import {
  GetAgentContextUseCase,
  GetAgentRulesUseCase,
  UpdateAgentRulesUseCase
} from "./application/agent-rules.use-cases.js";
import { AGENT_RULES_REPOSITORY } from "./domain/ports/agent-rules-repository.port.js";
import { CHECKOUT_SETTINGS_CONTEXT_PORT } from "./domain/ports/checkout-settings-context.port.js";
import { CheckoutSettingsContextAdapter } from "./infrastructure/checkout-settings-context.adapter.js";
import { PrismaAgentRulesRepository } from "./infrastructure/prisma-agent-rules.repository.js";
import { AgentRulesController } from "./presentation/http/agent-rules.controller.js";

@Module({
  imports: [AuthModule, CheckoutSettingsModule],
  controllers: [AgentRulesController],
  providers: [
    GetAgentRulesUseCase,
    UpdateAgentRulesUseCase,
    GetAgentContextUseCase,
    CheckoutSettingsContextAdapter,
    {
      provide: AGENT_RULES_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaAgentRulesRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    { provide: CHECKOUT_SETTINGS_CONTEXT_PORT, useExisting: CheckoutSettingsContextAdapter }
  ],
  // M2 fix: export all three use-cases for composability from other modules.
  exports: [GetAgentRulesUseCase, UpdateAgentRulesUseCase, GetAgentContextUseCase]
})
export class AgentRulesModule {}
