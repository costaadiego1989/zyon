import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutSettingsModule } from "../checkout-settings/checkout-settings.module.js";
import { createPrismaClient } from "../checkout/infrastructure/prisma/prisma-client.js";
import {
  GetAgentContextUseCase,
  GetAgentRulesUseCase,
  UpdateAgentRulesUseCase
} from "./application/agent-rules.use-cases.js";
import { AGENT_RULES_REPOSITORY } from "./domain/ports/agent-rules-repository.port.js";
import { CHECKOUT_SETTINGS_CONTEXT_PORT } from "./domain/ports/checkout-settings-context.port.js";
import { CheckoutSettingsContextAdapter } from "./infrastructure/checkout-settings-context.adapter.js";
import { InMemoryAgentRulesRepository } from "./infrastructure/in-memory-agent-rules.repository.js";
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
    InMemoryAgentRulesRepository,
    {
      provide: AGENT_RULES_REPOSITORY,
      useFactory: (inMemory: InMemoryAgentRulesRepository) => {
        if (process.env.AGENT_RULES_REPOSITORY === "prisma" || process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaAgentRulesRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemoryAgentRulesRepository]
    },
    { provide: CHECKOUT_SETTINGS_CONTEXT_PORT, useExisting: CheckoutSettingsContextAdapter }
  ],
  exports: [GetAgentContextUseCase]
})
export class AgentRulesModule {}
