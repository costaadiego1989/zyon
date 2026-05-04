import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAgentRulesRepository } from "../../infrastructure/in-memory-agent-rules.repository.js";
import {
  GetAgentContextUseCase,
  GetAgentRulesUseCase,
  UpdateAgentRulesUseCase
} from "../../application/agent-rules.use-cases.js";
import { AgentRulesController } from "./agent-rules.controller.js";

test("AgentRulesController manages authenticated user's agent rules", async () => {
  const repository = new InMemoryAgentRulesRepository();
  const controller = new AgentRulesController(
    new GetAgentRulesUseCase(repository),
    new UpdateAgentRulesUseCase(repository),
    new GetAgentContextUseCase(repository)
  );
  const request = { user: { userId: "usr_1", merchantId: "mrc_1", email: "owner@example.com", role: "owner" } };

  const updated = await controller.updateDefault(request, {
    identity: { agentName: "Clara Prime" },
    capabilities: { machineToMachineNegotiation: true }
  });
  const context = await controller.defaultContext(request);

  assert.equal(updated.identity.agentName, "Clara Prime");
  assert.equal(context.agent.agentName, "Clara Prime");
  assert.equal(context.capabilities.machineToMachineNegotiation, true);
});
