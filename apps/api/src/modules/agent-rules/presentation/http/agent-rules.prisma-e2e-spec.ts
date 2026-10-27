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
  "Prisma agent rules persist separate merchant defaults and isolated user-agent context",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma agent-rules e2e tests." },
  async () => {
    const prisma = createPrismaClient();
    const authRepository = new PrismaAuthRepository(prisma);
    const jwt = new JwtService("test-secret", 3600, authRepository);
    const merchantRepository = new PrismaMerchantRepository(prisma);
    const register = new RegisterMerchantUseCase(
      authRepository,
      new PasswordHasher(),
      jwt,
      new DefaultMerchantIdGenerator()
    );
    const repository = new PrismaAgentRulesRepository(prisma);
    const noopCheckoutPort = { async getContext() { return undefined; } } as const;
    const getRules = new GetAgentRulesUseCase(repository);
    const updateRules = new UpdateAgentRulesUseCase(repository);
    const getContext = new GetAgentContextUseCase(repository, noopCheckoutPort);
    const controller = new AgentRulesController(getRules, updateRules, getContext);

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

      // Direct controller invocation exercises its default-tenant routing, not
      // Nest HTTP ValidationPipe execution. User context uses its real use-cases.
      const dto = {
        identity: { agentName: "Maya" },
        capabilities: { machineToMachineNegotiation: true },
        checkoutSettings: { maxInterventionsPerSession: 4 }
      } as unknown as AgentRulesPatchDto;
      await controller.updateDefault(request, {
        identity: { agentName: "Shared agent" },
        capabilities: { machineToMachineNegotiation: false },
        checkoutSettings: { maxInterventionsPerSession: 2 }
      } as unknown as AgentRulesPatchDto);
      const sharedContext = await controller.defaultContext(request);
      assert.equal(sharedContext.merchant_id, merchantId);
      assert.equal(sharedContext.agent_id, "default");
      assert.equal(sharedContext.user_id, undefined);
      assert.equal(sharedContext.agent.agentName, "Shared agent");
      assert.equal((await controller.defaultRules(request)).scope, "merchant_default");

      const principal = { merchantId, userId: auth.user_id };
      const privateRules = await updateRules.execute(principal, dto);
      assert.equal(privateRules.scope, "user_agent");
      assert.equal(privateRules.userId, auth.user_id);
      const context = await getContext.execute(principal);

      assert.equal(context.merchant_id, merchantId);
      assert.equal(context.user_id, auth.user_id);
      assert.equal(context.agent.agentName, "Maya");
      assert.equal(context.capabilities.machineToMachineNegotiation, true);
      assert.equal(context.checkout_settings.maxInterventionsPerSession, 4);
      const otherUserId = `other_${crypto.randomUUID()}`;
      assert.equal(await repository.getDefault(merchantId, otherUserId), undefined);
      assert.equal(await repository.getDefault(`${merchantId}_other`, auth.user_id), undefined);
      const otherContext = await getContext.execute({ merchantId, userId: otherUserId });
      assert.equal(otherContext.user_id, otherUserId);
      assert.equal(otherContext.agent.agentName, "Zion");
      assert.equal(otherContext.capabilities.machineToMachineNegotiation, false);
      assert.equal((await controller.defaultContext(request)).agent.agentName, "Shared agent");
      assert.equal(await prisma.agentRule.count({ where: { merchantId, scope: "merchant_default", userId: null } }), 1);
      assert.equal(await prisma.agentRule.count({ where: { merchantId, scope: "user_agent", userId: auth.user_id } }), 1);
    } finally {
      await prisma.agentRule.deleteMany({ where: { merchantId } });
      await prisma.merchantRule.deleteMany({ where: { merchantId } });
      await prisma.merchantUser.deleteMany({ where: { merchantId } });
      await prisma.merchant.deleteMany({ where: { id: merchantId } });
      await prisma.$disconnect();
    }
  }
);
