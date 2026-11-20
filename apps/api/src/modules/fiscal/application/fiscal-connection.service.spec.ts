import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { FiscalConnectionService, FISCAL_READINESS_CODES } from "./fiscal-connection.service.js";
import { PrismaFiscalConfigurationRepository } from "../infrastructure/prisma-fiscal-configuration.repository.js";
import { FiscalCredentialCipher } from "../infrastructure/fiscal-credential-cipher.js";
import type { FiscalReadinessCheck } from "../domain/fiscal-provider.js";


let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { fixture = await createFiscalFixture(); }, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
async function arrange(active = false) {
  const sale = await seedFiscalSale(fixture);
  const store = new PrismaFiscalConfigurationRepository(fixture.prisma);
  const cipher = new FiscalCredentialCipher({ AACP_PII_ENC_KEY: "synthetic-fiscal-key" });
  const state: { checks: readonly FiscalReadinessCheck[] } = { checks: FISCAL_READINESS_CODES.map(code => ({ code, status: "verified", evidenceReference: "synthetic-evidence" })) };
  const inspected: string[] = [];
  const service = new FiscalConnectionService(store, cipher, { inspect: async (connection, credential) => {
    inspected.push(connection.merchantId + ":" + credential); return state.checks;
  } });
  const scope = { merchantId: sale.merchantId, environment: sale.environment };
  const input = { ...scope, provider: "focus" as const, issuerTaxId: "12ABC34501DE35", credential: { kind: "company_token" as const, secret: "company_only_token" },
    stockOwner: "zyon" as const, emailOwner: "zyon" as const, whatsappOwner: "zyon" as const };
  const actor = { actorKind: "merchant", actorId: "owner" };
  const connected = await service.connect(input, actor);
  if (active) await service.activate(scope, connected.id, actor);
  return { sale, store, cipher, state, inspected, service, scope, input, actor, connected };
}
test("FISCAL-01 providers expose all four contracts with explicit environment", async () => {
  const { service, input, actor } = await arrange(false);

  assert.deepEqual(service.providers().map(value => value.id), ["bling", "omie", "tiny", "focus"]);
  assert.throws(() => service.connect({ ...input, environment: undefined as never }, actor), /fiscal_connection_invalid/);
});
test("FISCAL-05 company credential is encrypted and omitted from every public response", async () => {
  const { store, cipher, service, scope, input, actor, connected: originalConnected } = await arrange(false);
  let connected = originalConnected;

  connected = await service.connect(input, actor);
  const stored = (await store.find(scope, connected.id))!;
  assert.notEqual(stored.credentialCipher, input.credential.secret);
  assert.equal(cipher.decrypt(stored.credentialCipher!), "company_only_token");
  assert.equal(JSON.stringify(connected).includes("credential"), false);
  assert.equal(connected.isActive, false);
  assert.equal(stored.issuerTaxId, "12ABC34501DE35");
});
test("Focus master credentials are rejected without storing them", async () => {
  const { service, input, actor } = await arrange(false);

  assert.throws(() => service.connect({ ...input, credential: { kind: "master_token" as never, secret: "master" } }, actor), /fiscal_company_credential_required/);
});
test("FISCAL-02 unverified certificate blocks activation with safe pending fields", async () => {
  const { store, state, service, scope, actor, connected: originalConnected } = await arrange(false);
  let connected = originalConnected;

  state.checks = FISCAL_READINESS_CODES.map(code => ({ code, status: code === "certificate" ? "pending" : "verified" }));
  await assert.rejects(service.activate(scope, connected.id, actor), error => {
    assert.equal((error as { code: string }).code, "fiscal_connection_not_ready");
    assert.deepEqual((error as { pending: string[] }).pending, ["certificate"]); return true;
  });
  assert.equal((await store.find(scope, connected.id))?.isActive, false);
});
test("missing required checks cannot be silently promoted to verified", async () => {
  const { store, state, service, scope, actor, connected: originalConnected } = await arrange(false);
  let connected = originalConnected;

  state.checks = [{ code: "authentication", status: "verified" }];
  await assert.rejects(service.activate(scope, connected.id, actor), /fiscal_connection_not_ready/);
  assert.equal((await store.find(scope, connected.id))?.activatedAt, null);
});
test("FISCAL-03 activation persists its first timestamp and scoped audited outcome", async () => {
  const { sale, state, inspected, service, scope, actor, connected: originalConnected } = await arrange(false);
  let connected = originalConnected;

  state.checks = FISCAL_READINESS_CODES.map(code => ({ code, status: "verified" }));
  const activated = await service.activate(scope, connected.id, actor);
  const repeated = await service.activate(scope, connected.id, actor);
  assert.equal(activated.isActive, true);
  assert.equal(repeated.activatedAt?.toISOString(), activated.activatedAt?.toISOString());
  const audit = await fixture.prisma.merchantAuditEvent.findFirstOrThrow({ where: { merchantId: sale.merchantId, action: "fiscal.activate" } });
  assert.equal(audit.actorId, "owner"); assert.equal(audit.resourceId, connected.id);
  assert.deepEqual(audit.metadata, { provider: "focus", environment: "homologation", result: "active" });
  assert.equal(inspected.at(-1), sale.merchantId + ":company_only_token");
});
test("FISCAL-04 production has a different encrypted credential and activation cutoff", async () => {
  const { store, cipher, service, scope, input, actor, connected: originalConnected } = await arrange(false);
  let connected = originalConnected;

  const production = await service.connect({ ...input, environment: "production", credential: { kind: "company_token", secret: "production_only" } }, actor);
  assert.notEqual(production.id, connected.id);
  assert.equal(production.activatedAt, null);
  assert.equal(cipher.decrypt((await store.find({ ...scope, environment: "production" }, production.id))!.credentialCipher!), "production_only");
  assert.equal(await store.find(scope, production.id), null);
});
test("another merchant cannot inspect activate or disconnect this connection", async () => {
  const { store, service, scope, actor, connected: originalConnected } = await arrange(true);
  let connected = originalConnected;

  const other = { ...scope, merchantId: "other" };
  await assert.rejects(service.inspect(other, connected.id), /fiscal_connection_not_found/);
  await assert.rejects(service.activate(other, connected.id, actor), /fiscal_connection_not_found/);
  await assert.rejects(service.disconnect(other, connected.id, actor), /fiscal_connection_not_found/);
  assert.equal((await store.find(scope, connected.id))?.isActive, true);
});
test("one active connection per merchant environment is enforced at activation", async () => {
  const { store, service, scope, input, actor } = await arrange(true);

  const alternative = await service.connect(input, actor);
  await assert.rejects(service.activate(scope, alternative.id, actor));
  assert.equal((await store.find(scope, alternative.id))?.isActive, false);
  assert.equal(await fixture.prisma.merchantAuditEvent.count({ where: { action: "fiscal.activate", resourceId: alternative.id } }), 0);
});
test("FISCAL-62 disconnection preserves the original transmitted intent document and credential", async () => {
  const { sale, store, state, service, scope, actor, connected: originalConnected } = await arrange(true);
  let connected = originalConnected;

  const document = await fixture.prisma.fiscalDocument.create({ data: { ...scope, intentId: sale.intent.id, issuerTaxId: sale.connection.issuerTaxId,
    state: "authorized", number: "1", series: "1", accessKey: "original_key", authorizationProtocol: "original_protocol", authorizedAt: new Date() } });
  await service.disconnect(scope, connected.id, actor);
  await service.disconnect(scope, sale.connection.id, actor);
  assert.equal((await store.find(scope, connected.id))?.isActive, false);
  assert.ok((await store.find(scope, connected.id))?.disconnectedAt);
  assert.equal((await fixture.prisma.fiscalIntent.findUniqueOrThrow({ where: { id: sale.intent.id } })).connectionId, sale.connection.id);
  assert.equal((await fixture.prisma.fiscalDocument.findUniqueOrThrow({ where: { id: document.id } })).authorizationProtocol, "original_protocol");
  assert.equal((await store.find(scope, sale.connection.id))?.credentialCipher, sale.connection.credentialCipher);
  await assert.rejects(service.activate(scope, connected.id, actor), /fiscal_connection_disconnected/);
});

test("company credentials require configured key material and reject ciphertext tampering", () => {
  assert.throws(() => new FiscalCredentialCipher({}).encrypt("secret"), /missing_required_secret/);
  const cipher = new FiscalCredentialCipher({ AACP_PII_ENC_KEY: "synthetic-only" });
  const encrypted = cipher.encrypt("company_only");
  const parts = encrypted.split(":");
  parts[3] = Buffer.alloc(16).toString("base64");
  assert.throws(() => cipher.decrypt(parts.join(":")));
  assert.equal(cipher.decrypt(encrypted), "company_only");
});
