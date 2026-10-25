import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideInterventions } from "./intervention-policy.service.js";

describe("decideInterventions", () => {
  const base = {
    proactiveEnabled: true,
    cooldownSeconds: 60,
    maxInterventionsPerSession: 3,
    nowUnix: 1000,
    triggerAgentFromScore: true,
    interventionCount: 0,
    lastInterventionUnix: null as number | null
  };

  it("allows first intervention when scoring allows", () => {
    assert.equal(decideInterventions(base).triggerAgent, true);
  });

  it("suppresses after max interventions", () => {
    const d = decideInterventions({ ...base, interventionCount: 3 });
    assert.equal(d.triggerAgent, false);
    assert.equal(d.suppressedReason, "max_interventions");
  });

  it("suppresses during cooldown window", () => {
    const d = decideInterventions({
      ...base,
      interventionCount: 1,
      lastInterventionUnix: 990,
      cooldownSeconds: 30
    });
    assert.equal(d.triggerAgent, false);
    assert.equal(d.suppressedReason, "cooldown_active");
  });

  it("allows after cooldown elapsed", () => {
    const d = decideInterventions({
      ...base,
      interventionCount: 1,
      lastInterventionUnix: 900,
      cooldownSeconds: 30
    });
    assert.equal(d.triggerAgent, true);
  });

  it("suppresses globally when proactive disabled", () => {
    const d = decideInterventions({ ...base, proactiveEnabled: false, triggerAgentFromScore: true });
    assert.equal(d.triggerAgent, false);
    assert.equal(d.suppressedReason, "proactive_disabled");
  });
});
