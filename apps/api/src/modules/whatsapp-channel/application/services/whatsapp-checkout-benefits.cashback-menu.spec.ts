import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppCheckoutBenefitsService } from "./whatsapp-checkout-benefits.service.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";

const session = checkoutSession({ merchantId: "shop", globalUserId: "canonical" });
const merchants: any = { getRules: async () => ({}), getProfile: async () => ({ name: "Loja" }) };

for (const enabled of [true, false, "unavailable"] as const) for (const outcome of ["coupon", "offer", "missing_offer", "error"] as const) {
  test(`CB-MENU-04 ${outcome} benefit choices advertise cashback only when enabled=${enabled}`, async () => {
    const scope = outcome === "offer" ? { ...session, chatHistory: [{ role: "agent" as const, text: "Oferta",
      occurredAt: new Date().toISOString(), authorizedOfferId: "offer" }] } : session;
    const service = new WhatsAppCheckoutBenefitsService({ hasCombination: async () => true } as any,
      { isProgramEnabled: async (id: string) => { assert.equal(id, "shop"); if (enabled === "unavailable") throw new Error("unavailable"); return enabled; },
        checkoutCashbackCents: async () => 0 } as any,
      { executeForCheckout: async () => { if (outcome === "error") throw new Error("canonical rejection"); return { session }; } } as any,
      { execute: async () => ({ success: true, experience: buildExperienceFromSession(session) }) } as any, merchants);
    const response = await service.respond(scope, outcome === "offer" || outcome === "missing_offer" ? "Aplicar oferta" : "Aplicar cupom PROMO");
    assert.ok(response);
    assert.equal(response.quickReplies.some(label => /cashback/i.test(label)), enabled === true);
    assert.ok(response.quickReplies.includes("Continuar compra"));
  });
}
