import test from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { AcpMutabilityPolicy } from "./acp-mutability.policy.js";
import type { AcpStatusPolicy } from "./acp-status.policy.js";
import type { AcpDerivedStatus } from "./acp-status.policy.js";

function buildSession(): CheckoutSession {
  return {
    merchantId: "mrc_test",
    sessionId: "chk_test",
    globalUserId: "g_test",
    conversationId: "conv_test",
    cart: { currency: "BRL", total: 0, items: [] },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
  };
}

function policyWithStatus(status: AcpDerivedStatus): AcpMutabilityPolicy {
  const statusPolicy = {
    async derive() {
      return status;
    },
  } as unknown as AcpStatusPolicy;
  return new AcpMutabilityPolicy(statusPolicy);
}

test("mutability: throws ConflictException on completed", async () => {
  const policy = policyWithStatus("completed");
  await assert.rejects(
    () => policy.assertMutable(buildSession()),
    (err: unknown) =>
      err instanceof ConflictException &&
      (err.getResponse() as { code: string }).code === "acp_session_completed",
  );
});

test("mutability: throws ConflictException on canceled", async () => {
  const policy = policyWithStatus("canceled");
  await assert.rejects(
    () => policy.assertMutable(buildSession()),
    (err: unknown) =>
      err instanceof ConflictException &&
      (err.getResponse() as { code: string }).code === "acp_session_canceled",
  );
});

test("mutability: resolves silently on pending", async () => {
  const policy = policyWithStatus("pending");
  await policy.assertMutable(buildSession());
});

test("mutability: resolves silently on awaiting_payment", async () => {
  const policy = policyWithStatus("awaiting_payment");
  await policy.assertMutable(buildSession());
});
