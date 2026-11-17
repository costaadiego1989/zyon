import assert from "node:assert/strict";
import test from "node:test";
import { businessAnswerRequestSchema, businessAnswerPlanningPrompt } from "./business-answer-request.js";

test("T71 service planning admits only bounded read choices, never tenant or writer authority", () => {
  const choice = { productId: "service", professionalId: "professional", fromDate: "2026-11-18", toDate: "2026-11-19" };
  assert.deepEqual(businessAnswerRequestSchema.parse({ kind: "live_facts", liveRequests: [choice] }),
    { kind: "live_facts", liveRequests: [choice] });
  for (const bad of [{ kind: "live_facts", liveRequests: [] }, { kind: "informational", liveRequests: [choice] },
    { kind: "professional_decision", liveRequests: [choice] }, { kind: "live_facts", liveRequests: Array(4).fill(choice) },
    { kind: "live_facts", liveRequests: [{ ...choice, merchantId: "other" }] },
    { kind: "live_facts", liveRequests: [{ ...choice, holdOwner: "other" }] },
    { kind: "informational", liveRequests: [], cypher: "MATCH (n) DELETE n" }]) {
    assert.equal(businessAnswerRequestSchema.safeParse(bad).success, false);
  }
});

test("T71 generic planning distinguishes published information from individual regulated decisions", () => {
  const prompt = JSON.stringify(businessAnswerPlanningPrompt);
  assert.match(prompt, /professional_decision/);
  assert.match(prompt, /diagnóstico/);
  assert.match(prompt, /prescrição/);
  assert.match(prompt, /informational/);
  assert.match(prompt, /dados não confiáveis/);
  assert.doesNotMatch(prompt, /Athom|Núcleo|neurologia|salão|consultoria/);
  assert.deepEqual(businessAnswerRequestSchema.parse({ kind: "professional_decision", liveRequests: [] }),
    { kind: "professional_decision", liveRequests: [] });
});
