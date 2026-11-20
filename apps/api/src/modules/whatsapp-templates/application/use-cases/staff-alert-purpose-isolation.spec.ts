import assert from "node:assert/strict";
import test from "node:test";
import { SendWhatsAppMessageUseCase } from "./send-whatsapp-message.use-case.js";

test("HUM-10 a generic sales request cannot send the private staff purpose through WhatsApp, Bubble or email", async () => {
  const calls: string[] = [];
  const denied = (name: string) => async () => { calls.push(name); throw Error("private purpose must not use " + name); };
  const useCase = new SendWhatsAppMessageUseCase({ findByMerchantAndType: denied("template-read") } as never,
    { sendTemplate: denied("template-send") }, { send: denied("bubble") } as never,
    { send: denied("email") } as never, { findByMerchantId: denied("config-read") } as never);
  assert.deepEqual(await useCase.execute({ merchantId: "merchant-a", type: "support_case_alert", toPhone: "+5511999991111",
    fallbackEmail: "synthetic@example.test", freeformText: "Private notice", variables: { storeName: "Synthetic store", dashboardLink: "https://app.example.test/#whatsapp-seller?tab=conversations&ticketId=opaque" } }),
  { channel: "none", status: "skipped", reason: "private_staff_alert_required" });
  assert.deepEqual(calls, []);
});
