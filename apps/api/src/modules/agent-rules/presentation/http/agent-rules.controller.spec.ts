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
    capabilities: { machineToMachineNegotiation: true }
  } as unknown as Parameters<typeof controller.updateDefault>[1]);
  const context = await controller.defaultContext(request);

  assert.equal(updated.identity.agentName, "Clara Prime");
  assert.equal(context.agent.agentName, "Clara Prime");
  assert.equal(context.capabilities.machineToMachineNegotiation, true);
});

test("merchant channel settings are shared by admins and isolated from other merchants and named agents", async () => {
  const repo = new InMemoryAgentRulesRepository();
  const controller = new AgentRulesController(new GetAgentRulesUseCase(repo), new UpdateAgentRulesUseCase(repo), new GetAgentContextUseCase(repo, { getContext: async () => undefined }));
  const request = (merchantId: string, userId: string) => ({ user: { merchantId, userId, email: "admin@example.com", role: "admin" as const } });
  await controller.updateDefault(request("m1", "u1"), { identity: { agentName: "Shared" } } as never);
  await controller.updateAgent(request("m1", "u1"), "private-agent", { identity: { agentName: "Named" } } as never);
  assert.equal((await controller.defaultRules(request("m1", "u2"))).identity.agentName, "Shared");
  assert.equal((await controller.defaultRules(request("m1", "u2"))).scope, "merchant_default");
  assert.notEqual((await controller.defaultRules(request("m2", "u1"))).identity.agentName, "Shared");
  assert.equal((await controller.byAgent(request("m1", "u2"), "private-agent")).identity.agentName, "Named");
});
