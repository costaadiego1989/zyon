import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { buildMetaUiView, presentMetaUi, withMetaCartNavigation, metaWelcomeMessage } from "../../domain/ui/meta-ui-renderer.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { deriveChatStage, missingFieldsForStage } from "../../../checkout/domain/services/customer-extraction.service.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import type { WhatsAppConversationState } from "../../domain/ui/meta-ui.types.js";
import { containsSharedCpf } from "../../domain/ui/meta-sensitive-input.js";

const options = [
  { carrier: "Correios", method: "PAC", carrierKey: "melhor-envio-1", customerPrice: 12.5, deliveryDays: 6 },
  { carrier: "Correios", method: "Sedex", carrierKey: "melhor-envio-2", customerPrice: 20, deliveryDays: 2 },
];
function fixture() {
  const session = checkoutSession({ shipping: undefined, customer: { fullName: "Pessoa Teste", email: "test@example.com", phone: "5521999999999", phone_verified: true } });
  const state: WhatsAppConversationState = { version: 1, conversationId: "conv_1", stage: "checkout", checkoutSessionId: "chk_1", history: [], previousViews: [], revision: "previous", page: 0 };
  let chatCalls = 0, storeCalls = 0, paymentCalls = 0;
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async () => { chatCalls++; return {
    message: "Mensagem", actions: [], experience: buildExperienceFromSession(session, {}) }; } } as any,
  { getSession: async () => session } as any,
  { execute: async () => { storeCalls++; throw Error("must_keep_checkout"); } } as any,
  { executeForMerchant: async () => ({ name: "Loja", agentTone: "direct" }) } as any,
  { getPaymentCapabilities: async () => ({ pix: true, card: true, providers: { card: "stripe", pix: "mercadopago" } }) } as any,
  { sign: () => "signed.token" } as any, undefined, undefined,
  { execute: async () => { paymentCalls++; return { id: "pix", status: "pending", amountCents: 31250, buyerFacing: { qrCodeCopyPaste: "000201PIX-UNCHANGED", invoiceUrl: "https://pay.example.com/pix" } }; } } as any,
  { execute: async () => ({ status: "pending" }) } as any);
  return { session, state, adapter, counts: () => ({chatCalls, storeCalls, paymentCalls}), send: (message: string, action?: any, current = state) => adapter.respondStore({ merchantId: session.merchantId, buyer: { globalUserId: session.globalUserId, phone: session.customer!.phone! }, message, action, state: current }) };
}
const presentation = (response: any) => presentMetaUi(withMetaCartNavigation(buildMetaUiView(response), true), "current", 0, {canGoBack: true});

test("contact data without CPF reaches delivery, and field entry emits no generic menu", async () => {
  const f = fixture();
  assert.equal(deriveChatStage(f.session), "shipping");
  assert.deepEqual(missingFieldsForStage(f.session, "shipping"), ["CEP"]);
  const response = await f.send("Quero continuar");
  assert.match(response.agentMessage, /CEP/); assert.equal(response.blocks.some(b=>b.type==="checkout_redirect"), false);
  const shown = presentation(response);
  assert.equal(shown.messages.length, 1); assert.equal(shown.messages[0].type, "text"); assert.deepEqual(shown.numericSelections, []);
});

test("confirmation offers only Sim/Não, without browse, cart or back controls", async () => {
  const f = fixture(); f.session.customer!.address = { zip: "01001000", street: "Rua", city: "São Paulo", state: "SP" };
  const response = await f.send("01001000");
  const shown = presentation(response);
  assert.deepEqual(shown.numericSelections, [{kind:"message",message:"Sim"},{kind:"message",message:"Não"}]);
  assert.doesNotMatch(JSON.stringify(shown.messages), /Explorar opções|Ver carrinho|Voltar|Navegue no menu/);
});

test("a free-shipping question retains checkout and publishes every quote as readable text and exact choices", async () => {
  const f = fixture(); f.session.customer!.address = { zip: "01001000", street: "Rua", city: "São Paulo", state: "SP", number: "96", complement: "204" };
  f.session.customer!.address_verified = true; f.session.shippingOptions = options;
  const response = await f.send("Tem frete grátis?");
  assert.equal(response.state.stage, "checkout"); assert.equal(f.counts().storeCalls, 0);
  const shown = presentation(response), text = shown.messages.filter(m=>m.type==="text").map(m=>m.text.body).join("\n");
  assert.match(text, /PAC/); assert.match(text, /Sedex/); assert.match(text, /12,50/); assert.match(text, /20,00/); assert.match(text, /6 dias úteis/);
  assert.equal(shown.numericSelections.length, 2); assert.doesNotMatch(JSON.stringify(shown.messages), /Explorar opções|Ver carrinho|Ver produtos|Voltar/);
});

