import test from "node:test";
import assert from "node:assert/strict";
import { resolveTemplateEmailBody, resolveTemplateEmailSubject, POST_SALE_EMAIL_BODIES } from "./email-template-copy.js";
import { salesDefaults } from "./sales-template-content.js";
import { WHATSAPP_TEMPLATE_TYPES } from "./catalog/template-types.js";

test("renewal subject stays correct when a merchant saved an order subject", () => {
  for (const type of WHATSAPP_TEMPLATE_TYPES.filter(type => type.startsWith("plan_expiry_"))) {
    assert.match(resolveTemplateEmailSubject(type, "Pedido confirmado", { storeName: "Loja" }), /Renovação/);
    assert.doesNotMatch(resolveTemplateEmailSubject(type, "Pedido confirmado"), /pedido/i);
  }
});

test("signed WhatsApp defaults become email copy without reply instructions", () => {
  for (const type of ["follow_up", "review_request", "nps"] as const) {
    const body = resolveTemplateEmailBody(type, salesDefaults(type).whatsapp.body);
    assert.equal(body, POST_SALE_EMAIL_BODIES[type]);
    assert.doesNotMatch(body, /responda|responder/i);
  }
});

test("previous WhatsApp defaults retain email copy after catalog changes", () => {
  const oldFollowUp = "Oi {{buyerName}}! 😊 Aqui é da {{storeName}}.\n\nSeu {{productName}} já chegou? Queremos saber se está tudo certo com o pedido!\n\nSe precisar de algo, é só responder aqui. Estamos à disposição! 💬";
  assert.equal(resolveTemplateEmailBody("follow_up", oldFollowUp), POST_SALE_EMAIL_BODIES.follow_up);
  const previousSignedLoyalty = "Olá, {{buyerName}}!\n\nAgradecemos por escolher a {{storeName}} novamente. Como reconhecimento pela sua fidelidade, liberamos a condição abaixo.\n\n{{couponBlock}}\n\nAtenciosamente,\n{{storeName}}";
  assert.equal(resolveTemplateEmailBody("loyalty", previousSignedLoyalty), POST_SALE_EMAIL_BODIES.loyalty);
});

test("merchant custom copy remains intact across the WhatsApp merge", () => {
  const custom = "Olá {{buyerName}}, fale com a nossa equipe pelo WhatsApp da loja.";
  assert.equal(resolveTemplateEmailBody("follow_up", custom), custom);
  assert.equal(resolveTemplateEmailSubject("follow_up", "Sua experiência com a Loja Especial"), "Sua experiência com a Loja Especial");
});
