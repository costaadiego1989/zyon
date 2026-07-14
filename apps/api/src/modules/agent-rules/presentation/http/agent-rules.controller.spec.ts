import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAgentRulesRepository } from "../../infrastructure/in-memory-agent-rules.repository.js";
import type { CheckoutSettingsContextPort } from "../../domain/ports/checkout-settings-context.port.js";
import {
  GetAgentContextUseCase,
  GetAgentRulesUseCase,
  UpdateAgentRulesUseCase
} from "../../application/agent-rules.use-cases.js";
import { AgentRulesController } from "./agent-rules.controller.js";

test("AgentRulesController manages authenticated user's agent rules", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const noopCheckoutPort: CheckoutSettingsContextPort = { async getContext() { return undefined; } };
  const controller = new AgentRulesController(
    new GetAgentRulesUseCase(repository),
    new UpdateAgentRulesUseCase(repository),
    new GetAgentContextUseCase(repository, noopCheckoutPort)
  );
  const request = { user: { userId: "usr_1", merchantId: "mrc_1", email: "owner@example.com", role: "owner" as const } };

  const updated = await controller.updateDefault(request, {
    identity: { agentName: "Clara Prime" },
    capabilities: { machineToMachineNegotiation: true },
    hasAnySection: () => true
  } as unknown as Parameters<typeof controller.updateDefault>[1]);
  const context = await controller.defaultContext(request);

  assert.equal(updated.identity.agentName, "Clara Prime");
  assert.equal(context.agent.agentName, "Clara Prime");
  assert.equal(context.capabilities.machineToMachineNegotiation, true);
});
