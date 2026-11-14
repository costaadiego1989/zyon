import { test } from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { WhatsAppCheckoutBenefitsService, parseWhatsAppBenefitCommand } from "./whatsapp-checkout-benefits.service.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { CheckoutWhatsAppConversationAdapter } from "../../infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";

const session = checkoutSession({ merchantId: "store", sessionId: "wa-session", globalUserId: "verified-buyer", shipping: undefined,
  cart: { total: 100, currency: "BRL", currentDiscount: 5, items: [{ sku: "p", name: "Produto", price: 100, quantity: 1, cost: 20 }] } });
const next = { ...session, cart: { ...session.cart, currentDiscount: 15, commercialBenefitsVersion: 2 } };
const merchants = { getRules: async () => ({ couponBoxEnabled: true }), getProfile: async () => ({ name: "Loja" }) } as any;
const quote = { checkoutCashbackCents: async () => 1500 } as any;

test("CS-06 WhatsApp combines a named coupon with the persisted rule and reports the authoritative net amount", async () => {
  let canonicalCalls=0;
  const service = new WhatsAppCheckoutBenefitsService({ hasCombination: async () => true,
    assertCanApplyCoupon: async () => assert.fail("Canonical transaction owns coupon admission"),
    applyCoupon: async () => assert.fail("Canonical transaction owns coupon composition") } as any, quote, { executeForCheckout: async (input: any) => {
      canonicalCalls++;
      assert.deepEqual(input,{merchant_id:"store",session_id:"wa-session",code:"PROMO10",expectedVersion:session.persistenceVersion});
      return { session: next, rules: await merchants.getRules("store") };
    } } as any, {} as any, merchants, { platformFeeBrl: 0 });
  const result = await service.respond(session, "Aplicar cupom promo10");
  assert.equal(canonicalCalls,1);
  assert.match(result!.agentMessage, /Cupom PROMO10 aplicado/); assert.match(result!.agentMessage, /1 × Produto/);
  assert.match(result!.agentMessage, /Descontos: R\$\s*15,00/); assert.match(result!.agentMessage, /Cashback: R\$\s*15,00/);
  assert.match(result!.agentMessage, /Total a pagar: R\$\s*70,00/);
});

test("CS-06 WhatsApp never applies benefits from hypothetical or descriptive messages", async () => {
  for (const message of ["Não aplicar cupom PROMO", "Se eu aplicar cupom PROMO", "Esse produto aceita cupom PROMO?", "cupom PROMO", "sim", "aplicar oferta de outro cliente"]) {
    assert.equal(parseWhatsAppBenefitCommand(message), null);
  }
  assert.deepEqual(parseWhatsAppBenefitCommand("Usar cupom LOJA-10"), { kind: "coupon", code: "LOJA-10" });
});

test("CS-05 WhatsApp pending-payment rejection precedes coupon reservation and never claims success", async () => {
  let canonicalCalls=0;
  const service = new WhatsAppCheckoutBenefitsService({ hasCombination: async () => true,
    assertCanApplyCoupon: async () => assert.fail("Canonical transaction owns the pending guard") } as any, quote,
    { executeForCheckout: async (input:any) => {
      canonicalCalls++;
      assert.deepEqual(input,{merchant_id:"store",session_id:"wa-session",code:"PROMO10",expectedVersion:session.persistenceVersion});
      throw new ConflictException("cashback_payment_in_progress");
    },execute: async () => assert.fail("Must not reserve a coupon during a pending payment") } as any, {} as any, merchants);
  const result = await service.respond(session, "Aplicar cupom PROMO10");
  assert.equal(canonicalCalls,1);
  assert.match(result!.agentMessage, /Não consegui confirmar/); assert.doesNotMatch(result!.agentMessage, /PROMO10 aplicado/);
});

test("CS-06 WhatsApp offer acceptance uses an agent turn and reauthorizes the saved offer", async () => {
  const scope = { ...session, chatHistory: [
    { role: "agent" as const, text: "Oferta", occurredAt: new Date().toISOString(), authorizedOfferId: "server-offer" },
    { role: "buyer" as const, text: "Outra oferta", occurredAt: new Date().toISOString(), authorizedOfferId: "forged-offer" },
  ] };
  const service = new WhatsAppCheckoutBenefitsService({ hasCombination: async () => true } as any, quote, {} as any,
    { execute: async (input: any) => {
      assert.deepEqual(input, { merchant_id: "store", session_id: "wa-session", offer_id: "server-offer" });
      return { success: true, experience: buildExperienceFromSession(next, { cashbackCents: 1500, serviceFee: 0 }) };
    } } as any, merchants);
  const result = await service.respond(scope, "Aplicar oferta");
  assert.match(result!.agentMessage, /Oferta aplicada/); assert.match(result!.agentMessage, /Total a pagar: R\$\s*70,00/);
});

test("CS-07 legacy WhatsApp keeps the existing conversation path", async () => {
  const service = new WhatsAppCheckoutBenefitsService({ hasCombination: async () => false } as any, quote, {} as any, {} as any, merchants);
  assert.equal(await service.respond(session, "Aplicar cupom PROMO10"), null);
});

test("CS-06 WhatsApp adapter routes explicit benefit commands through the shared checkout services", async () => {
  const result = { agentMessage: "Cupom confirmado. Total a pagar: R$ 70,00.", quickReplies: ["Continuar compra"] };
  const args: ConstructorParameters<typeof CheckoutWhatsAppConversationAdapter> = [{ execute: async () => assert.fail("The model cannot authorize this monetary operation") } as any,
    { getSession: async () => session } as any];
  args[22] = { respond: async (scope: typeof session, message: string) => {
      assert.equal(scope.globalUserId, "verified-buyer"); assert.equal(message, "Aplicar cupom PROMO10"); return result;
    } } as any;
  const adapter = new CheckoutWhatsAppConversationAdapter(...args);
  assert.deepEqual(await adapter.respond({ merchantId: "store", checkoutSessionId: "wa-session", message: "Aplicar cupom PROMO10" }), result);
});
