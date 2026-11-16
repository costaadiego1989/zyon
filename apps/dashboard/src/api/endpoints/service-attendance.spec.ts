import { describe, expect, it } from "vitest";
import { createDashboardApi } from "../index.js";
import { DashboardHttpError, DashboardJsonParseError } from "../http/error.js";
import { classifyServiceAttendanceError, serviceAttendanceEndpoints } from "./service-attendance.js";

const profile = { id: "merchant/a", user_id: "operator-a" };
const root = "https://api.example.test/v1/merchants/merchant%2Fa";
const professional = {
  id: "professional/a", merchantId: profile.id, publicName: "Ana", publicProfile: { description: "Fisioterapia", specialties: ["Coluna"] },
  timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, version: 7,
  createdAt: "2026-11-16T12:00:00.000Z", updatedAt: "2026-11-16T13:00:00.000Z",
  services: [{ id: "link-a", productId: "service-a", version: 3 }, { id: "link-b", productId: "service-b", version: 2 }],
};
const recurring = { weekday: 1, startMinute: 480, endMinute: 720, validFrom: null, validUntil: "2026-12-01T00:00:00.000Z" };
const exception = { kind: "block" as const, startsAt: "2026-11-23T12:00:00.000Z", endsAt: "2026-11-23T13:00:00.000Z", timeZone: "America/Sao_Paulo", reason: "Ausência", isActive: true };
const category = {
  id: "category/a", name: "Saúde", slug: "saude", parent_id: null, description: "Atendimentos", image_url: null,
  is_active: true, sort_order: 2, created_at: "2026-11-16T12:00:00.000Z", updated_at: "2026-11-16T13:00:00.000Z",
};
type RecordedRequest = { url: string; method: string; body: unknown; headers: Headers; credentials: RequestCredentials | undefined; cache: RequestCache | undefined; signal: AbortSignal | null | undefined };
function setup(response: unknown) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers), credentials: init?.credentials, cache: init?.cache, signal: init?.signal });
    return Response.json(response);
  }) as typeof fetch;
  return { requests, api: serviceAttendanceEndpoints("https://api.example.test", fetchImpl).serviceAttendance(profile) };
}

