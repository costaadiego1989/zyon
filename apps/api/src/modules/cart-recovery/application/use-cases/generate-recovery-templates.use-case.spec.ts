import test from "node:test";
import assert from "node:assert/strict";
import { GenerateRecoveryTemplatesUseCase } from "./generate-recovery-templates.use-case.js";

const valid = {
  email: { subject: "{{storeName}} | Vamos continuar?", body: "Olá, {{buyerName}}! Sua escolha na {{storeName}} espera por você. Revise seu carrinho: {{link}}. Até breve!" },
  whatsapp: { body: "Olá, {{buyerName}}! Aqui é da {{storeName}}. Quer revisar seu carrinho? Acesse {{link}} e continue no seu tempo." },
};

function setup(reply: unknown = valid) {
  const merchants: string[] = [];
  const messages: unknown[] = [];
  const useCase = new GenerateRecoveryTemplatesUseCase(
    { async complete(input) { messages.push(input); return reply === null ? null : JSON.stringify(reply); } },
    { async getProfile(id: string) { merchants.push(id); return { name: "Athom" }; } } as ConstructorParameters<typeof GenerateRecoveryTemplatesUseCase>[1],
  );
  return { useCase, merchants, messages };
}

test("generates a draft for the authenticated store without approval or revision claims", async () => {
  const { useCase, merchants, messages } = setup({ ...valid, status: "approved", merchantId: "other", whatsapp: { ...valid.whatsapp, revision: 999 } });
  assert.deepEqual(await useCase.execute("merchant-a"), { source: "ai", ...valid });
  assert.deepEqual(merchants, ["merchant-a"]);
  // Personalization is resolved at send time; real store/customer data is unnecessary for drafting.
  assert.match(JSON.stringify(messages), /\{\{storeName\}\}/);
  assert.doesNotMatch(JSON.stringify(messages), /Athom/);
});

test("refuses unsupported placeholders, links, unsafe offers and invalid Meta variables", async () => {
  for (const body of [
    "Olá {{buyerName}}! {{storeName}}: {{link}} {{coupon}}. Até breve!",
    "Olá {{buyerName}}! {{storeName}}: https://other.example {{link}}. Até breve!",
    "Olá {{buyerName}}! {{storeName}}: ganhe 10% de desconto em {{link}}. Até breve!",
    "{{buyerName}}, confira {{storeName}}: {{link}}. Até breve!",
    "Olá {{buyerName}}{{storeName}}: {{link}}. Até breve!",
    "Olá {{buyerName}}! {{storeName}}: {{link}}",
    "Olá {{buyerName}}! {{storeName}}: {{link}} " + "x".repeat(1024),
  ]) {
    const { useCase } = setup({ ...valid, whatsapp: { body } });
    await assert.rejects(() => useCase.execute("merchant-a"), /recovery_template_generation_unavailable/);
  }
});

test("does not label deterministic fallback or malformed output as AI", async () => {
  for (const reply of [null, [], "not json", { ...valid, email: { ...valid.email, subject: "Loja desconhecida" } }]) {
    await assert.rejects(() => setup(reply).useCase.execute("merchant-a"), /recovery_template_generation_unavailable/);
  }
});

test("missing merchant cannot invoke the provider", async () => {
  let called = false;
  const useCase = new GenerateRecoveryTemplatesUseCase(
    { async complete() { called = true; return JSON.stringify(valid); } },
    { async getProfile() { return undefined; } } as unknown as ConstructorParameters<typeof GenerateRecoveryTemplatesUseCase>[1],
  );
  await assert.rejects(() => useCase.execute("missing"), /merchant_not_found/);
  assert.equal(called, false);
});
