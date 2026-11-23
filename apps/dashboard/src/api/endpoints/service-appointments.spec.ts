import { describe, expect, it } from "vitest";
import { createDashboardApi } from "../index.js";
import { serviceAppointmentEndpoints } from "./service-appointments.js";

const profile = { id: "merchant/a", user_id: "owner-a" };
const query = { fromDate: "2030-01-01", toDate: "2030-01-02" };
function setup(body: unknown = { items: [] }, status = 200) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json(body, { status });
  }) as typeof fetch;
  return { requests, fetchImpl, client: serviceAppointmentEndpoints("https://api.example.test", fetchImpl).serviceAppointments(profile) };
}

describe("T102 appointment HTTP reads", () => {
  it("registers the separate read client without adding mutations or changing the attendance client", async () => {
    const f = setup(), api = createDashboardApi({ baseUrl: "https://api.example.test///", fetchImpl: f.fetchImpl });
    await api.serviceAppointments(profile).list(query);
    expect(Object.keys(api.serviceAppointments(profile)).sort()).toEqual(["detail", "list"]);
    expect(f.requests[0].url).toBe("https://api.example.test/v1/merchants/merchant%2Fa/service-appointments?fromDate=2030-01-01&toDate=2030-01-02");
  });
  it("captures the authenticated merchant and forwards only canonical filters and the exact cursor", async () => {
    const f = setup(), mutable = { ...profile };
    const client = serviceAppointmentEndpoints("https://api.example.test", f.fetchImpl).serviceAppointments(mutable);
    mutable.id = "foreign";
    await client.list({ ...query, professionalId: "professional/a", categoryId: "category", productId: "service", status: "pending", limit: "25", cursor: "opaque_cursor",
      merchantId: "foreign", actorId: "forged", timeZone: "UTC" } as never);
    expect(f.requests[0].url).toBe("https://api.example.test/v1/merchants/merchant%2Fa/service-appointments?fromDate=2030-01-01&toDate=2030-01-02&professionalId=professional%2Fa&categoryId=category&productId=service&status=pending&limit=25&cursor=opaque_cursor");
    expect(f.requests[0].init?.method).toBe("GET");
    expect(f.requests[0].init?.body).toBeNull();
    expect(new Headers(f.requests[0].init?.headers).has("Idempotency-Key")).toBe(false);
  });
  it("uses session/no-store transport and preserves cancellation without calculating appointment facts", async () => {
    const body = { items: [{ id: "a" }], totalCount: 100, nextCursor: "cursor", countsByStatus: { scheduled: 100 }, asOf: "2030-01-01T12:00:00Z" };
    const f = setup(body), controller = new AbortController();
    await expect(f.client.list(query, { signal: controller.signal })).resolves.toEqual(body);
    expect(f.requests[0].init).toMatchObject({ credentials: "include", cache: "no-store", signal: controller.signal });
  });
  it("reads a detail with the encoded canonical appointment ID", async () => {
    const f = setup({ id: "appointment/a", payments: [] });
    await expect(f.client.detail("appointment/a")).resolves.toEqual({ id: "appointment/a", payments: [] });
    expect(f.requests[0].url).toBe("https://api.example.test/v1/merchants/merchant%2Fa/service-appointments/appointment%2Fa");
  });
  it("rejects invalid identities and query values before sending any request", () => {
    const f = setup();
    for (const bad of [null, { id: "", user_id: "owner" }, { id: "merchant", user_id: "" }])
      expect(() => serviceAppointmentEndpoints("https://api.example.test", f.fetchImpl).serviceAppointments(bad as never)).toThrow();
    for (const bad of ["", ".", "..", " a "]) expect(() => f.client.detail(bad)).toThrow();
    for (const patch of [{ fromDate: "2030-02-30" }, { toDate: "2029-12-31" }, { toDate: "2030-02-01" },
      { limit: "101" }, { status: "paid" }, { professionalId: ["p"] }, { cursor: "a?b" }])
      expect(() => f.client.list({ ...query, ...patch } as never)).toThrow();
    expect(f.requests).toEqual([]);
  });
  it.each([403, 404, 409, 503])("preserves HTTP %s as an error without false empty data", async status => {
    const f = setup({ code: "service_read_failed" }, status);
    await expect(f.client.list(query)).rejects.toMatchObject({ name: "DashboardHttpError", status });
    expect(f.requests).toHaveLength(1);
  });
});
