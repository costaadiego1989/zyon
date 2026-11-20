import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { TENANT_SCOPED_MODELS, shouldInjectTenant } from "../src/shared/persistence/tenant.middleware.js";
import { createFiscalFixture } from "./fiscal-fixture.js";
import { seedFiscalSale } from "./fiscal-schema-seed.js";

const fiscalModels = ["FiscalArtifact", "FiscalCancellationReview", "FiscalConnection", "FiscalDelivery", "FiscalDocument", "FiscalEvent", "FiscalIntent", "FiscalIssuanceRevision", "FiscalOlistOAuthSession", "FiscalProfileVersion", "FiscalProviderStageReceipt", "FiscalSaleSnapshot"];

test("all persisted fiscal records are registered for existing tenant protection", () => {
  const models = Prisma.dmmf.datamodel.models.filter(model => model.name.startsWith("Fiscal") && model.fields.some(field => field.name === "merchantId")).map(model => model.name).sort();
  assert.deepEqual(models, fiscalModels);
  assert.deepEqual(TENANT_SCOPED_MODELS.filter(model => model.startsWith("Fiscal")).sort(), fiscalModels);
  for (const model of fiscalModels) for (const action of ["findMany", "findUnique", "create", "update", "deleteMany"]) assert.equal(shouldInjectTenant(model, action), true, model + "." + action);
});

test("fiscal schema enforces real persistence and composite ownership constraints", { timeout: 120_000 }, async t => {
  const fixture = await createFiscalFixture();
  t.after(() => fixture.close());
  const { prisma } = fixture;
  const first = await seedFiscalSale(fixture);

  await t.test("one intention per seller, order, environment and operation", async () => {
    await assert.rejects(prisma.fiscalIntent.create({ data: { ...first.intentData, stableReference: "different_reference" } }), { code: "P2002" });
    assert.equal(await prisma.fiscalIntent.count({ where: { merchantId: first.merchantId, orderId: first.orderId, environment: first.environment } }), 1);
  });

  await t.test("another seller and fiscal environment keep independent references", async () => {
    const production = await seedFiscalSale(fixture, { merchantId: first.merchantId, orderId: first.orderId, environment: "production" });
    const otherSeller = await seedFiscalSale(fixture, { orderMerchantId: first.orderMerchantId, orderId: first.orderId });
    assert.notEqual(production.intent.id, first.intent.id);
    assert.notEqual(otherSeller.intent.id, first.intent.id);
    assert.equal(await prisma.fiscalIntent.count({ where: { merchantId: first.merchantId, orderId: first.orderId } }), 2);
    await assert.rejects(prisma.fiscalIntent.create({ data: { ...otherSeller.intentData, orderId: "bad_tenant", stableReference: "bad_tenant", connectionId: first.connection.id } }), { code: "P2003" });
    await assert.rejects(prisma.fiscalIntent.create({ data: { ...first.intentData, orderId: "bad_environment", stableReference: "bad_environment", connectionId: production.connection.id } }), { code: "P2003" });
    assert.equal(await prisma.fiscalIntent.count({ where: { orderId: { in: ["bad_tenant", "bad_environment"] } } }), 0);
  });

  const documentData = { merchantId: first.merchantId, environment: first.environment, intentId: first.intent.id, issuerTaxId: "12ABC34501DE35",
    state: "authorized", providerStatus: "autorizado", number: "17", series: "1", accessKey: "test_key", authorizationProtocol: "test_protocol",
    authorizedAt: new Date("2026-11-14T12:00:00.000Z") };
  const document = await prisma.fiscalDocument.create({ data: documentData });

  await t.test("one document and one automatic delivery per document and channel", async () => {
    await assert.rejects(prisma.fiscalDocument.create({ data: documentData }), { code: "P2002" });
    const data = { merchantId: first.merchantId, environment: first.environment, documentId: document.id, channel: "email", responsibleSender: "zyon" };
    await prisma.fiscalDelivery.create({ data });
    await assert.rejects(prisma.fiscalDelivery.create({ data }), { code: "P2002" });
    await prisma.fiscalDelivery.create({ data: { ...data, channel: "whatsapp" } });
    assert.equal(await prisma.fiscalDelivery.count({ where: { documentId: document.id } }), 2);
  });

  await t.test("confirmed fiscal profile preserves its version actor and confirmation time", async () => {
    const value = await prisma.fiscalProfileVersion.findUniqueOrThrow({ where: { id: first.profile.id } });
    assert.equal(value.version, 1);
    assert.equal(value.confirmedBy, fixture.tag + "_owner");
    assert.equal(value.confirmedAt?.toISOString(), "2026-11-14T12:00:00.000Z");
    await assert.rejects(prisma.fiscalProfileVersion.create({ data: { merchantId: first.merchantId, environment: first.environment, provider: first.provider,
      operation: "sale", version: 1, issuerRegime: "simples_nacional", itemRules: {}, recipientRequirements: [], sourceContractVersion: "v2" } }), { code: "P2002" });
  });

  await t.test("private XML bytes and their integrity evidence survive ERP disconnection", async () => {
    const content = Buffer.from("<nfeProc><tpAmb>2</tpAmb></nfeProc>");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const artifact = await prisma.fiscalArtifact.create({ data: { merchantId: first.merchantId, environment: first.environment,
      documentId: document.id, kind: "xml", privateObjectKey: `${first.merchantId}/${document.id}/xml`, content, sha256,
      size: content.byteLength, mimeType: "application/xml", retrievedAt: new Date() } });
    await prisma.fiscalConnection.update({ where: { id: first.connection.id }, data: { isActive: false, disconnectedAt: new Date() } });
    const value = await prisma.fiscalArtifact.findUniqueOrThrow({ where: { id: artifact.id } });
    assert.deepEqual(Buffer.from(value.content), content);
    assert.equal(value.sha256, sha256);
    assert.equal(value.size, content.byteLength);
    assert.equal((await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: document.id } })).authorizationProtocol, "test_protocol");
  });

  await t.test("fiscal history keeps the actor and original connection cannot be deleted", async () => {
    const event = await prisma.fiscalEvent.create({ data: { merchantId: first.merchantId, environment: first.environment,
      intentId: first.intent.id, actorKind: "merchant", actorId: fixture.tag + "_owner", action: "authorized", previousState: "processing",
      nextState: "authorized", safeReasonCode: "sefaz_authorized", providerEvidenceRef: "test_protocol" } });
    assert.equal(event.actorKind, "merchant");
    assert.equal(event.actorId, fixture.tag + "_owner");
    assert.equal(event.intentId, first.intent.id);
    assert.equal(event.environment, "homologation");
    assert.equal(event.providerEvidenceRef, "test_protocol");
    await assert.rejects(prisma.fiscalConnection.delete({ where: { id: first.connection.id } }), { code: "P2003" });
    assert.equal(await prisma.fiscalEvent.count({ where: { intentId: first.intent.id } }), 1);
  });
});
