import test from "node:test";
import assert from "node:assert/strict";
import { linkedAddress, linkedCheckoutFixture } from "./whatsapp-linked-checkout.fixture.js";

function buttonId(presentation: any, title: string): string {
  const buttons = presentation.messages.flatMap((m: any) => m.interactive?.action?.buttons ?? []);
  const button = buttons.find((b: any) => b.reply?.title === title);
  assert.ok(button, "missing native button: " + title); return button.reply.id;
}

test("C3 linked checkout reuses the complete account without contact collection, OTP or false email verification", async t => {
  const f = linkedCheckoutFixture(); t.after(f.close);
  const { response } = await f.start(), session = f.session()!;
  assert.equal(session.globalUserId, f.buyer.globalUserId);
  assert.equal(session.customer?.fullName, f.buyer.customer.fullName); assert.equal(session.customer?.email, f.buyer.customer.email);
  assert.equal(session.customer?.cpf, f.buyer.customer.cpf); assert.equal(session.customer?.phone, f.buyer.customer.phone);
  assert.equal(session.customer?.phone_verified, true); assert.equal(session.customer?.email_verified, false);
  assert.equal(session.customer?.otp_code, undefined); assert.doesNotMatch(response.agentMessage, /Qual é seu e-mail|nome completo|Confirme sua conta/);
  assert.deepEqual(f.stats, { payments: 0, otp: 0, quotes: 0, accountWrites: 0 });
});

test("C4 saved delivery shows every address field and two native choices before confirmation", async t => {
  const f = linkedCheckoutFixture(); t.after(f.close);
  const { response, view, presentation } = await f.start();
  for (const field of ["Avenida Paulista", "1578", "Apto 42", "Bela Vista", "São Paulo/SP", "01310-100"]) assert.ok(view.body.includes(field), field);
  assert.deepEqual(view.choices.map(c => c.label), ["Entregar aqui", "Outro endereço"]);
  assert.equal(f.session()!.customer?.address_verified, false); assert.equal(response.blocks.some(b => b.type === "payment_methods"), false);
  assert.deepEqual(presentation.selections[buttonId(presentation, "Entregar aqui")], { kind: "message", message: "Sim" });
  assert.deepEqual(presentation.selections[buttonId(presentation, "Outro endereço")], { kind: "message", message: "Não" });
});

test("C5 selecting the rendered delivery button confirms the same address and continues to freight without a charge", async t => {
  const f = linkedCheckoutFixture(); t.after(f.close);
  const initial = await f.start(), confirmed = await f.select(buttonId(initial.presentation, "Entregar aqui")), session = f.session()!;
  assert.equal(session.customer?.address_verified, true); assert.deepEqual(session.customer?.address, linkedAddress);
  assert.equal(session.globalUserId, f.buyer.globalUserId); assert.equal(session.shippingOptions?.length, 1);
  assert.equal(session.shippingOptions?.[0]?.customerPrice, 15); assert.equal(session.paymentMethod, undefined);
  assert.equal(confirmed.response.blocks.some(b => b.type === "shipping_options"), true);
  assert.equal(confirmed.response.blocks.some(b => b.type === "payment_methods"), false);
  assert.equal(f.stats.payments, 0); assert.equal(f.stats.otp, 0); assert.equal(f.stats.accountWrites, 0);
});

test("C6 selecting another delivery collects a complete new address while keeping identity and the account default", async t => {
  const f = linkedCheckoutFixture(); t.after(f.close); f.enablePostalStub();
  const initial = await f.start(), other = await f.select(buttonId(initial.presentation, "Outro endereço"));
  assert.match(other.response.agentMessage, /CEP/); assert.equal(f.session()!.customer?.address?.zip, undefined);
  assert.equal(f.session()!.customer?.address_verified, false); assert.equal(f.stats.quotes, 0);
  await f.turn("22041001"); await f.turn("Sim"); await f.turn("220"); const completed = await f.turn("Bloco C");
  const session = f.session()!;
  assert.deepEqual(session.customer?.address, { zip: "22041001", street: "Rua Nova", number: "220", complement: "Bloco C", neighborhood: "Copacabana", city: "Rio de Janeiro", state: "RJ" });
  assert.equal(session.customer?.address_verified, true); assert.equal(session.globalUserId, f.buyer.globalUserId);
  for (const field of ["fullName", "email", "cpf", "phone"] as const) assert.equal(session.customer?.[field], f.buyer.customer[field]);
  assert.equal(completed.response.blocks.some(b => b.type === "shipping_options"), true);
  assert.deepEqual(f.buyer.customer.address, linkedAddress); assert.equal(f.stats.accountWrites, 0); assert.equal(f.stats.payments, 0); assert.equal(f.stats.otp, 0);
});

test("C4 unrelated text cannot silently accept the saved delivery", async t => {
  const f = linkedCheckoutFixture(); t.after(f.close); await f.start();
  const reply = await f.turn("Quero pensar melhor");
  assert.equal(f.session()!.customer?.address_verified, false); assert.equal(f.stats.quotes, 0); assert.equal(f.stats.payments, 0);
  assert.deepEqual(reply.view.choices.map(c => c.label), ["Entregar aqui", "Outro endereço"]);
});
