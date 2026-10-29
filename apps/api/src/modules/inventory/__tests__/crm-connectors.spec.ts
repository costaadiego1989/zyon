import "reflect-metadata";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CrmAdapterFactory } from "../infrastructure/adapters/crm-adapter.factory.js";
import { normalizeCrmConfig } from "../infrastructure/adapters/crm-provider-config.js";
import { MailchimpCrmAdapter, ActiveCampaignCrmAdapter, KlaviyoCrmAdapter } from "../infrastructure/adapters/marketing-crm.adapters.js";
import { HubSpotCrmAdapter } from "../infrastructure/adapters/hubspot-crm.adapter.js";
import { PipedriveCrmAdapter } from "../infrastructure/adapters/pipedrive-crm.adapter.js";
import { RdStationCrmAdapter } from "../infrastructure/adapters/rdstation-crm.adapter.js";
import { ConnectCrmUseCase } from "../application/use-cases/connect-crm.use-case.js";
import { ListCrmConnectionsUseCase } from "../application/use-cases/list-crm-connections.use-case.js";
import { CrmSyncService } from "../application/services/crm-sync.service.js";
import { encryptCrmSecret, decryptCrmSecret } from "../infrastructure/adapters/crm-secret-cipher.js";
import { CampaignContactConsentService } from "../../campaign-consent/campaign-contact-consent.service.js";
import { PrismaCrmConnectionRepository } from "../infrastructure/repositories/prisma-crm-connection.repository.js";

type Call = { url: URL; method: string; body: any; headers: Headers; redirect?: RequestRedirect };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
function mockFetch(t: TestContext, callback: (call: Call) => Response) {
  const prior = globalThis.fetch;
  t.after(() => { globalThis.fetch = prior; });
  const calls: Call[] = [];
  globalThis.fetch = async (url, options) => {
    const call = { url: new URL(String(url)), method: options?.method ?? "GET",
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
      headers: new Headers(options?.headers), redirect: options?.redirect };
    calls.push(call); return callback(call);
  };
  return calls;
}

test("Mailchimp uses normalized email hash, preserves unsubscribe status and suppresses tag automations", async t => {
  const calls = mockFetch(t, () => response({ id: "member" }));
  const adapter = new MailchimpCrmAdapter("private-fixture-us21", "audience123");
  assert.equal(await adapter.validateCredentials(), true);
  await adapter.upsertContact("merchant", { email: " Buyer@Example.test ", name: "Maria Silva", tags: ["customer"] });
  const member = calls.find(c => c.method === "PUT")!;
  assert.equal(member.url.hostname, "us21.api.mailchimp.com");
  assert.equal(member.url.pathname.split("/").at(-1), createHash("md5").update("buyer@example.test").digest("hex"));
  assert.equal(member.body.status_if_new, "subscribed");
  assert.equal("status" in member.body, false);
  assert.deepEqual(member.body.merge_fields, { FNAME: "Maria", LNAME: "Silva" });
  assert.equal(calls.at(-1)!.body.is_syncing, true);
  assert.deepEqual(calls.at(-1)!.body.tags, [{ name: "zyon_lead", status: "inactive" }, { name: "zyon_customer", status: "active" }]);
  assert.equal(member.redirect, "error");
});

