import "reflect-metadata";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { GetWhatsAppUsageUseCase } from "./get-whatsapp-usage.use-case.js";
import { whatsappProcessingErrorCode } from "../../domain/services/whatsapp-processing-error.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function setup(options: { denyPricing?: boolean; foreignPhone?: boolean; missingCurrency?: boolean } = {}) {
  const calls: Array<{ url: string; authorization: string }> = [];
  const dbScopes: unknown[] = [];
  const configs = { async findByMerchantId(id: string) { return { id: `cfg-${id}`, merchantId: id, provider: "META_CLOUD", enabled: true,
    whatsappNumber: id === "merchant-a" ? "5511999999001" : "5511999999002", updatedAt: new Date(0), credentials: { wabaId: id === "merchant-a" ? "1111111" : "2222222", accessToken: `secret-${id}` } }; } };
  const prisma = { async $queryRaw(query: any) { dbScopes.push(query.values); return [{ received: 4n, processed: 2n, pending: 1n, failed: 1n, recent_pending: 1n, recent_failed: 1n, oldest_pending_at: new Date(0) }]; } };
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url)); const fields = parsed.searchParams.get("fields")!;
    calls.push({ url: String(url), authorization: (init?.headers as Record<string, string>).Authorization });
    const number = parsed.pathname.includes("1111111") ? "5511999999001" : "5511999999002";
    if (fields === "currency") return Response.json(options.missingCurrency ? {} : { currency: "USD" });
    if (fields.startsWith("pricing_analytics")) return options.denyPricing ? Response.json({ error: { message: "private provider error" } }, { status: 403 })
      : Response.json({ pricing_analytics: { data: [{ data_points: [{ phone_number: options.foreignPhone ? "5511888888888" : number, pricing_category: "SERVICE", pricing_type: "FREE_CUSTOMER_SERVICE", volume: 3, cost: 0 },
        { phone_number: number, pricing_category: "MARKETING", pricing_type: "REGULAR", volume: 2, cost: 0.125 }] }] } });
    return Response.json({ analytics: { phone_numbers: [number], data_points: [{ sent: 6, delivered: 5 }] } });
  };
  return { useCase: new GetWhatsAppUsageUseCase(configs as any, prisma as any), calls, dbScopes };
}
test("reports actual provider totals, free and paid categories, currency and São Paulo month", async () => {
  const { useCase, calls, dbScopes } = setup(); const value = await useCase.execute("merchant-a");
  assert.equal(value.messages.delivered, 5); assert.equal(value.pricing.cost, 0.125); assert.equal(value.pricing.volume, 5);
  assert.equal(value.currency, "USD"); assert.equal(value.processing.failed, 1); assert.equal(value.period.timeZone, "America/Sao_Paulo");
  assert.match(value.period.from, /01T03:00:00.000Z$/);
  assert.equal(value.pricing.categories.find(row => row.category === "SERVICE")?.cost, 0);
  assert.ok(calls.filter(row => !row.url.includes("fields=currency")).every(row => decodeURIComponent(row.url).includes('.phone_numbers(["5511999999001"])')));
  assert.ok(JSON.stringify(dbScopes).includes("merchant-a")); assert.ok(!JSON.stringify(value).includes("secret-"));
});
test("provider rejection remains unavailable and never becomes zero spend", async () => {
  const { useCase } = setup({ denyPricing: true }); const value = await useCase.execute("merchant-a");
  assert.equal(value.pricing.available, false); assert.equal(value.pricing.cost, null); assert.equal(value.messages.delivered, 5);
  assert.ok(value.notices.includes("meta_pricing_analytics_unavailable")); assert.ok(!JSON.stringify(value).includes("private provider error"));
});
test("never includes another number's consumption in a tenant report", async () => {
  const { useCase } = setup({ foreignPhone: true }); const value = await useCase.execute("merchant-a");
  assert.equal(value.pricing.available, false); assert.equal(value.pricing.cost, null);
});
test("currency remains unknown when Meta withholds it", async () => {
  const { useCase } = setup({ missingCurrency: true }); const value = await useCase.execute("merchant-a");
  assert.equal(value.currency, null); assert.equal(value.pricing.cost, 0.125);
});
test("coalesces requests within a tenant and isolates credentials and cached data across tenants", async () => {
  const { useCase, calls } = setup();
  const [a, a2, b] = await Promise.all([useCase.execute("merchant-a"), useCase.execute("merchant-a"), useCase.execute("merchant-b")]);
  assert.deepEqual(a, a2); assert.equal(calls.length, 6);
  assert.ok(calls.filter(row => new URL(row.url).pathname.includes("1111111")).every(row => row.authorization === "Bearer secret-merchant-a"));
  assert.ok(calls.filter(row => new URL(row.url).pathname.includes("2222222")).every(row => row.authorization === "Bearer secret-merchant-b"));
  assert.notEqual(a.managerUrl, b.managerUrl);
});
test("logs safe processing codes without leaking exception text", () => {
  assert.equal(whatsappProcessingErrorCode({ code: "P2002", message: "buyer data" }), "whatsapp_database_P2002");
  assert.equal(whatsappProcessingErrorCode(new Error("whatsapp_send_failed")), "whatsapp_send_failed");
  assert.equal(whatsappProcessingErrorCode(new Error("token=secret buyer=private")), "whatsapp_inbox_processing_failed");
});
