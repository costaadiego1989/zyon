// Proposed apps/api/tests/service-operations-http.fixture.ts. Source only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createProfessionalHttpFixture } from "./service-professional-http-fixture.mjs";

export async function createServiceOperationsHttpFixture(options: { whatsapp?: true } = {}) {
  const f = await createProfessionalHttpFixture(options), { prisma, runtime } = f;
  const request = async (path: string, body: unknown, auth: any = f.owner, method = "POST") => {
    const correlationId = randomUUID(), response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", "idempotency-key": randomUUID(), "x-correlation-id": correlationId,
        ...(auth ? { authorization: "Bearer " + auth.access_token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = { status: response.status, body: await response.json() };
    if (auth && method !== "GET" && [200, 201, 400, 404, 409, 500].includes(response.status)) {
      const deadline = Date.now() + 5000; let audit;
      do { audit = await prisma.merchantAuditEvent.findFirst({ where: { merchantId: auth.merchant_id, correlationId } }); } while (!audit && Date.now() < deadline);
      assert.ok(audit, "actual service operation HTTP audit required"); assert.equal(audit.actorId, auth.user_id);
      assert.equal(audit.outcome, response.status < 400 ? "success" : "failed");
    }
    return result;
  };
  const prefix = (auth = f.owner) => "/merchants/" + auth.merchant_id + "/service-appointments";
  const prepare = async (suffix: string, mode: "online" | "at_attendance" = "at_attendance") => {
    const auth = f.owner, merchantId = auth.merchant_id;
    const current = await prisma.serviceBusinessPolicy.findUnique({ where: { merchantId } });
    const policy = await f.request("/merchants/me/service-business-policy", { expectedVersion: current?.version ?? 0,
      paymentMode: mode, holdEnabled: false, admissionsEnabled: true }, auth, "PUT"); assert.equal(policy.status, 200, JSON.stringify(policy));
    const product = await prisma.product.create({ data: { merchantId, name: "Public " + suffix, type: "service", isActive: true,
      metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } }, variants: { create: { sku: "ops-" + suffix,
        isActive: true, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
    const created = await f.request(f.path(auth), { publicName: "Public professional " + suffix, timeZone: "UTC", isPublished: true, productIds: [product.id] }, auth);
    assert.equal(created.status, 201, JSON.stringify(created));
    const grade = await f.request(f.path(auth) + "/" + created.body.id + "/availability", { expectedVersion: created.body.version, timeZone: "UTC",
      rows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 720 })) }, auth, "PUT"); assert.equal(grade.status, 200, JSON.stringify(grade));
    const professional = await prisma.serviceProfessional.findUniqueOrThrow({ where: { id: created.body.id } });
    const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const command = { commandId: "manual-" + suffix, productId: product.id, variantId: product.variants[0].id, professionalId: professional.id,
      expectedProfessionalVersion: professional.version, expectedPolicyVersion: policy.body.version, startsAt: date + "T10:00:00.000Z",
      customer: { kind: "contact", name: "Synthetic operator contact", email: "operator-contact@example.test" } };
    const made = await request(prefix() + "/manual", command); assert.equal(made.status, 201, JSON.stringify(made));
    return { auth, merchantId, product, professional, date, command, appointment: made.body.appointment };
  };
  const snapshot = async (appointmentId: string) => ({
    appointment: await prisma.serviceAppointment.findUniqueOrThrow({ where: { id: appointmentId } }),
    balances: await prisma.appointmentPayment.findMany({ where: { appointmentId }, orderBy: { id: "asc" } }),
    audits: await prisma.appointmentAudit.findMany({ where: { appointmentId }, orderBy: { commandId: "asc" } }),
    events: await prisma.outboxMessage.findMany({ where: { correlationId: appointmentId, producer: "service-booking" },
      orderBy: { eventId: "asc" }, select: { eventId: true, eventType: true, schemaVersion: true, merchantId: true,
        occurredAt: true, correlationId: true, causationId: true, producer: true, payload: true, createdAt: true } }),
  });
  const close = async () => {
    const errors: unknown[] = []; try { await prisma.$disconnect(); } catch (error) { errors.push(error); }
    try { await runtime.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "owned_service_operations_cleanup_failed");
    assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
  };
  return { ...f, request, prefix, prepare, snapshot, close };
}