describe("T73", () => {
  it("composes the scoped client in the existing dashboard API without adding booking operations", async () => {
    const api = createDashboardApi({ baseUrl: "https://api.example.test///", fetchImpl: (async () => Response.json({ items: [], nextCursor: null })) as typeof fetch });
    const scoped = api.serviceAttendance(profile);
    await expect(scoped.listProfessionals()).resolves.toEqual({ items: [], nextCursor: null });
    expect(Object.keys(scoped).sort()).toEqual([
      "createAvailabilityException", "createCategory", "createProfessional", "deactivateProfessional", "deleteCategory", "getAvailableDates", "getAvailableSlots",
      "getPolicy", "getProfessionalAvailability", "listCategories", "listEligibleProfessionals", "listProfessionals", "reorderCategories", "saveProfessionalAvailability", "updateAvailabilityException", "updateCategory", "updatePolicy", "updateProfessional",
    ].sort());
  });

  it("paginates professionals with the captured authenticated scope and preserves all active service links", async () => {
    const { api, requests } = setup({ items: [professional], nextCursor: "professional/b" });
    const abort = new AbortController();
    await expect(api.listProfessionals({ limit: 25, cursor: "professional/a?next=1" }, { signal: abort.signal }))
      .resolves.toEqual({ items: [professional], nextCursor: "professional/b" });
    expect(requests[0]).toMatchObject({ url: root + "/service-professionals?limit=25&cursor=professional%2Fa%3Fnext%3D1", method: "GET", credentials: "include", cache: "no-store", signal: abort.signal });
    expect(requests[0].headers.has("Idempotency-Key")).toBe(false);
    expect(requests[0].body).toBeUndefined();
  });

  it("creates a professional using only public fields and server-owned associations", async () => {
    const { api, requests } = setup(professional);
    const input = { publicName: "Ana", publicProfile: { description: "Fisioterapia", specialties: ["Coluna"], token: "private-canary" }, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, productIds: ["service-a", "service-b"], merchantId: "foreign", actorId: "forged", priceInCents: 1, connectionToken: "private-canary" };
    await expect(api.createProfessional(input, { idempotencyKey: "create-professional-1" })).resolves.toEqual(professional);
    expect(requests[0]).toMatchObject({ url: root + "/service-professionals", method: "POST", body: { publicName: "Ana", publicProfile: professional.publicProfile, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, productIds: ["service-a", "service-b"] } });
    expect(requests[0].headers.get("Idempotency-Key")).toBe("create-professional-1");
    expect(requests[0].headers.get("Content-Type")).toBe("application/json");
    expect(JSON.stringify(requests[0].body)).not.toMatch(/foreign|forged|private-canary|priceInCents/);
  });

  it("preserves expectedVersion and explicit complete link replacement without inventing a separate link endpoint", async () => {
    const { api, requests } = setup({ ...professional, version: 8 });
    await expect(api.updateProfessional(professional.id, { expectedVersion: 7, productIds: ["service-a", "service-b", "service-c"] })).resolves.toMatchObject({ version: 8 });
    expect(requests[0]).toMatchObject({ url: root + "/service-professionals/professional%2Fa", method: "PATCH", body: { expectedVersion: 7, productIds: ["service-a", "service-b", "service-c"] } });
    expect(requests[0].headers.get("Idempotency-Key")).toBeTruthy();
    await api.updateProfessional(professional.id, { expectedVersion: 8, publicName: "Ana Silva" });
    await api.updateProfessional(professional.id, { expectedVersion: 9, productIds: [] });
    expect(requests[1].body).toEqual({ expectedVersion: 8, publicName: "Ana Silva" });
    expect(requests[2].body).toEqual({ expectedVersion: 9, productIds: [] });
  });

  it("deactivates with the professional version and retains the actual returned historical identity", async () => {
    const saved = { ...professional, isActive: false, isPublished: false, version: 8 };
    const { api, requests } = setup(saved);
    await expect(api.deactivateProfessional(professional.id, 7)).resolves.toEqual(saved);
    expect(requests[0]).toMatchObject({ url: root + "/service-professionals/professional%2Fa/deactivate", method: "POST", body: { expectedVersion: 7 } });
  });

  it("reads eligible professionals and canonical duration and price without calculating alternatives", async () => {
    const item = { merchantId: profile.id, professionalId: professional.id, professionalVersion: 7, professionalServiceId: "link-a", productId: "service-a", variantId: "variant/a", categoryId: "category-a", durationMinutes: 55, timeZone: "America/Sao_Paulo", priceInCents: 12345, currency: "BRL", publicName: "Ana", publicProfile: professional.publicProfile };
    const { api, requests } = setup({ items: [item], nextCursor: "next/a" });
    const query = { productId: "service-a", variantId: "variant/a", limit: 10, cursor: "next/a", merchantId: "foreign", priceInCents: 1 };
    await expect(api.listEligibleProfessionals(query)).resolves.toEqual({ items: [item], nextCursor: "next/a" });
    expect(requests[0].url).toBe(root + "/service-professionals/eligible?productId=service-a&variantId=variant%2Fa&limit=10&cursor=next%2Fa");
  });

  it("reads recurring rows and one page of exceptions with the server version and cursor", async () => {
    const response = { professionalId: professional.id, version: 7, timeZone: "America/Sao_Paulo", rows: [{ ...recurring, id: "row-a", version: 7 }], exceptions: [{ ...exception, id: "exception-a", version: 2 }], nextCursor: "exception/a" };
    const { api, requests } = setup(response);
    await expect(api.getProfessionalAvailability(professional.id, { cursor: "exception/a" })).resolves.toEqual(response);
    expect(requests[0].url).toBe(root + "/service-professionals/professional%2Fa/availability?cursor=exception%2Fa");
  });

  it("replaces recurring availability with the exact CAS envelope and interval fields", async () => {
    const response = { professionalId: professional.id, version: 8, timeZone: "America/Sao_Paulo", rows: [{ ...recurring, id: "row-a", version: 8 }] };
    const { api, requests } = setup(response);
    const input = { expectedVersion: 7, timeZone: "America/Sao_Paulo", rows: [{ ...recurring, merchantId: "foreign", capacity: 100 }], merchantId: "foreign", slots: ["fake"] };
    await expect(api.saveProfessionalAvailability(professional.id, input)).resolves.toEqual(response);
    expect(requests[0]).toMatchObject({ url: root + "/service-professionals/professional%2Fa/availability", method: "PUT", body: { expectedVersion: 7, timeZone: "America/Sao_Paulo", rows: [recurring] } });
  });

  it.each(["one_off", "block"] as const)("creates a real %s exception without sending an exception ID in the body", async kind => {
    const saved = { professionalId: professional.id, version: 8, exception: { ...exception, kind, id: "exception-a", version: 1 } };
    const { api, requests } = setup(saved);
    const input = { ...exception, kind, expectedVersion: 7, id: "forged-id", merchantId: "foreign", actorId: "forged" };
    await expect(api.createAvailabilityException(professional.id, input)).resolves.toEqual(saved);
    expect(requests[0]).toMatchObject({ url: root + "/service-professionals/professional%2Fa/availability-exceptions", method: "POST", body: { ...exception, kind, expectedVersion: 7 } });
  });

  it("edits an exception through its scoped URL and preserves explicit deactivation", async () => {
    const { api, requests } = setup({ professionalId: professional.id, version: 9, exception: { ...exception, id: "exception/a", version: 2, isActive: false } });
    await expect(api.updateAvailabilityException(professional.id, "exception/a", { ...exception, expectedVersion: 8, isActive: false }))
      .resolves.toMatchObject({ version: 9, exception: { id: "exception/a", version: 2, isActive: false } });
    expect(requests[0]).toMatchObject({ url: root + "/service-professionals/professional%2Fa/availability-exceptions/exception%2Fa", method: "PATCH", body: { ...exception, expectedVersion: 8, isActive: false } });
  });

  it.each(["ready", "empty", "stale"] as const)("preserves server %s availability and has no client slot calculation", async status => {
    const meta = { status, professionalVersion: 8, policyVersion: 3, timeZone: "America/Sao_Paulo", durationMinutes: 55, asOf: "2026-11-16T12:00:00.000Z", dates: status === "ready" ? ["2026-11-23"] : [] };
    const slot = { startsAt: "2026-11-23T12:00:00.000Z", endsAt: "2026-11-23T12:55:00.000Z", date: "2026-11-23", startTime: "09:00", timeZone: "America/Sao_Paulo", durationMinutes: 55 };
    const dates = setup(meta), slots = setup({ ...meta, slots: status === "ready" ? [slot] : [] });
    const ids = { professionalId: professional.id, productId: "service-a", variantId: "variant/a", expectedVersion: 7 };
    await expect(dates.api.getAvailableDates({ ...ids, fromDate: "2026-11-23", toDate: "2026-11-24" })).resolves.toEqual(meta);
    await expect(slots.api.getAvailableSlots({ ...ids, date: "2026-11-23" })).resolves.toEqual({ ...meta, slots: status === "ready" ? [slot] : [] });
    expect(dates.requests[0].url).toBe(root + "/service-availability/dates?productId=service-a&variantId=variant%2Fa&professionalId=professional%2Fa&fromDate=2026-11-23&toDate=2026-11-24&expectedVersion=7");
    expect(slots.requests[0].url).toBe(root + "/service-availability/slots?productId=service-a&variantId=variant%2Fa&professionalId=professional%2Fa&date=2026-11-23&expectedVersion=7");
  });

  it.each(["unconfigured", "invalid"] as const)("preserves %s policy instead of manufacturing a configured default", async status => {
    const response = { status, version: status === "unconfigured" ? 0 : 2, policy: null };
    const { api, requests } = setup(response);
    await expect(api.getPolicy()).resolves.toEqual(response);
    expect(requests[0]).toMatchObject({ url: "https://api.example.test/v1/merchants/me/service-business-policy", method: "GET" });
  });

  it("configures the current company policy using version zero and explicit payment/hold choices", async () => {
    const policy = { holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance" as const, admissionsEnabled: false };
    const { api, requests } = setup({ status: "configured", version: 1, policy });
    await expect(api.updatePolicy({ ...policy, expectedVersion: 0 })).resolves.toEqual({ status: "configured", version: 1, policy });
    expect(requests[0]).toMatchObject({ url: "https://api.example.test/v1/merchants/me/service-business-policy", method: "PUT", body: { ...policy, expectedVersion: 0 } });
  });

  it("reuses category CRUD routes and the actual camelCase writes and snake_case returned DTO", async () => {
    const list = setup([{ ...category, product_count: 2 }]);
    await expect(list.api.listCategories()).resolves.toEqual([{ ...category, product_count: 2 }]);
    expect(list.requests[0].url).toBe(root + "/categories");
    const { api, requests } = setup(category);
    await expect(api.createCategory({ name: "Saúde", slug: "saude", parentId: "parent-a", description: "Atendimentos", imageUrl: "https://images.example.test/a.png" })).resolves.toEqual(category);
    await expect(api.updateCategory("category/a", { name: "Saúde", parentId: null, isActive: false, sortOrder: 0 })).resolves.toEqual(category);
    expect(requests[0]).toMatchObject({ url: root + "/categories", method: "POST", body: { name: "Saúde", slug: "saude", parentId: "parent-a", description: "Atendimentos", imageUrl: "https://images.example.test/a.png" } });
    expect(requests[1]).toMatchObject({ url: root + "/categories/category%2Fa", method: "PUT", body: { name: "Saúde", parentId: null, isActive: false, sortOrder: 0 } });
    expect(category).not.toHaveProperty("merchant_id");
  });

  it("preserves actual delete and reorder acknowledgements without category capacity fields", async () => {
    const deletion = setup({ deleted: true }), reorder = setup({ reordered: true });
    await expect(deletion.api.deleteCategory("category/a")).resolves.toEqual({ deleted: true });
    const items = [{ id: "category/a", sort_order: 0, capacity: 99, merchantId: "foreign" }];
    await expect(reorder.api.reorderCategories(items)).resolves.toEqual({ reordered: true });
    expect(deletion.requests[0]).toMatchObject({ url: root + "/categories/category%2Fa", method: "DELETE", body: undefined });
    expect(reorder.requests[0]).toMatchObject({ url: root + "/categories/reorder", method: "PATCH", body: { items: [{ id: "category/a", sort_order: 0 }] } });
  });

  it("captures profile identity once and filters runtime-added query authority", async () => {
    const mutable = { ...profile };
    const requests: string[] = [];
    const api = serviceAttendanceEndpoints("https://api.example.test", (async url => { requests.push(String(url)); return Response.json({ items: [], nextCursor: null }); }) as typeof fetch).serviceAttendance(mutable);
    mutable.id = "foreign";
    const query = { limit: 1, merchantId: "foreign", userId: "forged", connectionToken: "private-canary" };
    await api.listProfessionals(query);
    expect(requests).toEqual([root + "/service-professionals?limit=1"]);
  });

  it.each([null, undefined, { id: "", user_id: "operator" }, { id: "merchant", user_id: "" }])("rejects missing authenticated profile %j before HTTP", badProfile => {
    const fetchImpl = (() => { throw new Error("HTTP must not run"); }) as typeof fetch;
    expect(() => serviceAttendanceEndpoints("https://api.example.test", fetchImpl).serviceAttendance(badProfile as never)).toThrow("authenticated_service_profile_required");
  });

  it.each(["", " ", ".", ".."])("rejects invalid resource ID %j before an HTTP request", id => {
    const { api, requests } = setup({});
    expect(() => api.deactivateProfessional(id, 7)).toThrow("invalid_service_resource_id");
    expect(requests).toEqual([]);
  });

  it.each([[400, "invalid"], [403, "forbidden"], [404, "not_found"], [409, "conflict"], [429, "rate_limited"], [500, "server"]] as const)("preserves HTTP %i as %s with no retry or fabricated success", async (status, kind) => {
    const body = JSON.stringify({ message: "actual_server_code" });
    const requests: string[] = [];
    const api = serviceAttendanceEndpoints("https://api.example.test", (async input => { requests.push(String(input)); return new Response(body, { status, headers: { "Retry-After": "3" } }); }) as typeof fetch).serviceAttendance(profile);
    const error = await api.updateProfessional(professional.id, { expectedVersion: 7, publicName: "Ana" }).catch(error => error);
    expect(error).toBeInstanceOf(DashboardHttpError);
    expect(error).toMatchObject({ status, responseBody: body, retryAfterSeconds: 3 });
    expect(classifyServiceAttendanceError(error)).toBe(kind);
    expect(requests).toEqual([root + "/service-professionals/professional%2Fa"]);
  });

  it("preserves an unknown network mutation outcome without automatic resend", async () => {
    const requests: string[] = [];
    const api = serviceAttendanceEndpoints("https://api.example.test", (async input => { requests.push(String(input)); throw new Error("offline"); }) as typeof fetch).serviceAttendance(profile);
    const error = await api.createProfessional({ publicName: "Ana", timeZone: "America/Sao_Paulo" }).catch(error => error);
    expect(error).toBeInstanceOf(DashboardHttpError);
    expect(error).toMatchObject({ status: 0, responseBody: "network_error: API unreachable" });
    expect(classifyServiceAttendanceError(error)).toBe("network");
    expect(requests).toEqual([root + "/service-professionals"]);
  });

  it("keeps malformed successful JSON as a parse error and classifies unknown failures conservatively", async () => {
    const api = serviceAttendanceEndpoints("https://api.example.test", (async () => new Response("broken-json")) as typeof fetch).serviceAttendance(profile);
    const error = await api.listProfessionals().catch(error => error);
    expect(error).toBeInstanceOf(DashboardJsonParseError);
    expect(classifyServiceAttendanceError(error)).toBe("invalid_response");
    expect(classifyServiceAttendanceError(new Error("unrecognized"))).toBe("unknown");
  });

  it("uses only the existing authenticated 401 refresh and keeps the same mutation idempotency key", async () => {
    const seen: Array<{ url: string; key: string | null; body: unknown }> = [];
    let attempts = 0;
    const api = serviceAttendanceEndpoints("https://api.example.test", (async (input, init) => {
      const url = String(input);
      seen.push({ url, key: new Headers(init?.headers).get("Idempotency-Key"), body: init?.body == null ? null : JSON.parse(String(init.body)) });
      if (url.endsWith("/auth/refresh")) return Response.json({ access_token: "synthetic-local-session" });
      return ++attempts === 1 ? Response.json({}, { status: 401 }) : Response.json(professional);
    }) as typeof fetch).serviceAttendance(profile);
    await expect(api.updateProfessional(professional.id, { expectedVersion: 7, publicName: "Ana" }, { idempotencyKey: "same-operation" })).resolves.toEqual(professional);
    expect(seen).toEqual([
      { url: root + "/service-professionals/professional%2Fa", key: "same-operation", body: { publicName: "Ana", expectedVersion: 7 } },
      { url: "https://api.example.test/v1/auth/refresh", key: null, body: null },
      { url: root + "/service-professionals/professional%2Fa", key: "same-operation", body: { publicName: "Ana", expectedVersion: 7 } },
    ]);
  });

  it("returns the original unauthorized failure when session refresh is refused without resending the write", async () => {
    const requests: string[] = [];
    const body = JSON.stringify({ message: "human_session_required" });
    const api = serviceAttendanceEndpoints("https://api.example.test", (async input => {
      requests.push(String(input));
      return new Response(body, { status: 401 });
    }) as typeof fetch).serviceAttendance(profile);
    const error = await api.deactivateProfessional(professional.id, 7).catch(error => error);
    expect(error).toMatchObject({ status: 401, responseBody: body });
    expect(classifyServiceAttendanceError(error)).toBe("unauthorized");
    expect(requests).toEqual([root + "/service-professionals/professional%2Fa/deactivate", "https://api.example.test/v1/auth/refresh"]);
  });
});
