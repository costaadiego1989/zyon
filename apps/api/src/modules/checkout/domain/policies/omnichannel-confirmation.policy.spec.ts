import test from "node:test";
import assert from "node:assert/strict";
import {
  OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL,
  planOmnichannelConfirmation
} from "./omnichannel-confirmation.policy.js";

test("below threshold: only in-app chat confirmation", () => {
  const plan = planOmnichannelConfirmation(OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL - 1);
  assert.deepEqual(plan.channels, ["chat"]);
  assert.equal(plan.whatsapp_ack_recommended, false);
});

test("at threshold: chat + whatsapp template recommended", () => {
  const plan = planOmnichannelConfirmation(OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL);
  assert.ok(plan.channels.includes("chat"));
  assert.ok(plan.channels.includes("whatsapp"));
  assert.equal(plan.whatsapp_ack_recommended, true);
});
