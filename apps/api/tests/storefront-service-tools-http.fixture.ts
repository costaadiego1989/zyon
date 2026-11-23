import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { addBusinessDays, businessDateKey } from "../src/shared/analytics/business-period.js";

// New local HTTP/SQL proof fixture. Only model provider transport is captured.
// Credentials, tenant/owner, reader, handlers, checkout commands and SQL are real.
// Static catalog/account/agenda records below are preconditions, never results.
export async function createStorefrontServiceToolHttpFixture() {
  const ids = { merchant: "t43-http-own", product: "t43-http-own-service", variant: "t43-http-own-variant", professional: "t43-http-own-professional",
    foreignMerchant: "t43-http-foreign", foreignProduct: "t43-http-foreign-service", foreignVariant: "t43-http-foreign-variant" };
  const date = addBusinessDays(businessDateKey(new Date()), 2), origin = "https://t43-owned.example.test";
  const intent = (action: "browse" | "select") => ({ schemaVersion: 2, domain: "STORE_COMMERCE", intent: "COMPLEX_QUESTION", confidence: 1,
    requiresTool: true, needsProductDiscovery: false, shoppingPhase: null, serviceRequest: "live_facts", serviceAction: action });
  const offer = { productId: ids.product, variantId: ids.variant }, person = { ...offer, professionalId: ids.professional };
  const tool = (name: string, args: Record<string, unknown>, action: "browse" | "select" = "browse") => [
    { phase: "storefront.intent", response: intent(action) }, { phase: "storefront.sales", serviceToolCall: { name, args } },
  ];
  const modelScript = [
    ...tool("get_service_professionals", offer),
    ...tool("get_service_dates", { ...person, fromDate: date, toDate: date }),
    ...tool("get_service_slots", { ...person, date }),
    ...tool("resolve_service_selection", { ...offer, professionalName: "Profissional Ana", date: { kind: "absolute", value: date }, time: { kind: "exact", value: "10:00" } }, "select"),
    ...tool("get_service_professionals", offer), // missing buyer proof
    ...tool("get_service_professionals", offer), // forged embed proof
    ...tool("get_service_professionals", { productId: ids.foreignProduct, variantId: ids.foreignVariant }),
    ...tool("get_service_professionals", { ...offer, merchantId: ids.foreignMerchant }),
  ];
  const runtime = await createServiceTestRuntime({ local: true, buyerBooking: true, storefrontQueryModel: true, storefrontRoutingProfile: "structured", modelScript });
  let prisma: PrismaClient | undefined, redis: Redis | undefined, closed = false;
  const close = async () => {
    if (closed) return; closed = true; const errors: unknown[] = [];
    try { if (redis?.status === "ready") await redis.quit(); else redis?.disconnect(); } catch (error) { errors.push(error); }
    try { await prisma?.$disconnect(); } catch (error) { errors.push(error); }
    try { await runtime.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "t43_http_tool_cleanup_failed");
    assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
  };
  try {
    prisma = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } }); const db = prisma;
    redis = new Redis(runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, commandTimeout: 5000, connectTimeout: 5000, enableOfflineQueue: false });
    await redis.connect(); const cache = redis;
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runtime.db.runId }]);
    assert.equal(await cache.get("aacp:synthetic:run"), runtime.redis.runId);
    assert.equal(runtime.evidence().canonicalAppModule, true); assert.equal(runtime.evidence().authOverrides, false); assert.equal(runtime.evidence().repositoryOverrides, false);
    const request = async (path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST") => {
      const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "idempotency-key": randomUUID(), "x-correlation-id": randomUUID(), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const { PasswordHasher } = await import("../dist/modules/auth/domain/services/password-hasher.service.js");
    const password = "SyntheticT43Buyer123!", buyer = await db.buyerAccount.create({ data: { email: "t43-http@buyer-booking.example.test",
      displayName: "Private owner", passwordHash: await new PasswordHasher().hash(password), phone: "5511999997711", cpf: "12345678909" } });
    const login = await request("/buyer/login", { email: buyer.email, password }); assert.equal(login.status, 201); assert.equal(login.body.globalUserId, buyer.globalUserId);
    for (const merchantId of [ids.merchant, ids.foreignMerchant]) {
      await db.merchant.create({ data: { id: merchantId, name: merchantId, businessMode: "services", businessModeSelectedAt: new Date(), plan: "STORE_ONLY" } });
      await db.merchantBillingSubscription.create({ data: { merchantId, planKey: "growth", status: "active" } });
      await db.merchantRule.create({ data: { merchantId, maxDiscountPercent: 0, minimumMarginPercent: 0, allowFreeShipping: false,
        allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: false,
        autonomousEngineEnabled: false, freeShippingMinCartValue: 0, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0,
        offerExpirationMinutes: 10, blockedRegions: [], brandVoice: "Cordial", originZip: "01310000" } });
      await db.serviceBusinessPolicy.create({ data: { merchantId, admissionsEnabled: true, holdEnabled: true, holdMinutes: 4, paymentMode: "at_attendance", version: 1, configuredAt: new Date() } });
    }
    await db.product.create({ data: { id: ids.product, merchantId: ids.merchant, name: "Consulta canonica", type: "service", isActive: true,
      metadata: { serviceSchedule: { durationMinutes: 30, timeZone: "America/Sao_Paulo", slots: [] } }, variants: { create: { id: ids.variant, sku: "T43-HTTP",
        isActive: true, stock: { create: { quantity: 10 } }, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } } });
    await db.serviceProfessional.create({ data: { id: ids.professional, merchantId: ids.merchant, publicName: "Profissional Ana", timeZone: "America/Sao_Paulo", isActive: true, isPublished: true,
      publicProfile: { description: "Public biography", privateSecret: "foreign-private-marker" } } });
    await db.professionalService.create({ data: { merchantId: ids.merchant, professionalId: ids.professional, productId: ids.product } });
    await db.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ merchantId: ids.merchant, professionalId: ids.professional, weekday,
      startMinute: 600, endMinute: 720, timeZone: "America/Sao_Paulo" })) });
    await db.product.create({ data: { id: ids.foreignProduct, merchantId: ids.foreignMerchant, name: "FOREIGN_PRIVATE_SERVICE", type: "service", isActive: true,
      variants: { create: { id: ids.foreignVariant, sku: "T43-FOREIGN", isActive: true, price: { create: { basePriceInCents: 99900, currency: "BRL" } } } } } });
    const conversation = await request("/storefront/conversations", { merchant_id: ids.merchant, buyer_access_token: login.body.accessToken }, { origin });
    assert.equal(conversation.status, 201, JSON.stringify(conversation)); const cartRef = conversation.body.conversation_id;
    const issued = await runtime.buyerBooking.issue({ merchantId: ids.merchant, body: { cart_ref: cartRef, conversation_token: conversation.body.conversation_token,
      allowed_origin: origin, scopes: ["checkout:start", "checkout:track", "appointments:confirm"], ttl_seconds: 900 } });
    assert.equal(issued.status, 201, JSON.stringify(issued));
    await db.storefrontCart.upsert({ where: { merchantId_sessionId: { merchantId: ids.merchant, sessionId: cartRef } },
      create: { merchantId: ids.merchant, sessionId: cartRef, expiresAt: new Date(Date.now() + 86_400_000) }, update: {} });
    const headers = { origin, authorization: "Bearer " + conversation.body.conversation_token, "x-buyer-authorization": "Bearer " + login.body.accessToken,
      "x-aacp-embed-token": issued.body.embed_session_token };
    const send = (message: string, changes: Record<string, string | undefined> = {}, body: Record<string, unknown> = {}) => {
      const selected: Record<string, string> = { ...headers }; for (const [key, value] of Object.entries(changes)) value === undefined ? delete selected[key] : selected[key] = value;
      return request("/storefront/conversations/" + cartRef + "/messages", { user_message: message, ...body }, selected);
    };
    const snapshot = async () => ({ cart: await db.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: ids.merchant, sessionId: cartRef } }, select: { merchantId: true, sessionId: true, items: true, total: true, discount: true, couponCode: true, freeShipping: true } }),
      appointments: await db.serviceAppointment.findMany({ where: { merchantId: { in: [ids.merchant, ids.foreignMerchant] } }, orderBy: { id: "asc" } }),
      payments: await db.appointmentPayment.findMany({ where: { merchantId: { in: [ids.merchant, ids.foreignMerchant] } }, orderBy: { id: "asc" } }),
      checkouts: await db.checkoutSession.findMany({ where: { merchantId: ids.merchant }, orderBy: { id: "asc" } }),
      intents: await db.paymentIntent.count({ where: { merchantId: ids.merchant } }), audits: await db.appointmentAudit.count({ where: { merchantId: ids.merchant } }),
      orders: await db.completedOrder.count({ where: { merchantId: ids.merchant } }), stock: await db.productStock.findMany({ where: { variantId: ids.variant }, orderBy: { id: "asc" } }),
      inventory: await db.inventoryMovement.count({ where: { merchantId: ids.merchant } }),
      events: await db.outboxMessage.findMany({ where: { merchantId: ids.merchant, producer: "service-booking" }, select: { eventId: true, eventType: true, payload: true }, orderBy: { eventId: "asc" } }),
      holds: (await cache.keys("service-slots:{" + createHash("sha256").update(ids.merchant).digest("hex") + "}:*")).sort() });
    return { runtime, db, ids, date, cartRef, send, snapshot, close };
  } catch (error) { try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "t43_http_tool_setup_cleanup_failed"); } throw error; }
}
