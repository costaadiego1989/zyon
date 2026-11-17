import test from "node:test";
import assert from "node:assert/strict";
import { linkedCheckoutFixture } from "./whatsapp-linked-checkout.fixture.js";

function shippingButton(result: any): string {
  const match = Object.entries(result.presentation.selections).find(([, action]: any) => action.kind === "message" && action.message.includes("Correios PAC"));
  assert.ok(match, "a shipping choice must be rendered");
  return match[0];
}

async function quoted(f: ReturnType<typeof linkedCheckoutFixture>) {
  await f.start();
  return f.turn("Sim");
}

function invalidate(f: ReturnType<typeof linkedCheckoutFixture>, expired: boolean) {
  const session = structuredClone(f.session()!);
  session.shippingOptions = session.shippingOptions!.map(option => ({ ...option, quoteId: "previous-quote", quoteKey: "previous-key",
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString() }));
  f.repository.saveSession(session);
}

test("C1 expired quote explains renewal and current values, requires another choice and clears the warning after selection", async t => {
  const f = linkedCheckoutFixture({ refreshedPriceCents: 1800 }); t.after(f.close);
  const initial = await quoted(f), before = structuredClone(f.session()!);
  invalidate(f, true);
  const refreshed = await f.select(shippingButton(initial));
  assert.match(refreshed.view.body, /cotação.*expirou/i);
  assert.match(refreshed.view.body, /confirme.*opç/i);
  assert.match(refreshed.view.body, /18,00/);
  const sentText = refreshed.presentation.messages.map((message: any) => message.text?.body || message.interactive?.body?.text || "").join("\n");
  assert.match(sentText, /cotação.*expirou/i);
  assert.match(sentText, /confirme.*opç/i);
  assert.equal(refreshed.response.blocks.some(b => b.type === "shipping_options"), true);
  assert.equal(f.session()!.shipping, undefined);
  assert.equal(f.session()!.shippingOptions![0].customerPrice, 18);
  assert.equal(f.session()!.globalUserId, before.globalUserId);
  assert.deepEqual(f.session()!.customer, before.customer);
  assert.equal(f.stats.payments, 0);
  const chosen = await f.select(shippingButton(refreshed));
  assert.equal(f.session()!.shipping?.customerPrice, 18);
  assert.equal(chosen.response.blocks.some(b => b.type === "shipping_options"), false);
  assert.doesNotMatch(chosen.view.body, /cotação.*expirou|cotação.*atualizada/i);
  assert.equal(f.stats.payments, 0);
});

test("C2 a valid current quote advances on the first click without an expiration notice", async t => {
  const f = linkedCheckoutFixture(); t.after(f.close);
  const initial = await quoted(f);
  assert.doesNotMatch(initial.view.body, /cotação.*expirou|cotação.*atualizada/i);
  const chosen = await f.select(shippingButton(initial));
  assert.equal(f.session()!.shipping?.customerPrice, 15);
  assert.equal(chosen.response.blocks.some(b => b.type === "shipping_options"), false);
  assert.doesNotMatch(chosen.view.body, /cotação.*expirou|cotação.*atualizada/i);
  assert.deepEqual(f.stats, { accountWrites: 0, payments: 0, otp: 0, quotes: 1 });
});

test("C3 a changed but unexpired quote explains the update without alleging expiration", async t => {
  const f = linkedCheckoutFixture({ refreshedPriceCents: 1800 }); t.after(f.close);
  const initial = await quoted(f); invalidate(f, false);
  const refreshed = await f.select(shippingButton(initial));
  assert.match(refreshed.view.body, /cotação.*atualizada/i);
  assert.match(refreshed.presentation.messages.map((message: any) => message.text?.body || message.interactive?.body?.text || "").join("\n"), /cotação.*atualizada/i);
  assert.match(refreshed.view.body, /confirme.*opç/i);
  assert.doesNotMatch(refreshed.view.body, /expirou|vencida/i);
  assert.match(refreshed.view.body, /18,00/);
  assert.equal(f.session()!.shipping, undefined);
  assert.equal(f.stats.payments, 0);
});

test("C3 an unavailable refreshed quote never claims updated prices or offers a stale option", async t => {
  const f = linkedCheckoutFixture({ refreshUnavailable: true }); t.after(f.close);
  const initial = await quoted(f); invalidate(f, true);
  const unavailable = await f.select(shippingButton(initial));
  assert.match(unavailable.view.body, /não retornou uma cotação disponível/i);
  assert.doesNotMatch(unavailable.view.body, /Atualizei os valores|cotação.*atualizada/i);
  assert.equal(unavailable.response.blocks.some(b => b.type === "shipping_options"), false);
  assert.equal(f.session()!.shipping, undefined);
  assert.equal(f.session()!.shippingOptions?.length ?? 0, 0);
  assert.equal(f.stats.payments, 0);
});
