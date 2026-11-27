import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "./template-catalog.js";
import { staffTemplateSnapshot } from "../../../support/domain/support-case-alert.js";
import { SendWhatsAppMessageUseCase } from "../../application/use-cases/send-whatsapp-message.use-case.js";

test("the generated staff alert satisfies the private guard with exactly storeName and dashboardLink slots", () => {
  const definition = buildCatalog("Loja Exemplo").support_case_alert;
  assert.equal(definition.category, "UTILITY");
  assert.equal(definition.hasCoupon, false);
  assert.deepEqual(definition.variableMap, { "1": "storeName", "2": "dashboardLink" });
  assert.deepEqual(Object.keys(definition.sampleVariables).sort(), ["1", "2"]);
  assert.equal(definition.sampleVariables["1"], "Loja Exemplo");
  assert.ok(definition.sampleVariables["2"]?.startsWith("https://"));
  const now = new Date("2026-11-27T12:00:00.000Z");
  const snapshot = staffTemplateSnapshot({
    id: "staff-template-a", merchantId: "merchant-a", type: definition.type, channel: "whatsapp",
    isActive: true, metaStatus: "approved", metaWabaId: "waba-a", metaCategory: definition.category,
    metaLanguage: definition.language, metaRevision: 1, twilioContentSid: "staff_alert_a",
    metaTemplateBody: definition.metaBody, metaVariableMap: definition.variableMap, metaLastCheckedAt: now,
  }, "merchant-a", "waba-a", now);
  assert.ok(snapshot, "the catalog must satisfy the existing private sender contract without relaxing its guard");
  assert.deepEqual(snapshot.variableMap, { "1": "storeName", "2": "dashboardLink" });
});

test("generic sales refuses the staff purpose before any template, connection, WhatsApp or email access", async () => {
  const accessed: string[] = [];
  const denied = (dependency: string) => () => {
    accessed.push(dependency);
    throw new Error("private_staff_purpose_reached_generic_dependency");
  };
  const useCase = new SendWhatsAppMessageUseCase(
    { findByMerchantAndType: denied("templates") } as never,
    { sendTemplate: denied("templateSender") } as never,
    { sendMessage: denied("bubbleSender") } as never,
    { send: denied("email") } as never,
    { findByMerchantId: denied("configRepo") } as never,
  );
  const result = await useCase.execute({
    merchantId: "merchant-a", type: "support_case_alert", toPhone: "+5511999991111",
    fallbackEmail: "staff@example.test", freeformText: "A private staff alert must not reach generic sales.",
  });
  assert.deepEqual(result, { channel: "none", status: "skipped", reason: "private_staff_alert_required" });
  assert.deepEqual(accessed, []);
});
