import test from "node:test";
import assert from "node:assert/strict";
import { emitJourneyLifecycle, parseJourneyLifecycleLine } from "./storefront-journey-lifecycle.mjs";

test("lifecycle progress contains only fixed technical stages, not payload or credentials", () => {
  const lines = [];
  for (const stage of ["scope", "edit", "app_close", "redis_close"]) {
    emitJourneyLifecycle(stage, "start", line => lines.push(line));
    emitJourneyLifecycle(stage, "completed", line => lines.push(line));
  }
  assert.equal(lines.length, 8);
  assert.deepEqual(parseJourneyLifecycleLine(lines[4]), { stage: "app_close", event: "start" });
  assert.throws(() => emitJourneyLifecycle("private prompt", "start", () => assert.fail()));
  assert.equal(parseJourneyLifecycleLine('JOURNEY_LIFECYCLE {"stage":"edit","event":"failed","token":"private"}'), undefined);
  assert.equal(parseJourneyLifecycleLine('JOURNEY_LIFECYCLE {"stage":"edit","event":"private response"}'), undefined);
  assert.equal(parseJourneyLifecycleLine("unrelated application log"), undefined);
  assert.equal(parseJourneyLifecycleLine(`JOURNEY_LIFECYCLE ${" ".repeat(600)}`), undefined);
});