test("an empty shipping response gives an explicit retry, never a fabricated rate or endless loading promise", async () => {
  const f = fixture(); Object.assign(f.session.customer!, { address_verified: true, address: {zip:"01001000",street:"Rua",city:"São Paulo",state:"SP",number:"1",complement:""} });
  const response = await f.send("Calcular novamente");
  assert.match(response.agentMessage, /não retornou uma cotação/);
  assert.deepEqual(presentation(response).numericSelections, [{kind:"tool",tool:"checkout_shipping_retry",args:{}}]);
  assert.doesNotMatch(JSON.stringify(response.blocks), /PAC|Sedex/);
});

test("Pix without CPF sends the original copy-paste payload and never a web payment CTA", async () => {
  const f = fixture(); f.session.customer!.address = {zip:"01001000",street:"Rua",city:"São Paulo",state:"SP",number:"1",complement:""};
  f.session.customer!.address_verified = true; f.session.shipping = options[0];
  const response = await f.send("Pix", {kind:"tool",tool:"create_payment",args:{method:"pix",fingerprint:paymentCartFingerprint(f.session)}});
  assert.equal(f.counts().paymentCalls, 1); assert.equal(f.session.customer!.cpf, undefined);
  const shown = presentation(response);
  assert.ok(shown.messages.some(m=>m.type==="text"&&m.text.body==="000201PIX-UNCHANGED"));
  assert.equal(shown.messages.some(m=>m.type==="interactive"&&m.interactive.type==="cta_url"), false);
  assert.doesNotMatch(response.agentMessage, /Abra o checkout/);
});

test("Pix validation errors do not become a card checkout redirect", async () => {
  const f = fixture(); f.session.cart.items = [{ ...f.session.cart.items[0], productType:"digital" }];
  (f.adapter as any).createPayment = {execute:async()=>{throw new BadRequestException("mercadopago_payer_email_required");}};
  const response = await f.send("Pix", {kind:"tool",tool:"create_payment",args:{method:"pix",fingerprint:paymentCartFingerprint(f.session)}});
  assert.equal(response.blocks.some(b=>["hosted_card_payment","stripe_card","checkout_redirect"].includes(b.type)), false);
  assert.equal(response.state.payment, undefined);
});

test("a provider-specific mandatory document keeps its secure form and never asks for it in a Meta flow", async () => {
  const f=fixture();f.session.cart.items=[{...f.session.cart.items[0],productType:"digital"}];
  (f.adapter as any).createPayment={execute:async()=>{throw new BadRequestException("asaas_customer_data_incomplete");}};
  const previous=process.env.WIDGET_BASE_URL;process.env.WIDGET_BASE_URL="https://widget.example.com";
  try {
    const response=await f.send("Pix",{kind:"tool",tool:"create_payment",args:{method:"pix",fingerprint:paymentCartFingerprint(f.session)}});
    assert.equal((response.blocks.find(b=>b.type==="checkout_redirect")?.data as any)?.purpose,"document");
    assert.equal(response.state.expectsFreeInput,false);assert.equal(response.blocks.some(b=>b.type==="checkout_form"),false);
  }finally{if(previous===undefined)delete process.env.WIDGET_BASE_URL;else process.env.WIDGET_BASE_URL=previous;}
});

test("CPF detection protects documents without intercepting ordinary phone and order numbers",()=>{
  assert.equal(containsSharedCpf("52998224725"),true);assert.equal(containsSharedCpf("529.982.247-25"),true);
  assert.equal(containsSharedCpf("Meu CPF é 52998224725"),true);
  assert.equal(containsSharedCpf("11999999999"),false);assert.equal(containsSharedCpf("185874665727"),false);
});

test("Stripe redirect is already bound to card and retains the checkout session", async () => {
  const f = fixture(); f.session.cart.items = [{ ...f.session.cart.items[0], productType:"digital" }];
  const old = process.env.WIDGET_BASE_URL; process.env.WIDGET_BASE_URL = "https://widget.example.com";
  try {
    const response = await f.send("Cartão", {kind:"tool",tool:"create_payment",args:{method:"card",fingerprint:paymentCartFingerprint(f.session)}});
    const block = response.blocks.find(b=>b.type==="checkout_redirect")!;
    assert.equal((block.data as any).purpose, "card"); assert.equal(new URL((block.data as any).url).searchParams.get("paymentMethod"), "card");
    assert.equal(f.counts().paymentCalls, 0); assert.match(JSON.stringify(presentation(response).messages), /endereço já estão preenchidos/);
  } finally {if(old===undefined)delete process.env.WIDGET_BASE_URL;else process.env.WIDGET_BASE_URL=old;}
});

test("welcome changes with the configured tone and custom greeting replaces the default welcome", () => {
  const messages = ["consultative","premium","direct","friendly","technical"].map(tone=>metaWelcomeMessage("","Loja","Lia",tone));
  assert.equal(new Set(messages).size, 5);
  const custom = metaWelcomeMessage("Uma saudação da nossa loja.","Loja","Lia","friendly");
  assert.match(custom,/Uma saudação da nossa loja/); assert.doesNotMatch(custom,/Que bom ter você|Seja muito bem-vindo/);
});
