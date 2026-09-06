import test from "node:test";
import assert from "node:assert/strict";
import type { EmailSenderPort, SendEmailInput, SendEmailOutput } from "../../domain/ports/email-sender.port.js";
import type { WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import { SendOrderConfirmationUseCase } from "./send-order-confirmation.use-case.js";
import { SendOrderShippedUseCase } from "./send-order-shipped.use-case.js";
import { SendOrderDeliveredUseCase } from "./send-order-delivered.use-case.js";
import { SendReturnApprovedUseCase } from "./send-return-approved.use-case.js";

class RecordingEmailSender implements EmailSenderPort {
  readonly inputs: SendEmailInput[] = [];

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    this.inputs.push(input);
    return { status: "sent", messageId: "provider-message-1" };
  }
}

const whatsapp: WhatsAppSenderPort = { async send() { return { status: "accepted" as const }; } };

test("transactional order and return emails require provider acceptance", async () => {
  const email = new RecordingEmailSender();

  await new SendOrderConfirmationUseCase(email, whatsapp).execute({
    type: "ORDER_CONFIRMATION", merchantId: "merchant-1", orderId: "order-1", orderNumber: "1001",
    buyerEmail: "buyer@example.test", items: [], total: "10.00",
  });
  await new SendOrderShippedUseCase(email, whatsapp).execute({
    type: "ORDER_SHIPPED", merchantId: "merchant-1", orderId: "order-1", buyerEmail: "buyer@example.test",
  });
  await new SendOrderDeliveredUseCase(email, whatsapp).execute({
    type: "ORDER_DELIVERED", merchantId: "merchant-1", orderId: "order-1", buyerEmail: "buyer@example.test",
  });
  await new SendReturnApprovedUseCase(email).execute({
    type: "RETURN_APPROVED", merchantId: "merchant-1", returnId: "return-1", orderId: "order-1",
    buyerEmail: "buyer@example.test",
  });

  assert.equal(email.inputs.length, 4);
  assert.deepEqual(email.inputs.map((input) => input.requireDelivery), [true, true, true, true]);
});
