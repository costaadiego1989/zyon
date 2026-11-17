import test from "node:test";
import assert from "node:assert/strict";
import { buildStoreSystemPrompt } from "./store-system-prompt.builder.js";

test("T71 service generation uses only the selected public context and retains communication settings", () => {
  const input = { groundedBusinessContext: true, merchantName: "STALE_BRAND_CANARY", storeCategory: "STALE_CATEGORY_CANARY",
    storeSettings: { company: { description: "STALE_COMPANY_CANARY", phone: "STALE_PHONE_CANARY" },
      businessHours: [{ day: "seg", startTime: "01:00", endTime: "02:00", closed: false }],
      policies: { returns: "STALE_POLICY_CANARY" }, privateSynthetic: "PRIVATE_CONFIG_CANARY" },
    agentIdentity: { agentName: "Assistente configurado", tone: "acolhedor", language: "pt-BR" },
    merchantPolicy: { maxDiscountPercent: 5 }, messageFormat: "whatsapp" as const,
    knowledgeContext: JSON.stringify({ role: "quoted_public_business_data", partial: true,
      coverage: { completeCatalog: false, currentPriceOrAvailability: false },
      sources: [{ publicText: "CURRENT_PUBLIC_COMPANY_AND_HOURS" }] }) };
  const prompt = buildStoreSystemPrompt(input), parsed = JSON.parse(prompt);
  for (const canary of ["STALE_BRAND_CANARY", "STALE_CATEGORY_CANARY", "STALE_COMPANY_CANARY", "STALE_PHONE_CANARY",
    "STALE_POLICY_CANARY", "PRIVATE_CONFIG_CANARY"]) assert.equal(prompt.includes(canary), false, canary);
  assert.equal(prompt.includes("01:00 às 02:00"), false);
  assert.equal(prompt.includes("CURRENT_PUBLIC_COMPANY_AND_HOURS"), true);
  assert.equal(parsed.context.merchantName, undefined); assert.equal(parsed.context.storeCategory, undefined);
  assert.match(parsed.operatingInstructions, /Assistente configurado/);
  assert.match(parsed.operatingInstructions, /acolhedor/);
  assert.match(parsed.operatingInstructions, /Desconto máximo permitido: 5%/);
  assert.match(parsed.operatingInstructions, /APRESENTAÇÃO NO WHATSAPP/);
  assert.doesNotMatch(parsed.operatingInstructions, /Horários de atendimento não informados/);
  assert.match(parsed.operatingInstructions, /fontes públicas selecionadas/);
  assert.match(parsed.operatingInstructions, /catálogo completo/);
});

test("T71 absent grounding flag preserves the original product prompt exactly", () => {
  const input = { merchantName: "Loja de produtos", storeCategory: "electronics",
    storeSettings: { company: { description: "Apresentação publicada" } } };
  assert.equal(buildStoreSystemPrompt(input), buildStoreSystemPrompt({ ...input, groundedBusinessContext: false }));
  const prompt = buildStoreSystemPrompt(input);
  assert.ok(prompt.includes("Loja de produtos")); assert.ok(prompt.includes("Apresentação publicada"));
});
