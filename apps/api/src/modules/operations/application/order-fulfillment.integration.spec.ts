import "reflect-metadata";
import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { applyFulfillmentSeed, fulfillmentSeedManifest } from "../../../../prisma/seeds/order-fulfillment-qa.seed.js";
import { OrderFulfillmentUseCase } from "./order-fulfillment.use-case.js";
import { readFulfillment, snapshotOrderLines, initialFulfillment, summarizeFulfillment } from "../domain/order-fulfillment.js";
import { projectDigitalFulfillment, reserveService } from "../../../shared/persistence/order-fulfillment.js";
import { linkShipmentFulfillment, projectShipmentFulfillment } from "../../../shared/persistence/order-shipment-fulfillment.js";
import { PrismaOperationsReadRepository } from "../infrastructure/prisma-operations-read.repository.js";

describe("fulfillment snapshot and aggregate", () => {
  it("preserves purchase choices and does not classify historical lines", () => {
    const lines = snapshotOrderLines([{ sku: "sku", name: "Food", quantity: 2, price: 29.90, productType: "food", fulfillmentStrategy: "pickup", selected_options: [{ group_name: "Extra", item_name: "Salada", price_modifier: 2 }] }]);
    assert.equal(lines[0]!.unitPriceCents, 2990); assert.equal(lines[0]!.selectedOptions![0]!.item_name, "Salada");
    assert.equal(initialFulfillment([{ sku: "old", unitPriceCents: 100, quantity: 1 }]), undefined);
    assert.equal(summarizeFulfillment(null, 0, true, "approved").stage, "review");
    assert.equal(readFulfillment({ schemaVersion: 1, units: [{ quantity: -1 }] }), undefined);
  });
});

