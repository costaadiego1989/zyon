import test from "node:test";
import assert from "node:assert/strict";
import { CartRecoveryController } from "../presentation/http/cart-recovery.controller.js";
import type { SendWhatsAppMessageInput, SendWhatsAppMessageResult } from "../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";

const request = { user: { merchantId: "merchant-a", userId: "owner-a", role: "owner" } };

function setup(result: SendWhatsAppMessageResult) {
  const inputs: SendWhatsAppMessageInput[] = [];
  type Dependencies = ConstructorParameters<typeof CartRecoveryController>;
  const router = {
    execute: async (input: SendWhatsAppMessageInput) => {
      inputs.push(input);
      return result;
    },
  };
  const controller = new CartRecoveryController(
    {} as Dependencies[0], {} as Dependencies[1], {} as Dependencies[2], router as Dependencies[3],
  );
  return { controller, inputs };
}

test("test-send routes through the authenticated merchant without inventing incentives", async () => {
  const { controller, inputs } = setup({ channel: "email", status: "sent", messageId: "email-id" });
  await controller.testSend(request, {
    phone: "  +5511999999999  ",
    email: "  owner@example.test  ",
    strategy: "offer_coupon",
    coupon_code: "UNVERIFIED",
    rule_id: "rule-from-another-merchant",
    ...{ merchantId: "merchant-b", type: "order_update", template: "unapproved", message: "freeform bypass" },
  });
  assert.equal(inputs.length, 1);
  const input = inputs[0]!;
  assert.equal(input.merchantId, "merchant-a");
  assert.equal(input.type, "cart_recovery");
  assert.equal(input.toPhone, "+5511999999999");
  assert.equal(input.fallbackEmail, "owner@example.test");
  assert.deepEqual(Object.keys(input.variables ?? {}), ["link"]);
  assert.match(input.freeformText ?? "", /teste/i);
  assert.doesNotMatch(JSON.stringify(input), /UNVERIFIED|VOLTA10|freeform bypass|rule-from-another-merchant|merchant-b|48 horas|amanhã/);
});

for (const result of [
  { channel: "whatsapp_template", status: "sent", messageId: "whatsapp-id" },
  { channel: "email", status: "sent", messageId: "email-id" },
  { channel: "none", status: "skipped", reason: "no_reachable_channel" },
  { channel: "whatsapp_template", status: "failed", reason: "twilio_400" },
  { channel: "whatsapp_template", status: "uncertain", reason: "provider_acceptance_unknown" },
  { channel: "email", status: "uncertain", reason: "provider_acceptance_unknown" },
] satisfies SendWhatsAppMessageResult[]) {
  test(`test-send preserves ${result.channel}/${result.status} instead of treating HTTP success as delivery`, async () => {
    const { controller, inputs } = setup(result);
    const response = await controller.testSend(request, { phone: "+5511999999999", email: "owner@example.test" });
    assert.equal(inputs.length, 1);
    assert.equal(response.sent, result.status === "sent");
    assert.equal(response.channel, result.channel);
    assert.equal(response.status, result.status);
    assert.equal(response.reason, "reason" in result ? result.reason : undefined);
    assert.equal(response.messageId, "messageId" in result ? result.messageId : undefined);
  });
}

test("test-send permits email-only fallback and leaves absent recipients to the shared policy", async () => {
  const { controller, inputs } = setup({ channel: "none", status: "skipped", reason: "no_reachable_channel" });
  await controller.testSend(request, { phone: "  ", email: "owner@example.test" });
  assert.equal(inputs[0]?.toPhone, undefined);
  assert.equal(inputs[0]?.fallbackEmail, "owner@example.test");
  const empty = await controller.testSend(request, {});
  assert.equal(empty.sent, false);
  assert.equal(empty.status, "skipped");
});

test("test-send requires authenticated tenant context before routing", async () => {
  const { controller, inputs } = setup({ channel: "email", status: "sent", messageId: "email-id" });
  await assert.rejects(controller.testSend({}, { email: "owner@example.test" }), /missing_authenticated_user/);
  assert.equal(inputs.length, 0);
});