test("ActiveCampaign syncs contacts without subscribing lists or enrolling automations", async t => {
  const calls = mockFetch(t, () => response({ contact: { id: "42" } }));
  const adapter = new ActiveCampaignCrmAdapter("private-fixture", "https://account.api-us1.com");
  await adapter.upsertContact("merchant", { email: "BUYER@example.test" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/3/contact/sync");
  assert.equal(calls[0].headers.get("Api-Token"), "private-fixture");
  assert.deepEqual(calls[0].body, { contact: { email: "buyer@example.test" } });
});

test("Klaviyo uses a pinned official revision and profile import without email/SMS subscription changes", async t => {
  const calls = mockFetch(t, () => response({ data: { type: "profile", id: "profile42" } }));
  await new KlaviyoCrmAdapter("private-fixture").upsertContact("merchant", {
    email: "buyer@example.test", phone: "(21) 99999-0000", name: "Maria Silva", tags: ["lead"],
  });
  assert.equal(calls[0].url.pathname, "/api/profile-import/");
  assert.equal(calls[0].headers.get("revision"), "2026-07-15");
  const attributes = calls[0].body.data.attributes;
  assert.equal(attributes.properties.zyon_stage, "lead");
  assert.equal("subscriptions" in attributes, false);
  assert.equal("phone_number" in attributes, false);
});

test("Pipedrive creates an associated deal while a newly created contact is absent from search", async t => {
  const calls = mockFetch(t, call => {
    if (call.url.pathname.endsWith("/search")) return response({ success: true, data: { items: [] } });
    if (call.url.pathname === "/api/v2/persons") return response({ success: true, data: { id: 71 } });
    return response({ success: true, data: { id: 91 } });
  });
  const adapter = new PipedriveCrmAdapter("private-fixture");
  await adapter.upsertContact("merchant", { email: "buyer@example.test", name: "Maria Silva" });
  await adapter.createDeal("merchant", { contactEmail: "buyer@example.test", title: "Order 42", valueCents: 100,
    open: false, metadata: { order_id: "42" } });
  const deal = calls.find(call => call.url.pathname === "/api/v2/deals" && call.method === "POST");
  assert.equal(deal?.body.person_id, 71);
  assert.equal(deal?.body.status, "won");
});

test("all six providers reject HTTP errors and redact transport secrets", async t => {
  const adapters = [new HubSpotCrmAdapter("secret"), new PipedriveCrmAdapter("secret"), new RdStationCrmAdapter("secret"),
    new MailchimpCrmAdapter("secret-us21", "audience123"), new ActiveCampaignCrmAdapter("secret", "https://account.api-us1.com"), new KlaviyoCrmAdapter("secret")];
  mockFetch(t, () => response({ private: "secret" }, 403));
  for (const adapter of adapters) {
    assert.equal(await adapter.validateCredentials(), false);
    await assert.rejects(adapter.upsertContact("merchant", { email: "buyer@example.test" }), { message: "inventory_crm_provider_failed" });
  }
  globalThis.fetch = async () => { throw new Error("URL containing private-token"); };
  for (const adapter of adapters) await assert.rejects(adapter.upsertContact("merchant", { email: "buyer@example.test" }), { message: "inventory_crm_provider_failed" });
});

test("provider configuration rejects arbitrary URLs and strips credential-shaped config", () => {
  for (const apiUrl of ["http://account.api-us1.com", "https://127.0.0.1", "https://account.api-us1.com.attacker.test",
    "https://secret@account.api-us1.com", "https://account.api-us1.com:8080", "https://account.api-us1.com/other", "https://account.api-us1.com/?token=secret"]) {
    assert.throws(() => normalizeCrmConfig("activecampaign", { apiUrl }), /crm_api_url_invalid/);
  }
  assert.deepEqual(normalizeCrmConfig("activecampaign", { apiUrl: "https://account.api-us1.com/api/3/", token: "private" }), { apiUrl: "https://account.api-us1.com" });
  assert.deepEqual(normalizeCrmConfig("mailchimp", { audienceId: " list123 ", accessToken: "private" }), { audienceId: "list123" });
  assert.throws(() => normalizeCrmConfig("mailchimp", {}), /crm_audience_id_required/);
  assert.throws(() => normalizeCrmConfig("unsupported", {}), /crm_provider_unsupported/);
});

test("connection saves encrypted credentials and restores public config without exposing ciphers", async t => {
  mockFetch(t, () => response({ id: "audience" }));
  let saved: any;
  const repo = { async upsert(merchantId: string, provider: string, data: unknown) {
    saved = { merchantId, provider, ...(data as object) };
    return { id: "connection", ...saved, lastSyncAt: null, lastErrorCode: null };
  }, async list() { return [{ id: "connection", ...saved, config: { audienceId: "list123", token: "private" } }]; } };
  const result = await new ConnectCrmUseCase(repo as never, new CrmAdapterFactory()).execute({
    merchantId: "merchant-a", provider: "Mailchimp", accessToken: "private-us21", config: { audienceId: "list123", token: "private" },
  });
  assert.equal(saved.merchantId, "merchant-a");
  assert.equal(saved.provider, "mailchimp");
  assert.notEqual(saved.accessTokenCipher, "private-us21");
  assert.equal(decryptCrmSecret(saved.accessTokenCipher), "private-us21");
  assert.deepEqual(result.config, { audienceId: "list123" });
  assert.equal("accessTokenCipher" in result, false);
  const listed = await new ListCrmConnectionsUseCase(repo as never).execute("merchant-a");
  assert.equal(JSON.stringify(listed).includes("private"), false);
});

test("invalid credentials never persist a connection", async t => {
  mockFetch(t, () => response({}, 401));
  let saved = false;
  const useCase = new ConnectCrmUseCase({ upsert() { saved = true; } } as never, new CrmAdapterFactory());
  await assert.rejects(useCase.execute({ merchantId: "merchant-a", provider: "klaviyo", accessToken: "bad" }), /crm_credentials_invalid/);
  assert.equal(saved, false);
});

test("two SaaS merchants connect, sync and disconnect their own Mailchimp accounts independently", async t => {
  const calls = mockFetch(t, () => response({ id: "acknowledged" }));
  const stored: any[] = [];
  const matches = (row: any, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => row[key] === value);
  const repo = new PrismaCrmConnectionRepository({ crmConnection: {
    async upsert({ where, create, update }: any) {
      const row = stored.find(r => matches(r, where.merchantId_provider));
      if (row) { Object.assign(row, update); return row; }
      const next = { id: `connection-${stored.length}`, createdAt: new Date(), lastSyncAt: null, ...create };
      stored.push(next); return next;
    },
    async findMany({ where }: any) { return stored.filter(row => matches(row, where)); },
    async deleteMany({ where }: any) { const index = stored.findIndex(row => matches(row, where)); if (index >= 0) stored.splice(index, 1); },
    async updateMany({ where, data }: any) { const rows = stored.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
  } } as never);
  const factory = new CrmAdapterFactory(), connect = new ConnectCrmUseCase(repo, factory);
  const a = await connect.execute({ merchantId: "merchant-a", provider: "mailchimp", accessToken: "private-a-us21", config: { audienceId: "listA" } });
  const b = await connect.execute({ merchantId: "merchant-b", provider: "mailchimp", accessToken: "private-b-us21", config: { audienceId: "listB" } });
  assert.notEqual(a.id, b.id);
  assert.deepEqual((await repo.list("merchant-a")).map(row => row.id), [a.id]);
  assert.deepEqual((await repo.list("merchant-b")).map(row => row.id), [b.id]);
  const logs: any[] = [];
  const sync = new CrmSyncService(undefined, repo, factory, { async record(row: any) { logs.push(row); } } as never,
    { async canContactEmail() { return true; } } as never);
  const order = { orderId: "42", buyerEmail: "buyer@example.test", totalCents: 1000, items: [], timestamp: new Date().toISOString() };
  await sync.syncSale({ ...order, merchantId: "merchant-a" });
  await sync.syncSale({ ...order, merchantId: "merchant-b" });
  const writes = calls.filter(call => call.method === "PUT");
  assert.equal(writes.length, 2);
  assert.ok(writes[0].url.pathname.includes("/lists/listA/"));
  assert.equal(writes[0].headers.get("Authorization"), "Bearer private-a-us21");
  assert.ok(writes[1].url.pathname.includes("/lists/listB/"));
  assert.equal(writes[1].headers.get("Authorization"), "Bearer private-b-us21");
  assert.deepEqual(logs.map(log => log.merchantId), ["merchant-a", "merchant-b"]);
  // Knowing another tenant's connection ID grants no permission to delete or update it.
  await repo.delete("merchant-a", b.id);
  await repo.markError("merchant-a", b.id, "failure");
  assert.equal((await repo.list("merchant-b"))[0].status, "connected");
  await repo.delete("merchant-a", a.id);
  assert.equal((await repo.list("merchant-a")).length, 0);
  assert.equal((await repo.list("merchant-b")).length, 1);
  assert.equal(JSON.stringify([a, b]).includes("private"), false);
});

test("Pipedrive searches exact email, encodes API token, and updates only provided fields", async t => {
  const calls = mockFetch(t, c => response(c.url.pathname.endsWith("/search") ? { success: true, data: { items: [{ item: { id: 42 } }] } } : { success: true, data: { id: 42 } }));
  await new PipedriveCrmAdapter("token&other=value").upsertContact("merchant", { email: "buyer@example.test" });
  assert.equal(calls[0].url.searchParams.get("exact_match"), "true");
  assert.equal(calls[0].url.searchParams.get("api_token"), "token&other=value");
  assert.equal(calls[0].url.searchParams.has("other"), false);
  assert.deepEqual(calls[1].body, {});
});

test("HubSpot uses native pipeline IDs and never creates a sale on an open or lost stage", async t => {
  const calls = mockFetch(t, c => response(c.url.pathname.endsWith("/pipelines/deals") ? {
    results: [{ id: "custom", stages: [{ id: "lost", metadata: { isClosed: "true", probability: "0" } },
      { id: "won-custom", metadata: { isClosed: "true", probability: "0.8" } }] }],
  } : { id: "contact42", results: [] }));
  await new HubSpotCrmAdapter("token").createDeal("merchant", { contactEmail: "buyer@example.test", title: "Order 42", valueCents: 1250, metadata: { order_id: "42" } });
  const body = calls.at(-1)!.body;
  assert.equal(body.properties.dealstage, "won-custom");
  assert.equal(body.properties.pipeline, "custom");
  assert.equal(body.properties.amount, "12.50");
  assert.equal(body.associations[0].types[0].associationTypeId, 3);
});

test("RD Station contact updates use the CRM nested contact/emails/phones schema", async t => {
  const calls = mockFetch(t, c => response(c.method === "GET" ? { contacts: [{ _id: "contact42", emails: [{ email: "buyer@example.test" }] }] } : { _id: "contact42" }));
  await new RdStationCrmAdapter("token").upsertContact("merchant", { email: "buyer@example.test", name: "Maria", phone: "+5521999990000" });
  assert.equal(calls[1].method, "PUT");
  assert.deepEqual(calls[1].body, { contact: { name: "Maria", phones: [{ phone: "+5521999990000", type: "cellphone" }] } });
});

test("RD Station open leads are not marked lost; sales use a one-time product and a won update", async t => {
  const calls = mockFetch(t, c => response(c.url.pathname.endsWith("/contacts") ?
    { contacts: [{ _id: "contact42", emails: [{ email: "buyer@example.test" }] }] } : c.method === "GET" ? { deals: [] } : { _id: "deal42" }));
  const adapter = new RdStationCrmAdapter("token");
  await adapter.createDeal("merchant", { contactEmail: "buyer@example.test", title: "Lead", valueCents: 0, open: true });
  assert.equal(calls.some(c => c.body?.deal?.win === false), false);
  assert.equal(calls.some(c => c.method === "PUT" && c.url.pathname.includes("/deals/")), false);
  await adapter.createDeal("merchant", { contactEmail: "buyer@example.test", title: "Order 42", valueCents: 1250, metadata: { order_id: "42" } });
  const sale = calls.find(c => c.body?.deal_products)!;
  assert.equal(sale.body.deal_products[0].recurrence, "spare");
  assert.equal(sale.body.deal_products[0].total, 12.5);
  assert.deepEqual(calls.at(-1)!.body, { deal: { win: true } });
});

test("RD Station links the created contact before search indexing without creating an embedded duplicate", async t => {
  const calls = mockFetch(t, c => response(c.method === "GET" ? { contacts: [], deals: [], deal_ids: ["previousDeal"] } :
    c.url.pathname.endsWith("/contacts") ? { _id: "contact42", name: "Maria" } : { _id: "deal42" }));
  const adapter = new RdStationCrmAdapter("token");
  await adapter.upsertContact("merchant", { email: "buyer@example.test", name: "Maria" });
  await adapter.createDeal("merchant", { contactEmail: "buyer@example.test", title: "Order 42", valueCents: 1250, metadata: { order_id: "42" } });
  const deal = calls.find(c => c.method === "POST" && c.url.pathname.endsWith("/deals"))!;
  assert.equal(deal.body.contacts, undefined);
  const association = calls.find(c => c.method === "PUT" && c.url.pathname.endsWith("/contacts/contact42"))!;
  assert.deepEqual(association.body, { contact: { deal_ids: ["previousDeal", "deal42"] } });
  assert.deepEqual(calls.at(-1)!.body, { deal: { win: true } });
});

test("RD Station retries an open sale whose contact association previously failed", async t => {
  const calls = mockFetch(t, c => response(c.url.pathname.endsWith("/deals") ? { deals: [{ _id: "deal42", name: "Order 42", win: null }] } :
    c.url.pathname.endsWith("/contacts") ? { contacts: [{ _id: "contact42", emails: [{ email: "buyer@example.test" }] }] } : { deal_ids: ["previousDeal"] }));
  await new RdStationCrmAdapter("token").createDeal("merchant", { contactEmail: "buyer@example.test", title: "Order 42", valueCents: 1250, metadata: { order_id: "42" } });
  assert.equal(calls.some(c => c.method === "POST"), false);
  assert.deepEqual(calls.find(c => c.method === "PUT" && c.url.pathname.endsWith("/contacts/contact42"))!.body,
    { contact: { deal_ids: ["previousDeal", "deal42"] } });
  assert.deepEqual(calls.at(-1)!.body, { deal: { win: true } });
});

test("confirmed CRM order retries find the existing deal without creating another", async t => {
  const calls = mockFetch(t, c => response(c.url.hostname === "api.hubapi.com" ? { results: [{ id: "deal42" }] } :
    c.url.hostname === "api.pipedrive.com" ? { success: true, data: { items: [{ item: { id: 42 } }] } } : { deals: [{ _id: "deal42", name: "Order 42", win: true }] }));
  for (const adapter of [new HubSpotCrmAdapter("token"), new PipedriveCrmAdapter("token"), new RdStationCrmAdapter("token")]) {
    await adapter.createDeal("merchant", { contactEmail: "buyer@example.test", title: "Order 42", valueCents: 1250, metadata: { order_id: "42" } });
  }
  assert.equal(calls.length, 3);
  assert.equal(calls.some(c => c.method === "POST" && !c.url.pathname.endsWith("/search")), false);
});

function syncFixture(consent = true) {
  const logs: any[] = [], contacts: string[] = [], deals: string[] = [], seen: string[] = [];
  const rows = ["hubspot", "pipedrive", "mailchimp"].map(provider => ({ id: provider, provider, status: "connected", accessTokenCipher: encryptCrmSecret("token"), config: { audienceId: "list123" } }));
  const repo = { async list(merchant: string) { assert.equal(merchant, "merchant-a"); return rows; },
    async markError(_m: string, id: string) { rows.find(r => r.id === id)!.status = "error"; },
    async markSynced(_m: string, id: string) { rows.find(r => r.id === id)!.status = "connected"; } };
  let failing = true;
  const factory = { create({ provider, config }: any) { if (provider === "mailchimp") assert.equal(config.audienceId, "list123"); return {
    category: provider === "mailchimp" ? "marketing" : "crm",
    async upsertContact() { contacts.push(provider); if (provider === "hubspot" && failing) throw new Error("private-token"); },
    ...(provider !== "mailchimp" ? { async createDeal() { deals.push(provider); } } : {}),
  }; } };
  const log = { async record(row: any) { logs.push(row); }, async hasLeadFor(_m: string, _email: string, provider: string) { seen.push(provider); return provider === "pipedrive"; } };
  const service = new CrmSyncService(undefined, repo as never, factory as never, log as never,
    { async canContactEmail({ merchantId, email }: any) { assert.equal(merchantId, "merchant-a"); assert.equal(email, "buyer@example.test"); return consent; } } as never);
  return { service, logs, contacts, deals, seen, recover() { failing = false; } };
}
const sale = { merchantId: "merchant-a", orderId: "order42", buyerEmail: "BUYER@example.test", totalCents: 1250, items: [], timestamp: new Date().toISOString() };

test("fanout continues after provider failure and error connections remain eligible for retries", async () => {
  const fixture = syncFixture();
  await assert.rejects(fixture.service.syncSale(sale), { message: "inventory_crm_sync_failed" });
  assert.deepEqual(fixture.contacts, ["hubspot", "pipedrive", "mailchimp"]);
  assert.deepEqual(fixture.logs.map(l => l.status), ["failed", "success", "success"]);
  assert.equal(JSON.stringify(fixture.logs).includes("private-token"), false);
  fixture.recover(); await fixture.service.syncSale(sale);
  assert.equal(fixture.contacts.filter(p => p === "hubspot").length, 2);
});
test("marketing without tenant consent is skipped and operational CRM synchronization continues", async () => {
  const fixture = syncFixture(false); fixture.recover();
  await fixture.service.syncSale(sale);
  assert.deepEqual(fixture.contacts, ["hubspot", "pipedrive"]);
  assert.deepEqual(fixture.logs.at(-1), { merchantId: "merchant-a", provider: "mailchimp", email: "buyer@example.test", stage: "customer", status: "skipped", errorCode: "contact_consent_not_granted" });
});
test("lead deduplication is provider-scoped and marketing destinations do not fabricate deals", async () => {
  const fixture = syncFixture(); fixture.recover();
  await fixture.service.syncLead({ merchantId: "merchant-a", email: "buyer@example.test" });
  assert.deepEqual(fixture.seen, ["hubspot", "pipedrive"]);
  assert.deepEqual(fixture.deals, ["hubspot"]);
});
test("email consent resolves the buyer identity and checks only this merchant's grant", async () => {
  const calls: any[] = [];
  const service = new CampaignContactConsentService({
    buyerAccount: { async findUnique(input: any) { calls.push(input); return { globalUserId: "buyer42" }; } },
    campaignContactConsent: { async findUnique(input: any) { calls.push(input); return { status: "granted", grantedAt: new Date(), revokedAt: null }; } },
    buyerPreference: { async findUnique() { return { emailOptIn: true }; } },
  } as never);
  assert.equal(await service.canContactEmail({ merchantId: "merchant-a", email: " BUYER@example.test " }), true);
  assert.equal(calls[0].where.email, "buyer@example.test");
  assert.deepEqual(calls[1].where.merchantId_globalUserId_channel_purpose, { merchantId: "merchant-a", globalUserId: "buyer42", channel: "email", purpose: "marketing" });
});
