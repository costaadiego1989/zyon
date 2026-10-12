import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MelhorEnvioReverseAdapter, validReversePackage } from "./melhor-envio-reverse.adapter.js";

function fixture() {
  const owner = randomUUID(), originalId = randomUUID(), reverseId = randomUUID();
  const source = { originMerchantId: "seller", originalOrderId: originalId, insuranceCents: 1234, products: [{ name: "Produto original", quantity: 1, unitary_value: 12.34 }],
    accountIdentity: { version: 1 as const, provider: "melhor-envio" as const, environment: "test" as const, originMerchantId: "seller", providerUserId: owner } };
  const parcel = { height: 12, width: 16, length: 24, weight: 2 };
  const address = (zip: string) => ({ postal_code: zip, address: "Rua Teste", location_number: "10", district: "Centro", city: "São Paulo", state_abbr: "SP", email: "buyer@example.test", phone: "11999999999" });
  const original = { id: originalId, reverse: false, paid_at: "2026-10-07 12:00:00", generated_at: "2026-10-07 12:01:00", canceled_at: null,
    from: address("01001000"), to: address("30130010"), volumes: [parcel] };
  const reverse: any = { id: reverseId, reverse: true, service_id: 1, insurance_value: "12.34", price: "19.99", status: "pending",
    paid_at: null, generated_at: null, canceled_at: null, expired_at: null, from: original.to, to: original.from, products: source.products, volumes: [parcel], authorization_code: null };
  const calls: Array<{ url: string; init: any }> = [], tokens: any[] = [];
  let currentOwner = owner, loseCheckout = false;
  let declaration: unknown = { pdf: "https://me-0047-prod.s3.amazonaws.com/pdf/qa-document.pdf" };
  const adapter = new MelhorEnvioReverseAdapter({ resolveToken: async (...args) => { tokens.push(args); return "synthetic-test-token"; } }, (async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/v2/me")) return Response.json({ id: currentOwner });
    if (String(url).endsWith(`/orders/${originalId}`)) return Response.json(original);
    if (String(url).endsWith(`/orders/${reverseId}`)) return Response.json(reverse);
    if (String(url).endsWith(`/imprimir/dace/pdf/${reverseId}`)) return Response.json(declaration);
    if (String(url).endsWith("/cart/reverse")) return Response.json({ id: reverseId }, { status: 201 });
    if (String(url).endsWith("/checkout")) { reverse.paid_at = "2026-10-07 12:02:00"; reverse.status = "released";
      if (loseCheckout) throw Error("response lost"); return Response.json({}); }
    if (String(url).endsWith("/generate")) { reverse.generated_at = "2026-10-07 12:03:00"; reverse.authorization_code = "1234567890"; return Response.json({}); }
    throw Error("unexpected endpoint");
  }) as typeof fetch);
  return { adapter, source, parcel, original, reverse, reverseId, calls, tokens,
    changeOwner: () => { currentOwner = randomUUID(); }, loseCheckout: () => { loseCheckout = true; }, setDeclaration: (value: unknown) => { declaration = value; } };
}
test("DACE PDF is read only after bound native generation; invalid document responses never become buyer links", async () => {
  const f = fixture(), r = await f.adapter.prepareRequest(f.source, { serviceId: 1, package: f.parcel });
  await assert.rejects(f.adapter.declaration(r, f.reverseId, 1999), /generation_unproven/);
  assert.equal(f.calls.filter(c => c.url.includes("/imprimir/dace/")).length, 0);
  await f.adapter.checkout(r, f.reverseId, 1999); await f.adapter.generate(r, f.reverseId, 1999);
  const posts = f.calls.filter(c => c.init.method === "POST").length;
  assert.equal(await f.adapter.declaration(r, f.reverseId, 1999), "https://me-0047-prod.s3.amazonaws.com/pdf/qa-document.pdf");
  f.setDeclaration({ pdf: "javascript:alert(1)" }); await assert.rejects(f.adapter.declaration(r, f.reverseId, 1999), /url_invalid/);
  f.setDeclaration({ zpl: "https://example.test/document.zpl" }); await assert.rejects(f.adapter.declaration(r, f.reverseId, 1999), /declaration_unavailable/);
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, posts);
  assert.ok(f.calls.filter(c => c.url.includes("/imprimir/dace/")).every(c => c.init.method === "GET" && c.init.redirect === "error"));
  f.changeOwner(); await assert.rejects(f.adapter.declaration(r, f.reverseId, 1999), /account_unavailable/);
});
test("native reverse payload uses original label, returned insured value and buyer contact", async () => {
  const f = fixture(), r = await f.adapter.prepareRequest(f.source, { serviceId: 1, package: f.parcel });
  assert.equal(r.body.order_id, f.source.originalOrderId); assert.equal(r.body.insurance_value, 12.34);
  assert.equal(r.body.new_sender_mail, "buyer@example.test"); assert.equal(r.from.postal_code, "30130010"); assert.equal(r.to.postal_code, "01001000");
  assert.equal(await f.adapter.create(r), f.reverseId); assert.equal((await f.adapter.read(r, f.reverseId)).amountCents, 1999);
  assert.deepEqual(JSON.parse(f.calls.find(c => c.url.endsWith("/cart/reverse"))!.init.body), r.body);
  assert.ok(f.tokens.every(([merchant, options]) => merchant === "seller" && options.allowPlatformFallback === false));
});
test("checkout and generation only succeed from native paid label and real authorization code", async () => {
  const f = fixture(), r = await f.adapter.prepareRequest(f.source, { serviceId: 1, package: f.parcel });
  await f.adapter.checkout(r, f.reverseId, 1999); assert.equal((await f.adapter.read(r, f.reverseId, 1999)).code, null);
  await f.adapter.generate(r, f.reverseId, 1999); assert.equal((await f.adapter.read(r, f.reverseId, 1999)).code, "1234567890");
  assert.deepEqual(f.calls.filter(c => c.init.method === "POST").map(c => new URL(c.url).pathname), ["/api/v2/me/shipment/checkout", "/api/v2/me/shipment/generate"]);
});
test("changed account and changed price stop financial submission", async () => {
  const f = fixture(), r = await f.adapter.prepareRequest(f.source, { serviceId: 1, package: f.parcel });
  f.reverse.price = "20.00"; await assert.rejects(f.adapter.checkout(r, f.reverseId, 1999), /price_changed/);
  f.reverse.price = "19.99"; f.changeOwner(); await assert.rejects(f.adapter.checkout(r, f.reverseId, 1999), /account_unavailable/);
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
});
test("foreign address, outbound label and missing generation cannot fabricate a reverse code", async () => {
  const f = fixture(), r = await f.adapter.prepareRequest(f.source, { serviceId: 1, package: f.parcel });
  f.reverse.from = { ...f.reverse.from, location_number: "99" }; await assert.rejects(f.adapter.read(r, f.reverseId), /binding_unproven/);
  f.reverse.from = f.original.to; f.reverse.reverse = false; await assert.rejects(f.adapter.read(r, f.reverseId), /binding_unproven/);
  f.reverse.reverse = true; f.reverse.status = "released"; f.reverse.paid_at = "2026-10-07 12:02:00"; f.reverse.authorization_code = "1234567890";
  assert.equal((await f.adapter.read(r, f.reverseId)).code, null);
});
test("lost checkout response is recovered by a native GET without a second debit", async () => {
  const f = fixture(), r = await f.adapter.prepareRequest(f.source, { serviceId: 1, package: f.parcel }); f.loseCheckout();
  await assert.rejects(f.adapter.checkout(r, f.reverseId, 1999), /response lost/);
  assert.equal((await f.adapter.read(r, f.reverseId, 1999)).paid, true);
  assert.equal(f.calls.filter(c => c.url.endsWith("/checkout")).length, 1);
});
test("invalid package and missing buyer contact are rejected before cart creation", async () => {
  const f = fixture(); assert.equal(validReversePackage({ ...f.parcel, weight: 31 }), false);
  assert.equal(validReversePackage({ ...f.parcel, extra: true }), false);
  await assert.rejects(f.adapter.prepareRequest(f.source, { serviceId: 1, package: { ...f.parcel, weight: -1 } }), /package_invalid/);
  await assert.rejects(f.adapter.prepareRequest(f.source, { serviceId: 1, package: f.parcel, phone: "" }), /contact_required/);
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
});

test("a partial return never buys freight with the whole order declared as its contents", async () => {
  const f = fixture(), r = await f.adapter.prepareRequest(f.source, { serviceId: 1, package: f.parcel });
  f.reverse.products = [{ ...f.source.products[0], quantity: 2 }];
  await assert.rejects(f.adapter.checkout(r, f.reverseId, 1999), /content_unproven/);
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
});
