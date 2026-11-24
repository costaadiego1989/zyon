import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { composeOwnedSourceServiceRelease } from "./service-release-source-process.fixture.js";
import { createNativeServiceJourneyFixture, type NativeJourneyCase } from "./service-channel-journey.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { PasswordHasher } from "../src/modules/auth/domain/services/password-hasher.service.js";

// Signed Meta ingress, real worker/AppModule/SQL/Redis and actual published
// availability. No actor injection, fake buyer, origin or verifier callback.
test("native public browsing before account disambiguation", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createNativeServiceJourneyFixture({ serviceReleaseFixture: "matching",
    bookingAwaitTrace: true, localModelFailure: true });
  const step = (state: Awaited<ReturnType<typeof f.state>>) => (state.view?.serviceBooking?.model as any)?.step;
  const model = (state: Awaited<ReturnType<typeof f.state>>) => state.view?.serviceBooking?.model as any;
  const body = (state: Awaited<ReturnType<typeof f.state>>) => state.view?.body ?? "";
  const addRealAmbiguousAccount = async (c: NativeJourneyCase) => {
    const password = randomUUID() + randomUUID(), passwordHash = await new PasswordHasher().hash(password);
    const account = await f.prisma.buyerAccount.create({ data: { email: randomUUID() + "@native-public.example.test",
      passwordHash, displayName: "Another real synthetic buyer", phone: c.phone } });
    const login = await f.request("/buyer/login", { email: account.email, password }); assert.equal(login.status, 201);
    const profile = await f.request("/buyer/me/profile", { phone: c.phone }, { authorization: "Bearer " + login.body.accessToken }, "PATCH");
    assert.equal(profile.status, 200);
    const accounts = await f.prisma.buyerAccount.findMany({ where: { globalUserId: { in: [c.buyerId!, account.globalUserId] } }, orderBy: { globalUserId: "asc" } });
    assert.equal(accounts.length, 2); assert.ok(accounts.every(value => value.passwordHash && value.phone?.startsWith("pii_v1:")));
    assert.equal(accounts[0]!.phoneLookupHash, accounts[1]!.phoneLookupHash); assert.ok(accounts[0]!.phoneLookupHash);
    return accounts;
  };
  const noBusinessWrites = async (c: NativeJourneyCase, accounts: Awaited<ReturnType<typeof addRealAmbiguousAccount>>) => {
    const snapshot = await f.snapshot(c);
    assert.deepEqual(snapshot, { appointments: [], payments: [], audits: [], events: [], orders: 0, inventory: 0 });
    assert.equal(await f.prisma.checkoutSession.count({ where: { merchantId: c.merchantId } }), 0);
    assert.equal(await f.prisma.storefrontCart.count({ where: { merchantId: c.merchantId } }), 0);
    assert.deepEqual(await f.slots.active(c.merchantId, "professional:" + c.professionalId), []);
    assert.deepEqual(await f.prisma.buyerAccount.findMany({ where: { globalUserId: { in: accounts.map(value => value.globalUserId) } }, orderBy: { globalUserId: "asc" } }), accounts);
    assert.equal(await f.prisma.buyerAccount.count({ where: { phoneLookupHash: accounts[0]!.phoneLookupHash } }), 2);
  };
  try {
    const release = composeOwnedSourceServiceRelease("matching"); t.after(() => release.close());
    for (const hold of [false, true]) await t.test("ambiguous signed guest browses and previews with hold " + (hold ? "on" : "off") + "; Continue alone requires identity", async () => {
      const c = await f.make("public-ambiguous-" + (hold ? "on" : "off"), { hold });
      const accounts = await addRealAmbiguousAccount(c);
      const unsigned = f.wire(c, "/servicos"); await f.post(unsigned, false);
      assert.equal(await f.prisma.whatsAppWebhookInbox.count({ where: { eventId: unsigned.eventId } }), 0);
      await f.message(c, "/servicos");
      let state = await f.state(c); assert.equal(step(state), "services");
      assert.doesNotMatch(body(state), /Meus dados|identificar.*cadastro|informe.*e-mail/i); await noBusinessWrites(c, accounts);
      await f.choose(c, "offer", action => action.productId === c.productId && action.variantId === c.variantId);
      state = await f.state(c); assert.equal(step(state), "professionals");
      assert.equal(model(state).source.professionals[0].id, c.professionalId);
      assert.doesNotMatch(JSON.stringify(model(state)), /globalUserId|passwordHash|phoneLookupHash|email|phone|fingerprint/);
      await f.choose(c, "professional", action => action.professionalId === c.professionalId);
      state = await f.state(c); assert.equal(step(state), "dates");
      const dates = Object.values(state.selections ?? {}).filter(action => f.operation(action, "date")) as Array<{ date: string }>;
      assert.ok(dates.length); const date = [...new Set(dates.map(value => value.date))].sort().at(-1)!;
      await f.choose(c, "date", action => action.date === date);
      state = await f.state(c); assert.equal(step(state), "slots");
      const selection = model(state).source.selections[0]; assert.ok(selection);
      assert.equal(selection.priceInCents, 5000); assert.equal(selection.timeZone, "America/Sao_Paulo");
      await f.choose(c, "slot", action => action.selection.slotId === selection.slotId);
      state = await f.state(c); assert.equal(step(state), "review");
      assert.deepEqual(model(state).source.selection, selection);
      assert.equal(model(state).source.policy.holdEnabled, hold); assert.equal(model(state).source.policy.paymentMode, "at_attendance");
      assert.equal(model(state).source.authorizesConfirmation, false); assert.equal(model(state).source.authorizesPayment, false);
      assert.doesNotMatch(body(state), /Meus dados|identificar.*cadastro|informe.*e-mail/i);
      assert.doesNotMatch(JSON.stringify(model(state)), /globalUserId|passwordHash|phoneLookupHash|email|phone|fingerprint/);
      await noBusinessWrites(c, accounts);
      const continueControl = await f.control(c, action => f.operation(action, "continue"));
      await f.message(c, "Continuar agendamento", { interactiveId: continueControl.id });
      state = await f.state(c); assert.match(body(state), /Meus dados|identificar.*cadastro|informe.*e-mail/i);
      assert.notEqual(step(state), "prepared"); assert.notEqual(step(state), "confirmed");
      await noBusinessWrites(c, accounts);
    });
  } finally { await f.close(); }
});
