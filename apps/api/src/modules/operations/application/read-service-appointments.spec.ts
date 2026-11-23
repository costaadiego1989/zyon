import assert from "node:assert/strict";
import test from "node:test";
import { ReadServiceAppointments, parseAppointmentListQuery } from "./read-service-appointments.js";

const actor = { merchantId: "merchant", userId: "owner", role: "owner" };
const query = { fromDate: "2030-01-01", toDate: "2030-01-02" };
const states = ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"] as const;
function row(id: string, status: typeof states[number] = "scheduled", patch: Record<string, unknown> = {}) {
  return { id, merchantId: "merchant", professionalId: "professional", productId: "service", variantId: "variant",
    startsAt: new Date("2030-01-01T13:00:00Z"), endsAt: new Date("2030-01-01T13:30:00Z"), timeZone: "UTC", durationMinutes: 30,
    priceInCents: 5000, currency: "BRL", policyVersion: 2, operationalStatus: status, origin: "manual", version: 3,
    customerSnapshot: { name: "Customer", phone: "+5521999990000", email: "buyer@example.test", secret: "private-customer" },
    product: { name: "Consultation", categoryId: "category" }, professional: { publicName: "Professional" },
    payments: [{ id: "payment", mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", version: 1,
      requiresRegularization: false, receivedAt: null, providerEvidence: "private-provider", providerPaymentId: "private-provider-id" }], ...patch };
}
function fixture(rows = [row("a"), row("b", "pending"), row("foreign", "completed", { merchantId: "foreign" })]) {
  const calls: any[] = [], now = new Date("2030-01-01T12:00:00Z");
  let mode = "services", classified = true;
  const matches = (value: any, where: any): boolean => {
    if (where.AND && !where.AND.every((part: any) => matches(value, part))) return false;
    if (where.OR && !where.OR.some((part: any) => matches(value, part))) return false;
    for (const key of ["merchantId", "professionalId", "productId", "operationalStatus", "id"])
      if (typeof where[key] === "string" && value[key] !== where[key]) return false;
    if (where.id?.gt && value.id <= where.id.gt) return false;
    if (where.startsAt instanceof Date && value.startsAt.getTime() !== where.startsAt.getTime()) return false;
    for (const key of ["gte", "gt", "lt"])
      if (where.startsAt?.[key] && !(key === "gte" ? value.startsAt >= where.startsAt[key] : key === "gt" ? value.startsAt > where.startsAt[key] : value.startsAt < where.startsAt[key])) return false;
    if (where.product && (value.merchantId !== where.product.merchantId || value.product.categoryId !== where.product.categoryId)) return false;
    return true;
  };
  const tx = {
    merchant: { findUnique: async () => ({ businessMode: mode, businessModeSelectedAt: classified ? now : null, businessModeNeedsReview: !classified }) },
    product: { count: async () => 0 }, serviceReservation: { count: async () => 0 },
    $queryRaw: async () => [{ asOf: now }],
    serviceAppointment: {
      count: async (input: any) => { calls.push(["count", input]); return rows.filter(value => matches(value, input.where)).length; },
      groupBy: async (input: any) => { calls.push(["group", input]); return states.map(operationalStatus => ({ operationalStatus,
        _count: { _all: rows.filter(value => value.operationalStatus === operationalStatus && matches(value, input.where)).length } })); },
      findFirst: async (input: any) => { calls.push(["first", input]); return rows.find(value => matches(value, input.where)) ?? null; },
      findMany: async (input: any) => { calls.push(["page", input]); return rows.filter(value => matches(value, input.where))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id)).slice(0, input.take); },
    },
    appointmentAudit: { findMany: async () => [{ id: "audit", action: "manual_create", actorId: "owner", origin: "manual", version: 1,
      occurredAt: now, before: { privateLease: "private-before" }, after: { privatePaymentContinuation: "private-after" } }] },
  };
  const prisma = { $transaction: async (callback: (tx: unknown) => unknown, options: unknown) => { calls.push(["transaction", options]); return callback(tx); } };
  return { reader: new ReadServiceAppointments(prisma as never), rows, calls, setMode: (next: string) => { mode = next; },
    unclassify: () => { classified = false; } };
}

