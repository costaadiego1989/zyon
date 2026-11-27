import { expect, it, test, vi } from "vitest";
import type { CashbackConfigurationWrite } from "@zyon/shared-types";
import { cashbackEndpoints } from "./cashback.js";

it("CBX-33 forwards the current scope abort signal for reads and configuration writes", async () => {
  const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json());
  const api = cashbackEndpoints("https://api.example.test", f as typeof fetch), controller = new AbortController();
  await api.getCashbackProgram(controller.signal);
  await api.getCashbackMetrics({}, controller.signal);
  await api.getCashbackCustomers({}, controller.signal);
  await api.getCashbackCustomer("buyer", controller.signal);
  await api.getCashbackTransactions({}, controller.signal);
  await api.saveCashbackDraft({minimumEarnCents:0}, write, controller.signal);
  await api.publishCashbackProgram(write, controller.signal);
  expect(f.mock.calls).toHaveLength(7);
  for (const [,init] of f.mock.calls) expect(init?.signal).toBe(controller.signal);
});

const write = { expectedRevision: "a".repeat(64), idempotencyKey: "cashback-save-one" };
const program = { merchantId: "merchant-a", status: "disabled", draft: { earnRateBps: 500 }, published: null,
  version: 0, updatedAt: "2026-11-18T12:00:00Z", configurationRevision: "b".repeat(64), generalDiscountCapBps: 2000 };
const json = () => new Response(JSON.stringify(program), { headers: { "content-type": "application/json" } });

test("cashback draft transport preserves explicit choices and sends only reviewed command metadata", async () => {
  const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json());
  const api = cashbackEndpoints("https://api.example.test", f as typeof fetch);
  const rules = { minimumEarnCents: 0, expiryDays: null, combination: { allowCoupons: false } };
  const result = await api.saveCashbackDraft(rules, { ...write, actorId: "forged", merchantId: "foreign" } as typeof write);
  const [url, init] = f.mock.calls[0];
  expect(url).toBe("https://api.example.test/v1/dashboard/cashback/program");
  expect(init?.method).toBe("PATCH"); expect(init?.credentials).toBe("include");
  expect(JSON.parse(init?.body as string)).toEqual({ rules, ...write });
  expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(write.idempotencyKey);
  expect(result).toEqual(program);
});

test("cashback publication carries only the exact reviewed revision and stable operation key", async () => {
  const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json());
  const api = cashbackEndpoints("https://api.example.test", f as typeof fetch);
  await api.publishCashbackProgram({ ...write, actorId: "forged", rules: { earnRateBps: 999 } } as typeof write);
  const [url, init] = f.mock.calls[0];
  expect(url).toBe("https://api.example.test/v1/dashboard/cashback/program/publish");
  expect(init?.method).toBe("POST"); expect(JSON.parse(init?.body as string)).toEqual(write);
  expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(write.idempotencyKey);
});

test("cashback retry preserves body and request identity without automatic write replay", async () => {
  const f = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(json());
  const api = cashbackEndpoints("https://api.example.test", f as typeof fetch);
  const rules = { earnRateBps: 500 };
  await expect(api.saveCashbackDraft(rules, write)).rejects.toMatchObject({ status: 0 });
  expect(f).toHaveBeenCalledTimes(1);
  await api.saveCashbackDraft(rules, write);
  expect(f).toHaveBeenCalledTimes(2);
  for (const call of f.mock.calls) {
    expect(JSON.parse(call[1].body)).toEqual({ rules, ...write });
    expect(new Headers(call[1].headers).get("Idempotency-Key")).toBe(write.idempotencyKey);
  }
});

test("cashback stale publication preserves the explicit 409 result without retry", async () => {
  const error = { statusCode: 409, code: "cashback_configuration_changed", message: "cashback_configuration_changed" };
  const f = vi.fn(async () => new Response(JSON.stringify(error), { status: 409 }));
  const api = cashbackEndpoints("https://api.example.test", f as typeof fetch);
  await expect(api.publishCashbackProgram(write)).rejects.toMatchObject({ status: 409, responseBody: JSON.stringify(error) });
  expect(f).toHaveBeenCalledTimes(1);
});

