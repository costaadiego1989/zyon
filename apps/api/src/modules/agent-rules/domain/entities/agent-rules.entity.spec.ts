import test from "node:test";
import assert from "node:assert/strict";
import { AgentRulesEntity } from "./agent-rules.entity.js";

test("AgentRulesEntity creates safe user-specific defaults", () => {
  const rules = AgentRulesEntity.createDefault({
    merchantId: "mrc_1",
    userId: "usr_1",
    now: new Date("2026-05-01T12:00:00.000Z")
  }).snapshot();

  assert.equal(rules.scope, "user_agent");
  assert.equal(rules.agentId, "agt_usr_1");
  assert.equal(rules.identity.agentName, "Zion");
  assert.equal(rules.guardrails.forbidUnauthorizedDiscounts, true);
  assert.equal(rules.capabilities.machineToMachineNegotiation, false);
});

test("AgentRulesEntity updates identity, capabilities, guardrails, and checkout settings", () => {
  const updated = AgentRulesEntity.createDefault({ merchantId: "mrc_1", userId: "usr_1" }).update({
    identity: { agentName: "Apollo", tone: "direct" },
    capabilities: { machineToMachineNegotiation: true },
    guardrails: { blockedPhrases: ["garantido"] },
    checkoutSettings: { cooldownSeconds: 60 }
  }).snapshot();

  assert.equal(updated.identity.agentName, "Apollo");
  assert.equal(updated.identity.tone, "direct");
  assert.equal(updated.capabilities.machineToMachineNegotiation, true);
  assert.deepEqual(updated.guardrails.blockedPhrases, ["garantido"]);
  assert.equal(updated.checkoutSettings.cooldownSeconds, 60);
});
