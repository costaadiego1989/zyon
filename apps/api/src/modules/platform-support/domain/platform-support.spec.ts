import assert from "node:assert/strict";
import test from "node:test";
import { BILLING_PLANS } from "@zyon/shared-types";
import { supportBody } from "../presentation/platform-support.controller.js";
import { hasPlatformPermission, PLATFORM_OPERATOR_ROLES } from "../../platform-control/domain/platform-operator.js";
import { PlatformSupportRateLimiter } from "../infrastructure/platform-support-rate-limiter.js";

test("Growth includes live support; Escala alone has priority; other plans retain feedback", () => {
  assert.equal(BILLING_PLANS.growth.features.realtimeChatSupport, true);
  assert.equal(BILLING_PLANS.growth.features.prioritySupport, false);
  assert.equal(BILLING_PLANS.scale.features.realtimeChatSupport, true);
  assert.equal(BILLING_PLANS.scale.features.prioritySupport, true);
  for (const plan of ["starter", "starter179"] as const) assert.equal(BILLING_PLANS[plan].features.realtimeChatSupport, false);
});

test("only designated platform operators can read or write technical conversations", () => {
  for (const role of PLATFORM_OPERATOR_ROLES) {
    const allowed = role === "platform_admin" || role === "support_ops";
    assert.equal(hasPlatformPermission(role, "platform:support:read"), allowed);
    assert.equal(hasPlatformPermission(role, "platform:support:write"), allowed);
  }
});

test("command allowlists reject tenant, tier, sender and internal-note injection", () => {
  for (const field of ["merchantId", "tier", "sender", "note", "severity"]) assert.throws(() => supportBody({ content: "Olá", clientMessageId: "one", [field]: "injected" }, ["content", "clientMessageId"]), /support_invalid_body/);
});

test("message limits are enforced per actor and independent of another merchant", async () => {
  const limiter = new PlatformSupportRateLimiter(null);
  for (let i = 0; i < 30; i++) await limiter.check("message:merchant:one", 30, 60_000);
  await assert.rejects(() => limiter.check("message:merchant:one", 30, 60_000), /support_rate_limited/);
  await limiter.check("message:merchant:two", 30, 60_000);
});
