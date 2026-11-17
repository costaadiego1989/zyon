import assert from "node:assert/strict";
import test from "node:test";
import { storefrontIntentOutputSchema, storefrontIntentJsonSchema } from "./storefront-intent.schemas.js";
import { storefrontIntentPromptV1 } from "../prompts/storefront-intent.v1.js";

test("T71 service request classification is explicit for new models and accepts historical V2 classifications", () => {
  const old = { schemaVersion: 2, domain: "STORE_SUPPORT", intent: "COMPLEX_QUESTION", confidence: 0.99,
    requiresTool: true, needsProductDiscovery: false, shoppingPhase: null };
  assert.equal(storefrontIntentOutputSchema.safeParse(old).success, true);
  assert.ok(storefrontIntentJsonSchema.required.includes("serviceRequest"));
  for (const serviceRequest of ["informational", "live_facts", "professional_decision", null]) {
    assert.equal(storefrontIntentOutputSchema.safeParse({ ...old, serviceRequest }).success, true);
  }
  assert.equal(storefrontIntentOutputSchema.safeParse({ ...old, serviceRequest: "diagnose" }).success, false);
});

test("T71 service examples separate current availability, published preparation and individual decision", () => {
  const kinds = new Set<string>();
  for (const example of storefrontIntentPromptV1.examples) {
    const value = storefrontIntentOutputSchema.parse(example.output);
    assert.ok(Object.hasOwn(example.output, "serviceRequest"));
    if (value.serviceRequest) kinds.add(value.serviceRequest);
  }
  assert.deepEqual(kinds, new Set(["informational", "live_facts", "professional_decision"]));
});
