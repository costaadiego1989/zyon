import type { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { initialFulfillment } from "../domain/order-fulfillment.js";
import type { CompletedOrderLineItem } from "@zyon/shared-types";

export const FULFILLMENT_QA_MARKER = "zyon_fulfillment_qa_20261005";
export const SANDBOX_MERCHANT_ID = "mrc_baf22f65-595c-4799-98a6-4c00c6b123b5";
export const SANDBOX_ENVIRONMENT_ID = "a347216c-86e3-4a75-8d73-5ae6e122408c";
const id = (namespace: string, key: string) => `qa_ff_${createHash("sha256").update(`${namespace}:${key}`).digest("hex").slice(0, 24)}`;

/** Fixtures are operational examples; payment and provider facts are synthetic. */
export function fulfillmentSeedManifest(merchantId: string, namespace = FULFILLMENT_QA_MARKER, now = new Date()) {
  const line = (key: string, type: CompletedOrderLineItem["productType"], strategy: CompletedOrderLineItem["fulfillmentStrategy"], quantity = 1, scheduled = false): CompletedOrderLineItem => ({
    snapshotVersion: 2, lineId: key, sku: `QA-${key.toUpperCase()}`, variantId: id(namespace, `variant:${key}`),
    name: { physical: "Kit físico de demonstração", digital: "Material digital de demonstração", service: "Atendimento de demonstração", food: "Refeição de demonstração" }[type!],
    productType: type, fulfillmentStrategy: strategy, unitPriceCents: type === "service" ? 9900 : 2990, quantity,
    selectedOptions: type === "food" ? [{ group_name: "Acompanhamento", item_name: "Salada", price_modifier: 0 }] : [],
    ...(type === "digital" ? { requiredChannels: ["email", "whatsapp"] } : {}),
    ...(scheduled ? { schedule: { slotId: "qa_original", startsAt: new Date(now.getTime() - 3600000).toISOString(), endsAt: new Date(now.getTime() - 1800000).toISOString(), timeZone: "America/Sao_Paulo", durationMinutes: 30 } } : {}),
  });
  const definitions: Array<{ key: string; lines: CompletedOrderLineItem[]; payment?: string; status?: string; legacy?: boolean }> = [
    { key: "physical-carrier", lines: [line("physical_carrier", "physical", "carrier")] },
    { key: "physical-pickup", lines: [line("physical_pickup", "physical", "pickup")] },
    { key: "digital-pending", lines: [line("digital_pending", "digital", "digital")] },
    { key: "digital-blocked", lines: [line("digital_blocked", "digital", "digital")] },
    { key: "service-scheduled", lines: [line("service_scheduled", "service", "scheduled_service", 1, true)] },
    { key: "service-unscheduled", lines: [line("service_unscheduled", "service", "service")] },
    { key: "service-no-show", lines: [line("service_no_show", "service", "scheduled_service", 1, true)] },
    { key: "food-pickup", lines: [line("food_pickup", "food", "pickup", 2)] },
    { key: "food-delivery", lines: [line("food_delivery", "food", "local_delivery")] },
    { key: "mixed-food-service", lines: [line("mixed_food", "food", "pickup"), line("mixed_service", "service", "service")] },
    { key: "mixed-physical-digital", lines: [line("mixed_physical", "physical", "carrier"), line("mixed_digital", "digital", "digital")] },
    { key: "unpaid", payment: "pending", lines: [line("unpaid", "food", "pickup")] },
    { key: "cancelled", status: "cancelled", lines: [line("cancelled", "service", "service")] },
    { key: "legacy-review", legacy: true, lines: [line("legacy", "physical", "carrier")] },
  ];
  return { marker: FULFILLMENT_QA_MARKER, namespace, merchantId, generatedAt: now.toISOString(), synthetic: true,
    orders: definitions.map(definition => ({ ...definition, id: id(namespace, `order:${definition.key}`), sessionId: id(namespace, `session:${definition.key}`),
      paymentId: id(namespace, `payment:${definition.key}`), externalOrderId: `qa_fixture_${definition.key}_${id(namespace, definition.key).slice(-8)}` })) };
}
export async function applyFulfillmentSeed(prisma: PrismaClient, manifest: ReturnType<typeof fulfillmentSeedManifest>) {
  const merchant = await prisma.merchant.findUnique({ where: { id: manifest.merchantId } });
  if (!merchant) throw new Error("qa_seed_merchant_not_found");
  return prisma.$transaction(async tx => {
    const created: string[] = [], preserved: string[] = [];
    for (const fixture of manifest.orders) {
      const existing = await tx.completedOrder.findUnique({ where: { id: fixture.id }, include: { session: { select: { cart: true } } } });
      if (existing) {
        if (existing.merchantId !== manifest.merchantId || (existing.session.cart as any)?.qa_seed !== manifest.marker) throw new Error("qa_seed_ownership_mismatch");
        preserved.push(fixture.key); continue;
      }
      const now = new Date(manifest.generatedAt), total = fixture.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
      for (const line of fixture.lines) {
        const productId = id(manifest.namespace, `product:${line.lineId}`);
        const nextDay = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
        await tx.product.create({ data: { id: productId, merchantId: manifest.merchantId, name: `${line.name} QA`, type: line.productType!,
          metadata: { qa_seed: manifest.marker, fulfillmentStrategy: line.fulfillmentStrategy,
            ...(line.schedule ? { serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [{ id: "qa_next", date: nextDay, startTime: "14:00" }, { id: "qa_later", date: nextDay, startTime: "15:00" }] } } : {}),
            ...(line.productType === "digital" ? { downloadUrl: "https://example.invalid/qa-download", digitalDeliveryChannels: ["email", "whatsapp"] } : {}) },
          variants: { create: { id: line.variantId!, sku: line.sku, price: { create: { basePriceInCents: line.unitPriceCents } }, stock: { create: { quantity: 20 } } } } } });
      }
      await tx.checkoutSession.create({ data: { merchantId: manifest.merchantId, sessionId: fixture.sessionId, globalUserId: id(manifest.namespace, "buyer"), conversationId: fixture.sessionId,
        cart: { qa_seed: manifest.marker, currency: "BRL", total: total / 100, items: fixture.lines.map(line => ({ sku: line.sku, variantId: line.variantId, name: line.name, productType: line.productType, price: line.unitPriceCents / 100, quantity: line.quantity })) },
        customer: { fullName: `QA ${fixture.key}`, email: "fixture@example.invalid" }, createdAt: now, updatedAt: now } });
      await tx.paymentIntent.create({ data: { id: fixture.paymentId, merchantId: manifest.merchantId, sessionId: fixture.sessionId, idempotencyKey: fixture.key,
        currency: "BRL", amountCents: total, approvedAmountCents: fixture.payment === "pending" ? null : total, status: fixture.payment ?? "approved", method: "qa_fixture", providerPaymentId: fixture.externalOrderId,
        creation: { qa_seed: manifest.marker, provider: "qa_disabled", synthetic: true }, statusHistory: [{ status: fixture.payment ?? "approved", occurred_at: manifest.generatedAt }] } });
      const state = initialFulfillment(fixture.lines)!;
      if (fixture.key === "digital-blocked") { state.units[0]!.status = "provisioning"; state.units[0]!.attention = "sandbox_fixture_transport_disabled"; }
      await tx.completedOrder.create({ data: { id: fixture.id, merchantId: manifest.merchantId, sessionId: fixture.sessionId, externalOrderId: fixture.externalOrderId,
        orderTotal: total / 100, currency: "BRL", status: fixture.status ?? "approved", completedAt: now,
        lineItemsJson: (fixture.legacy ? fixture.lines.map(({ snapshotVersion, productType, fulfillmentStrategy, ...line }) => line) : fixture.lines) as unknown as Prisma.InputJsonValue,
        ...(!fixture.legacy ? { fulfillmentJson: state as unknown as Prisma.InputJsonValue } : {}) } });
      for (const unit of state.units) {
        if (unit.schedule) await tx.serviceReservation.create({ data: { id: id(manifest.namespace, `reservation:${unit.id}`), merchantId: manifest.merchantId, orderId: fixture.id, unitId: unit.id, resourceId: unit.variantId, startsAt: new Date(unit.schedule.startsAt), endsAt: new Date(unit.schedule.endsAt) } });
        if (unit.strategy === "digital") {
          const grantId = id(manifest.namespace, `grant:${unit.id}`);
          await tx.digitalEntitlement.create({ data: { id: grantId, merchantId: manifest.merchantId, orderId: fixture.id, paymentIntentId: fixture.paymentId, variantId: unit.variantId, sku: unit.sku, productName: unit.name,
            downloadUrl: "https://example.invalid/qa-download", expiresAt: new Date(now.getTime() + 30 * 86400000),
            deliveries: { create: ["email", "whatsapp"].map(channel => ({ id: id(manifest.namespace, `delivery:${unit.id}:${channel}`), channel, destination: channel === "email" ? "fixture@example.invalid" : "qa_disabled",
              status: "blocked", reason: "sandbox_fixture_transport_disabled" })) } } });
        }
      }
      created.push(fixture.key);
    }
    return { created, preserved, outboxCreated: 0, externalDispatches: 0 };
  }, { maxWait: 30000, timeout: 30000 });
}
