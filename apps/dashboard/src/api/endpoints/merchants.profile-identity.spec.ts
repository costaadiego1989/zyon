import { expect, test } from "vitest";
import { merchantEndpoints } from "./merchants.js";
import { canManageServiceAttendance } from "../../lib/auth/permissions.js";

const baseProfile = { id: "merchant-a", name: "Empresa local", role: "owner", businessMode: "services", businessModeSelectionState: "selected" };
function fixture(body: unknown, status = 200) {
  const requests: Array<{ url: string; method: string | undefined; credentials: RequestCredentials | undefined }> = [];
  const api = merchantEndpoints("https://api.example.test/", (async (input, init) => {
    requests.push({ url: String(input), method: init?.method, credentials: init?.credentials });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
  return { api, requests };
}

test("normalizes the real bare OWNER wire identity before checking sensitive management access", async () => {
  const wire = { ...baseProfile, userId: "authenticated-user-a" }, f = fixture(wire);
  const profile = await f.api.merchantProfile();
  expect(profile).toEqual({ ...wire, user_id: "authenticated-user-a", role: "OWNER" });
  expect(canManageServiceAttendance(profile)).toBe(true);
  expect(f.requests).toEqual([{ url: "https://api.example.test/v1/merchants/me", method: "GET", credentials: "include" }]);
});

test("normalizes identity and role from the existing data envelope for an authorized ADMIN", async () => {
  const wire = { ...baseProfile, role: "admin", userId: "authenticated-admin-a" }, f = fixture({ data: wire });
  const profile = await f.api.merchantProfile();
  expect(profile).toEqual({ ...wire, user_id: "authenticated-admin-a", role: "ADMIN" });
  expect(canManageServiceAttendance(profile)).toBe(true);
});

test("retains an existing valid user_id response without replacing its authenticated identity", async () => {
  const wire = { ...baseProfile, user_id: "legacy-authenticated-user" }, f = fixture(wire);
  const profile = await f.api.merchantProfile();
  expect(profile).toEqual({ ...wire, role: "OWNER" });
  expect(canManageServiceAttendance(profile)).toBe(true);
});

test("accepts matching server identity aliases without manufacturing another identity", async () => {
  const wire = { ...baseProfile, userId: "same-user", user_id: "same-user" }, f = fixture(wire);
  const profile = await f.api.merchantProfile();
  expect(profile).toEqual({ ...wire, role: "OWNER" });
  expect(canManageServiceAttendance(profile)).toBe(true);
});

test("denies sensitive access when two server identity aliases disagree", async () => {
  const f = fixture({ ...baseProfile, userId: "canonical-user", user_id: "different-user" });
  const profile = await f.api.merchantProfile();
  expect(profile.user_id).toBe(""); expect(profile.role).toBe("OWNER");
  expect(canManageServiceAttendance(profile)).toBe(false);
});

test.each([{}, { userId: null }, { userId: 17 }, { userId: "" }])("keeps missing or malformed wire identity denied: %j", async identity => {
  const f = fixture({ ...baseProfile, ...identity }); const profile = await f.api.merchantProfile();
  expect(profile.user_id).toBe(""); expect(canManageServiceAttendance(profile)).toBe(false);
});

test("does not turn a valid server identity with an unknown role into a management grant", async () => {
  const f = fixture({ ...baseProfile, userId: "authenticated-user", role: "future-role" }); const profile = await f.api.merchantProfile();
  expect(profile.user_id).toBe("authenticated-user"); expect(profile.role).toBeUndefined();
  expect(canManageServiceAttendance(profile)).toBe(false);
});

test("preserves Staff as Staff and denies service administration even with a valid identity", async () => {
  const f = fixture({ ...baseProfile, userId: "authenticated-staff", role: "staff" }); const profile = await f.api.merchantProfile();
  expect(profile.user_id).toBe("authenticated-staff"); expect(profile.role).toBe("STAFF");
  expect(canManageServiceAttendance(profile)).toBe(false);
});

test("preserves a real profile HTTP403 as a denial instead of returning a synthetic identity", async () => {
  const f = fixture({ code: "staff_operation_not_permitted", detail: "staff_operation_not_permitted" }, 403);
  await expect(f.api.merchantProfile()).rejects.toMatchObject({ status: 403 });
  expect(f.requests).toEqual([{ url: "https://api.example.test/v1/merchants/me", method: "GET", credentials: "include" }]);
});