const databaseUrl = process.env.FULFILLMENT_QA_DATABASE_URL;
describe("order fulfillment with isolated PostgreSQL", { skip: !databaseUrl }, () => {
  let prisma: PrismaClient, useCase: OrderFulfillmentUseCase;
  const merchantId = `qa_fulfillment_${randomUUID()}`;
  const manifest = fulfillmentSeedManifest(merchantId, merchantId);
  const fixture = (key: string) => manifest.orders.find(order => order.key === key)!;
  before(async () => {
    const target = new URL(databaseUrl!); assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.pathname, "/zyon_fulfillment_qa");
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } }); useCase = new OrderFulfillmentUseCase(prisma);
    await prisma.merchant.create({ data: { id: merchantId, name: "Fulfillment QA" } });
    assert.equal((await applyFulfillmentSeed(prisma, manifest)).created.length, 14);
  });
  after(async () => {
    if (!prisma) return;
    await prisma.outboxMessage.deleteMany({ where: { merchantId } });
    await prisma.checkoutSession.deleteMany({ where: { merchantId } });
    await prisma.paymentIntent.deleteMany({ where: { merchantId } });
    await prisma.product.deleteMany({ where: { merchantId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
    await prisma.$disconnect();
  });
  const row = (key: string) => prisma.completedOrder.findUniqueOrThrow({ where: { id: fixture(key).id } });
  async function command(key: string, action: string, extras: Record<string, unknown> = {}) {
    const order = await row(key);
    const unit = readFulfillment(order.fulfillmentJson)!.units[0]!;
    return { merchantId, orderId: order.id, unitId: unit.id, action, expectedVersion: order.fulfillmentVersion, actorId: "qa_operator", commandId: randomUUID(), ...extras };
  }
  async function act(key: string, action: string, extras: Record<string, unknown> = {}) { return useCase.execute(await command(key, action, extras)); }
  const stage = async (key: string) => { const order = await row(key); return summarizeFulfillment(order.fulfillmentJson, order.fulfillmentVersion, true, order.status).stage; };

  it("rerunning seeds preserves operator changes and emits no delivery jobs", async () => {
    const result = await applyFulfillmentSeed(prisma, manifest); assert.equal(result.created.length, 0); assert.equal(result.preserved.length, 14);
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId } }), 0);
  });
  it("rejects unpaid, cancelled, wrong tenant, unknown snapshot and forged completion", async () => {
    await assert.rejects(act("unpaid", "start_preparation"), /fulfillment_payment_required/);
    await assert.rejects(act("cancelled", "start_service"), /fulfillment_order_cancelled/);
    await assert.rejects(useCase.execute({ ...(await command("food-delivery", "start_preparation")), merchantId: "other_tenant" }), /order_not_found/);
    await assert.rejects(useCase.execute({ merchantId, orderId: fixture("legacy-review").id, unitId: "legacy", action: "start_preparation", expectedVersion: 0, actorId: "qa", commandId: randomUUID() }), /fulfillment_snapshot_review_required/);
    await assert.rejects(act("digital-pending", "complete_service", { proof: "forged" }), /fulfillment_action_not_allowed/);
    await assert.rejects(act("physical-carrier", "deliver_local", { proof: "forged" }), /fulfillment_action_not_allowed/);
  });
  it("allows exactly one concurrent preparation and rejects reused payload identities", async () => {
    const first = await command("food-delivery", "start_preparation"), second = { ...first, commandId: randomUUID() };
    const result = await Promise.allSettled([useCase.execute(first), useCase.execute(second)]);
    assert.equal(result.filter(value => value.status === "fulfilled").length, 1);
    assert.equal(result.filter(value => value.status === "rejected").length, 1);
    const winner = result[0]!.status === "fulfilled" ? first : second;
    assert.deepEqual(await useCase.execute(winner), { changed: false });
    await assert.rejects(useCase.execute({ ...winner, action: "mark_ready" }), /fulfillment_idempotency_conflict/);
    await act("food-delivery", "mark_ready"); await act("food-delivery", "dispatch_local");
    await assert.rejects(act("food-delivery", "deliver_local"), /fulfillment_proof_required/);
    await act("food-delivery", "deliver_local", { proof: "Recebido pelo cliente QA" }); assert.equal(await stage("food-delivery"), "completed");
  });
  it("supports partial pickup and emits completion only once", async () => {
    await act("food-pickup", "start_preparation"); await act("food-pickup", "mark_ready");
    const input = await command("food-pickup", "collect", { proof: "Retirado por QA", quantity: 1 });
    await useCase.execute(input); await useCase.execute(input); assert.equal(await stage("food-pickup"), "partial");
    await assert.rejects(act("food-pickup", "collect", { proof: "Retirado por QA", quantity: 2 }), /fulfillment_quantity_invalid/);
    await act("food-pickup", "collect", { proof: "Segunda unidade retirada", quantity: 1 });
    assert.equal(await stage("food-pickup"), "completed");
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId, correlationId: fixture("food-pickup").id, eventType: "order.fulfillment.completed" } }), 1);
  });
  it("completes physical pickup and both service strategies with an audit trail", async () => {
    await act("physical-pickup", "start_preparation"); await act("physical-pickup", "mark_ready"); await act("physical-pickup", "collect", { proof: "Recebimento físico QA" });
    await act("service-unscheduled", "start_service"); await act("service-unscheduled", "complete_service", { proof: "Serviço executado por QA" });
    await act("service-scheduled", "confirm_schedule"); await act("service-scheduled", "start_service"); await act("service-scheduled", "complete_service", { proof: "Atendimento executado por QA" });
    assert.equal(await stage("service-scheduled"), "completed");
    const detail = await new PrismaOperationsReadRepository(prisma).getOrder(merchantId, fixture("service-scheduled").id);
    assert.equal(detail!.fulfillment!.stage, "completed"); assert.equal(detail!.timeline.filter(entry => entry.type === "fulfillment").length, 3);
  });
  it("records absence, offers canonical slots and reserves a rescheduled appointment", async () => {
    await act("service-no-show", "confirm_schedule"); await act("service-no-show", "no_show", { proof: "Cliente não compareceu" });
    assert.equal(await stage("service-no-show"), "in_progress");
    const unitId = fixture("service-no-show").lines[0]!.lineId!;
    const slots = await useCase.serviceSlots(merchantId, fixture("service-no-show").id, unitId); assert.equal(slots.slots.filter(slot => slot.selectable).length, 2);
    await act("service-no-show", "reschedule_service", { proof: "Novo horário combinado", scheduleSlotId: "qa_next" });
    await assert.rejects(act("service-no-show", "start_service"), /service_schedule_not_started/);
    assert.equal(((await row("service-no-show")).lineItemsJson as any)?.[0]?.schedule?.slotId, "qa_original");
  });
  it("prevents overlapping reservations across orders", async () => {
    const order = await row("service-no-show"), unit = readFulfillment(order.fulfillmentJson)!.units[0]!;
    const other = await row("mixed-food-service");
    await assert.rejects(prisma.$transaction(tx => reserveService(tx, other, { ...unit, id: "conflicting_unit" })), /service_capacity_unavailable/);
  });
  it("keeps a mixed order partial until each item finishes", async () => {
    const key = "mixed-food-service";
    await act(key, "start_preparation"); await act(key, "mark_ready"); await act(key, "collect", { proof: "Refeição retirada" }); assert.equal(await stage(key), "partial");
    const order = await row(key), unitId = fixture(key).lines[1]!.lineId!;
    await useCase.execute({ ...(await command(key, "start_service")), unitId });
    await useCase.execute({ ...(await command(key, "complete_service", { proof: "Serviço finalizado" })), unitId });
    assert.equal(await stage(key), "completed"); assert.equal((await row(key)).status, "approved");
  });
  it("projects simulated carrier facts only onto linked physical items", async () => {
    const key = "mixed-physical-digital", order = await row(key), shipmentId = randomUUID();
    await prisma.shipment.create({ data: { id: shipmentId, merchantId, sessionId: order.sessionId, externalOrderId: order.externalOrderId, carrier: "qa_simulated", trackingCode: `QA${randomUUID()}`, status: "delivered" } });
    await prisma.$transaction(async tx => { await linkShipmentFulfillment(tx, merchantId, order.externalOrderId, shipmentId); await projectShipmentFulfillment(tx, merchantId, shipmentId); });
    await prisma.$transaction(tx => projectShipmentFulfillment(tx, merchantId, shipmentId));
    assert.equal(await stage(key), "partial"); assert.equal(readFulfillment((await row(key)).fulfillmentJson)!.units[1]!.completedQuantity, 0);
    assert.equal((await row(key)).status, "approved");
  });
  it("requires both channel acceptances and handles a later access revocation", async () => {
    const key = "digital-pending", order = await row(key);
    await act(key, "refresh_digital"); assert.equal(await stage(key), "in_progress");
    const grant = await prisma.digitalEntitlement.findFirstOrThrow({ where: { merchantId, orderId: order.id } });
    await prisma.digitalDelivery.updateMany({ where: { entitlementId: grant.id, channel: "email" }, data: { status: "sent", providerId: "qa_simulated_email_acceptance" } });
    await act(key, "refresh_digital"); assert.notEqual(await stage(key), "completed");
    await prisma.digitalDelivery.updateMany({ where: { entitlementId: grant.id, channel: "whatsapp" }, data: { status: "sent", providerId: "qa_simulated_whatsapp_acceptance" } });
    await act(key, "refresh_digital"); assert.equal(await stage(key), "completed");
    await prisma.digitalEntitlement.update({ where: { id: grant.id }, data: { status: "revoked" } });
    await act(key, "refresh_digital"); assert.notEqual(await stage(key), "completed");
  });
  it("rolls back progress and audit when the outbox write fails", async () => {
    const key = "physical-carrier", order = await row(key);
    const eventId = createHash("sha256").update(`${merchantId}:${order.id}:1:order.fulfillment.updated`).digest("hex");
    await prisma.outboxMessage.create({ data: { eventId, merchantId, eventType: "qa_collision", schemaVersion: 1, producer: "qa", correlationId: order.id, causationId: "qa_collision", payload: {}, occurredAt: new Date() } });
    await assert.rejects(act(key, "start_preparation"));
    assert.equal((await row(key)).fulfillmentVersion, 0); assert.equal(await prisma.orderFulfillmentAction.count({ where: { orderId: order.id } }), 0);
  });
});