test("T41 factual appointment reader", async t => {
  await t.test("inclusive Brasilia civil dates use canonical UTC boundaries without changing historical zones", () => {
    const parsed = parseAppointmentListQuery(query);
    assert.equal(parsed.from.toISOString(), "2030-01-01T03:00:00.000Z");
    assert.equal(parsed.to.toISOString(), "2030-01-03T03:00:00.000Z");
    assert.equal(parsed.limit, 25);
  });
  await t.test("malformed, reversed and unbounded civil periods are rejected", () => {
    for (const patch of [{ fromDate: "2030-02-30" }, { fromDate: "2030-01-03" }, { toDate: "2030-02-01" },
      { fromDate: "2030-01-01T00:00:00Z" }, { toDate: ["2030-01-02"] }])
      assert.throws(() => parseAppointmentListQuery({ ...query, ...patch }));
  });
  await t.test("historical Brasilia daylight-saving gap uses the first instant of the civil day", () => {
    const parsed = parseAppointmentListQuery({ fromDate: "2018-11-04", toDate: "2018-11-04" });
    assert.equal(parsed.from.toISOString(), "2018-11-04T03:00:00.000Z");
    assert.equal(parsed.to.toISOString(), "2018-11-05T02:00:00.000Z");
    assert.equal(parsed.to.getTime() - parsed.from.getTime(), 23 * 60 * 60 * 1000);
  });
  await t.test("strict filters cannot inject tenant, actor, versions or query structures", () => {
    for (const patch of [{ merchantId: "foreign" }, { role: "owner" }, { productId: ["service"] }, { professionalId: " " },
      { status: "paid" }, { status: ["scheduled"] }, { limit: "0" }, { limit: "101" }, { limit: "1.5" }, { limit: 10 }])
      assert.throws(() => parseAppointmentListQuery({ ...query, ...patch }));
    assert.throws(() => parseAppointmentListQuery(null as never));
  });
  await t.test("only owner and admin can read even when invoked without the controller", async () => {
    const f = fixture();
    for (const role of ["staff", "buyer", "service", ""]) await assert.rejects(f.reader.list({ ...actor, role }, query), error =>
      (error as { getStatus(): number }).getStatus() === 403);
    assert.equal((await f.reader.list({ ...actor, role: "admin" }, query)).totalCount, 2);
  });
  await t.test("products and unclassified companies cannot read service customer records", async () => {
    const f = fixture(); f.setMode("products"); await assert.rejects(f.reader.list(actor, query), /services_mode_required/);
    f.setMode("services"); f.unclassify(); await assert.rejects(f.reader.list(actor, query), /business_mode_classification_required/);
  });
  await t.test("tenant list and missing or foreign detail disclose no foreign record", async () => {
    const f = fixture(), result = await f.reader.list(actor, query);
    assert.deepEqual(result.items.map(value => value.id), ["a", "b"]); assert.equal(result.totalCount, 2);
    for (const id of ["foreign", "absent"]) await assert.rejects(f.reader.detail(actor, id), error => (error as { getStatus(): number }).getStatus() === 404);
  });
  await t.test("all declared filters govern rows and the unpaginated six-state counts identically", async () => {
    const f = fixture(), result = await f.reader.list(actor, { ...query, professionalId: "professional", productId: "service", categoryId: "category", status: "pending" });
    assert.deepEqual(result.items.map(value => value.id), ["b"]); assert.equal(result.totalCount, 1);
    assert.deepEqual(result.countsByStatus, { pending: 1, scheduled: 0, in_service: 0, completed: 0, no_show: 0, cancelled: 0 });
    const count = f.calls.find(([kind]) => kind === "count")[1].where;
    assert.deepEqual(count, { merchantId: "merchant", startsAt: { gte: new Date("2030-01-01T03:00Z"), lt: new Date("2030-01-03T03:00Z") },
      professionalId: "professional", productId: "service", operationalStatus: "pending", product: { merchantId: "merchant", categoryId: "category" } });
  });
  await t.test("page size and cursor do not shrink totals or lose equal-time appointments", async () => {
    const f = fixture(), first = await f.reader.list(actor, { ...query, limit: "1" });
    assert.deepEqual(first.items.map(value => value.id), ["a"]); assert.ok(first.nextCursor); assert.equal(first.totalCount, 2);
    const next = await f.reader.list(actor, { ...query, limit: "1", cursor: first.nextCursor! });
    assert.deepEqual(next.items.map(value => value.id), ["b"]); assert.equal(next.nextCursor, null); assert.equal(next.totalCount, 2);
    assert.deepEqual(next.countsByStatus, first.countsByStatus);
  });
  await t.test("cursor is bound to tenant, exact filters and a still-matching anchor", async () => {
    const f = fixture(), page = await f.reader.list(actor, { ...query, limit: "1" });
    await assert.rejects(f.reader.list(actor, { ...query, limit: "1", status: "pending", cursor: page.nextCursor! }), /appointment_cursor_scope_mismatch/);
    await assert.rejects(f.reader.list({ ...actor, merchantId: "foreign" }, { ...query, limit: "1", cursor: page.nextCursor! }), /appointment_cursor_scope_mismatch/);
    f.rows.splice(0, 1); await assert.rejects(f.reader.list(actor, { ...query, limit: "1", cursor: page.nextCursor! }), /appointment_cursor_invalid/);
  });
  await t.test("factual DTO preserves identifiers, cents, current state and historical instants and zone", async () => {
    const f = fixture(), value = (await f.reader.list(actor, query)).items[0]!;
    assert.deepEqual({ id: value.id, merchantId: value.merchantId, professionalId: value.professionalId, productId: value.productId,
      variantId: value.variantId, startsAt: value.startsAt, endsAt: value.endsAt, timeZone: value.timeZone, durationMinutes: value.durationMinutes,
      priceInCents: value.priceInCents, currency: value.currency, operationalStatus: value.operationalStatus, version: value.version },
    { id: "a", merchantId: "merchant", professionalId: "professional", productId: "service", variantId: "variant",
      startsAt: "2030-01-01T13:00:00.000Z", endsAt: "2030-01-01T13:30:00.000Z", timeZone: "UTC", durationMinutes: 30,
      priceInCents: 5000, currency: "BRL", operationalStatus: "scheduled", version: 3 });
    assert.deepEqual(value.customer, { name: "Customer", phone: "+5521999990000", email: "buyer@example.test" });
    assert.equal(JSON.stringify(value).includes("private-"), false); assert.equal(Object.hasOwn(value, "paid"), false);
  });
  await t.test("payment facts do not infer attendance or hide approved payments on pending appointments", async () => {
    const pending = row("pending", "pending"); pending.payments[0]!.status = "approved";
    const f = fixture([pending]), value = (await f.reader.detail(actor, "pending"));
    assert.equal(value.operationalStatus, "pending"); assert.equal(value.payments[0]!.status, "approved");
    assert.equal(value.payments[0]!.amountCents, 5000); assert.equal(value.payments[0]!.requiresRegularization, false);
    assert.equal(Object.hasOwn(value, "attended"), false); assert.equal(Object.hasOwn(value, "canCancel"), false);
  });
  await t.test("detail history contains bounded public metadata without private before/after", async () => {
    const value = await fixture().reader.detail(actor, "a");
    assert.deepEqual(value.history, [{ id: "audit", action: "manual_create", actorId: "owner", origin: "manual", version: 1, occurredAt: "2030-01-01T12:00:00.000Z" }]);
    assert.equal(value.historyPartial, false); assert.equal(JSON.stringify(value).includes("private-"), false);
  });
  await t.test("read scope, page, counts and database asOf share one RepeatableRead snapshot", async () => {
    const f = fixture(), result = await f.reader.list(actor, query);
    assert.deepEqual(f.calls.filter(([kind]) => kind === "transaction"), [["transaction", { isolationLevel: "RepeatableRead" }]]);
    assert.equal(result.asOf, "2030-01-01T12:00:00.000Z"); assert.equal(result.timeZone, "America/Sao_Paulo");
    assert.equal(result.totalCount, Object.values(result.countsByStatus).reduce((a, b) => a + b, 0));
  });
  await t.test("every six-state column is counted from source and no order/payment writer is available", async () => {
    const f = fixture(states.map((status, index) => row(String(index), status))), before = structuredClone(f.rows);
    const result = await f.reader.list(actor, query); assert.equal(result.totalCount, 6);
    assert.deepEqual(Object.values(result.countsByStatus), [1, 1, 1, 1, 1, 1]); assert.deepEqual(f.rows, before);
  });
  await t.test("unbounded payment projection fails honestly instead of truncating facts", async () => {
    const value = row("a"); value.payments = Array.from({ length: 101 }, () => ({ ...value.payments[0]! }));
    await assert.rejects(fixture([value]).reader.detail(actor, "a"), /appointment_financial_source_limit/);
  });
});
