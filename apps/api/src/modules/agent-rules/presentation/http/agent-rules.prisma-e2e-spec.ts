import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { JwtService } from "../../../auth/domain/services/jwt.service.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";
import { PrismaAuthRepository } from "../../../auth/infrastructure/prisma-auth.repository.js";
import { PrismaMerchantRepository } from "../../../merchant/infrastructure/prisma-merchant.repository.js";
import { RegisterMerchantUseCase } from "../../../auth/application/register-merchant.use-case.js";
import { DefaultMerchantIdGenerator } from "../../../auth/domain/ports/merchant-id-generator.port.js";
import { PrismaAgentRulesRepository } from "../../infrastructure/prisma-agent-rules.repository.js";
import {
  GetAgentContextUseCase,
  GetAgentRulesUseCase,
  UpdateAgentRulesUseCase
} from "../../application/agent-rules.use-cases.js";
import { AgentRulesController } from "./agent-rules.controller.js";
import type { AgentRulesPatchDto } from "./dto/agent-rules-patch.dto.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "Prisma agent rules e2e configures a user agent and returns negotiation context",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma agent-rules e2e tests." },
  async () => {
    const prisma = createPrismaClient();
    const authRepository = new PrismaAuthRepository(prisma);
    const jwt = new JwtService("test-secret", 3600);
    const merchantRepository = new PrismaMerchantRepository(prisma);
    const register = new RegisterMerchantUseCase(
      authRepository,
      new PasswordHasher(),
      jwt,
      new DefaultMerchantIdGenerator()
    );
    const repository = new PrismaAgentRulesRepository(prisma);
    const noopCheckoutPort = { async getContext() { return undefined; } } as const;
    const controller = new AgentRulesController(
      new GetAgentRulesUseCase(repository),
      new UpdateAgentRulesUseCase(repository),
      new GetAgentContextUseCase(repository, noopCheckoutPort)
    );

    let merchantId = "";
    try {
      const auth = await register.execute({
        merchant_name: "Agent Store",
        email: `agent_${crypto.randomUUID()}@example.com`,
        password: "secret-password-123"
      });
      merchantId = auth.merchant_id;
      const request = {
        user: {
          userId: auth.user_id,
          merchantId: auth.merchant_id,
          email: auth.email,
          role: "owner" as const
        }
      };

      // M3 fix: E2E test validates DTO path (whitelist, transform, validation)
      // by calling controller (which applies ValidationPipe) rather than use-case directly.
      const dto: AgentRulesPatchDto = {
        identity: { agentName: "Maya" },
        capabilities: { machineToMachineNegotiation: true },
        checkoutSettings: { maxInterventionsPerSession: 4 }
      };
      await controller.updateDefault(request, dto);
      const context = await controller.defaultContext(request);

      assert.equal(context.merchant_id, merchantId);
      assert.equal(context.user_id, auth.user_id);
      assert.equal(context.agent.agentName, "Maya");
      assert.equal(context.capabilities.machineToMachineNegotiation, true);
      assert.equal(context.checkout_settings.maxInterventionsPerSession, 4);
    } finally {
      await prisma.agentRule.deleteMany({ where: { merchantId } });
      await prisma.merchantRule.deleteMany({ where: { merchantId } });
      await prisma.merchantUser.deleteMany({ where: { merchantId } });
      await prisma.merchant.deleteMany({ where: { id: merchantId } });
      await prisma.$disconnect();
    }
  }
);