test("cashback queries and CSV export preserve the selected filters and period", async () => {
  const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
  const api = cashbackEndpoints("https://api.example.test", f as typeof fetch);
  const query = { q: "Ana & João", filter: "has_balance" as const, page: 2, pageSize: 10 };
  await api.getCashbackCustomers(query); await api.exportCashback({ ...query, kind: "customers" });
  const period = { from: "2026-11-01T00:00:00-03:00", to: "2026-11-03T23:59:59.999-03:00" };
  await api.getCashbackMetrics(period);
  for (const call of f.mock.calls.slice(0, 2)) {
    const url = new URL(String(call[0]));
    for (const [key, value] of Object.entries(query)) expect(url.searchParams.get(key)).toBe(String(value));
  }
  expect(new URL(String(f.mock.calls[1][0])).searchParams.get("kind")).toBe("customers");
  const metricsUrl = new URL(String(f.mock.calls[2][0]));
  expect(metricsUrl.searchParams.get("from")).toBe(period.from); expect(metricsUrl.searchParams.get("to")).toBe(period.to);
});

test("cashback configuration never sends a write without canonical revision metadata", async () => {
  const f = vi.fn(async () => json()); const api = cashbackEndpoints("https://api.example.test", f as typeof fetch);
  for (const command of [undefined, { expectedRevision: "", idempotencyKey: "one" }, { ...write, idempotencyKey: "" }]) {
    await expect(api.saveCashbackDraft({}, command as CashbackConfigurationWrite)).rejects.toMatchObject({ status: 400 });
    await expect(api.publishCashbackProgram(command as CashbackConfigurationWrite)).rejects.toMatchObject({ status: 400 });
  }
  expect(f).not.toHaveBeenCalled();
});

it("CB-18 sends customer filters and pagination to the merchant-authenticated server without client merchant scope", async () => {
  let url = "";
  const api = cashbackEndpoints("https://api.example.test", (async input => {
    url = String(input); return new Response(JSON.stringify({ items: [], total: 0, page: 2, pageSize: 10 }));
  }) as typeof fetch);
  await api.getCashbackCustomers({ q: "Ana + B", filter: "never_used", page: 2, pageSize: 10 });
  const query = new URL(url);
  expect(query.pathname).toBe("/v1/dashboard/cashback/customers");
  expect(Object.fromEntries(query.searchParams)).toEqual({ q: "Ana + B", filter: "never_used", page: "2", pageSize: "10" });
  expect(query.searchParams.has("merchantId")).toBe(false);
});

it("CB-22 preserves the signed adjustment, explicit null expiry and retry key while encoding the buyer path", async () => {
  let requestUrl = "", payload: unknown, retryKey: string | null = null;
  const api = cashbackEndpoints("https://api.example.test", (async (input, init) => {
    requestUrl = String(input); payload = JSON.parse(String(init?.body)); retryKey = new Headers(init?.headers).get("Idempotency-Key");
    return new Response("{}");
  }) as typeof fetch);
  const adjustment = { amountCents: 1250, reason: "Correção autorizada do pedido", idempotencyKey: "cashback-retry-1", expiryDays: null };
  await api.adjustCashbackCustomer("buyer/a", adjustment);
  expect(requestUrl).toBe("https://api.example.test/v1/dashboard/cashback/customers/buyer%2Fa/adjustments");
  expect(payload).toEqual(adjustment); expect(retryKey).toBe("cashback-retry-1");
});

it("CB-18 exports the selected dataset and filters through authenticated fetch and reports an HTTP failure", async () => {
  const requests: string[] = [];
  const api = cashbackEndpoints("https://api.example.test", (async input => {
    requests.push(String(input)); return new Response("data,valor\ncliente,1", { headers: { "Content-Type": "text/csv" } });
  }) as typeof fetch);
  const blob = await api.exportCashback({ kind: "customers", q: "Ana", filter: "used" });
  expect(await blob.text()).toBe("data,valor\ncliente,1");
  expect(Object.fromEntries(new URL(requests[0]).searchParams)).toEqual({ kind: "customers", q: "Ana", filter: "used" });
  const denied = cashbackEndpoints("https://api.example.test", (async () => new Response("denied", { status: 403 })) as typeof fetch);
  await expect(denied.exportCashback({ kind: "transactions" })).rejects.toMatchObject({ status: 403 });
});
