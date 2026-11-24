import assert from "node:assert/strict";
import test from "node:test";
import { createStorefrontServiceToolHttpFixture } from "./storefront-service-tools-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

test("T43 actual storefront HTTP and SQL tool dispatch", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createStorefrontServiceToolHttpFixture();
  const result = (response: any) => { assert.equal(response.status, 201, JSON.stringify(response)); return response.body.blocks?.find((block: any) => block.type === "service_booking")?.data; };
  const safe = (body: unknown) => assert.doesNotMatch(JSON.stringify(body), /foreign-private-marker|FOREIGN_PRIVATE_SERVICE|parent_cart_fingerprint|ownerHash|generation|passwordHash|accessToken|access_token/);
  const unchanged = async (before: unknown) => assert.deepEqual(await f.snapshot(), before);
  try {
    await t.test("real signed conversation, embed and logged-in buyer reach canonical professionals", async () => {
      const before = await f.snapshot(), response = await f.send("Quero consultar os profissionais deste servico"), data = result(response);
      assert.equal(data.kind, "professionals"); assert.equal(data.professionals.length, 1); assert.equal(data.professionals[0].id, f.ids.professional);
      assert.equal(data.professionals[0].name, "Profissional Ana"); safe(response.body); await unchanged(before);
    });
    await t.test("real tools read date and slot facts from the current SQL schedule", async () => {
      const before = await f.snapshot(), dates = await f.send("Quais datas estao livres?"), date = result(dates);
      assert.equal(date.kind, "dates"); assert.deepEqual(date.dates, [f.date]);
      const response = await f.send("Quais horarios estao livres nesta data?"), slots = result(response);
      assert.equal(slots.kind, "slots"); assert.ok(slots.selections.length > 0);
      assert.equal(slots.selections[0].startsAt, f.date + "T13:00:00.000Z"); assert.equal(slots.selections[0].timeZone, "America/Sao_Paulo");
      assert.equal(slots.selections[0].priceInCents, 5000); safe(response.body); await unchanged(before);
    });
    await t.test("exact model hint becomes only a revalidated review and creates zero hold, checkout or payment", async () => {
      const before = await f.snapshot(), response = await f.send("Quero Profissional Ana na data escolhida as dez"), data = result(response);
      assert.equal(data.kind, "selection"); assert.equal(data.selection.productId, f.ids.product); assert.equal(data.selection.professionalId, f.ids.professional);
      assert.equal(data.selection.startsAt, f.date + "T13:00:00.000Z"); assert.equal(data.requiresRevalidation, true);
      assert.equal(data.authorizesConfirmation, false); assert.equal(data.authorizesPayment, false); assert.equal(data.action, "review_service_booking");
      safe(response.body); await unchanged(before);
    });
    await t.test("anonymous buyer reads only public roster while forged embed proof still cannot gain authority", async () => {
      const before = await f.snapshot();
      const providerPhases = () => f.runtime.storefrontQueryModel.events().filter((event: any) => event.kind === "providerFetch").map((event: any) => event.input.phase);
      const guestCalls = providerPhases().length;
      const guest = await f.send("Consulte os profissionais", { "x-buyer-authorization": undefined }), roster = result(guest);
      assert.equal(roster.kind, "professionals"); assert.equal(roster.professionals.length, 1);
      assert.equal(roster.professionals[0].id, f.ids.professional); assert.equal(roster.professionals[0].name, "Profissional Ana");
      assert.deepEqual(Object.keys(roster.professionals[0]).sort(), ["id", "name", "profile", "timeZone", "version"].sort());
      assert.equal(roster.professionals[0].profile.description, "Public biography");
      assert.doesNotMatch(JSON.stringify(roster), /"(?:buyer|customer|email|cpf|phone|sessionId|session_id|cartRef|cart_ref|authorization)"/i);
      assert.deepEqual(providerPhases().slice(guestCalls), ["storefront.intent", "storefront.sales"]);
      safe(guest.body); await unchanged(before);
      const forgedCalls = providerPhases().length;
      const response = await f.send("Consulte os profissionais", { "x-aacp-embed-token": "forged" }), data = result(response);
      assert.equal(data.kind, "authentication_required"); assert.equal(data.action, "authenticate");
      assert.deepEqual(providerPhases().slice(forgedCalls), ["storefront.intent", "storefront.sales"]);
      safe(response.body); await unchanged(before);
    });
    await t.test("foreign offer and caller tenant argument do not expose private facts or produce a selection", async () => {
      const before = await f.snapshot();
      for (const message of ["Consulte este outro servico", "Use a empresa que eu informar"]) {
        const response = await f.send(message); assert.equal(response.status, 201, JSON.stringify(response));
        const data = response.body.blocks?.find((block: any) => block.type === "service_booking")?.data;
        assert.equal(data, undefined); safe(response.body); await unchanged(before);
      }
    });
    await t.test("wrong origin and cross-cart HTTP body stop before another captured model turn", async () => {
      const before = await f.snapshot(), count = f.runtime.storefrontQueryModel.events().length;
      assert.equal((await f.send("Consulta", { origin: "https://foreign.example.test" })).status, 401);
      assert.equal((await f.send("Consulta", {}, { cart_id: "foreign-cart" })).status, 403);
      assert.equal(f.runtime.storefrontQueryModel.events().length, count); await unchanged(before);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0); assert.equal(f.runtime.evidence().authOverrides, false); assert.equal(f.runtime.evidence().repositoryOverrides, false);
  } finally { await f.close(); }
});
