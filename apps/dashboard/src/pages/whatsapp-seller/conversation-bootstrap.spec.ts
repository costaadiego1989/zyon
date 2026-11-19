import { describe, expect, it, vi } from "vitest";
import { DashboardHttpError } from "../../api-client.js";
import { resolveStaffConversationContext } from "./conversation-bootstrap.js";
import type { ConversationContext } from "./conversation-types.js";

const context: ConversationContext = { merchant_id: "real-merchant", user_id: "real-operator", role: "STAFF" };
describe("T62 denied private profile uses only verified minimal Staff context", () => {
  it("returns exactly the canonical three fields after a real private-profile403", async () => {
    const get = vi.fn(async () => context);
    const actual = await resolveStaffConversationContext(new DashboardHttpError(403, "{}"), { getWhatsAppConversationContext: get });
    expect(actual).toEqual(context); expect(Object.keys(actual!).sort()).toEqual(["merchant_id", "role", "user_id"]);
    expect(get).toHaveBeenCalledOnce(); expect(actual).not.toHaveProperty("businessMode"); expect(actual).not.toHaveProperty("plan");
  });
  it("does not query a Staff fallback for unauthenticated, unavailable or non-HTTP profile failures", async () => {
    const get = vi.fn(async () => context);
    for (const error of [new DashboardHttpError(401, "{}"), new DashboardHttpError(500, "{}"), Error("unavailable")]) {
      expect(await resolveStaffConversationContext(error, { getWhatsAppConversationContext: get })).toBeNull();
    }
    expect(get).not.toHaveBeenCalled();
  });
  it("does not turn an unexpected Owner/Admin response into the limited Staff identity", async () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const actual = await resolveStaffConversationContext(new DashboardHttpError(403, "{}"), { getWhatsAppConversationContext: async () => ({ ...context, role }) });
      expect(actual).toBeNull();
    }
  });
  it("never adopts a context with a missing tenant or operator identity", async () => {
    for (const invalid of [{ ...context, merchant_id: "" }, { ...context, user_id: " " }]) {
      expect(await resolveStaffConversationContext(new DashboardHttpError(403, "{}"), { getWhatsAppConversationContext: async () => invalid })).toBeNull();
    }
  });
  it("keeps the private console closed if the canonical context itself fails", async () => {
    for (const status of [401, 403, 503]) {
      expect(await resolveStaffConversationContext(new DashboardHttpError(403, "{}"), { getWhatsAppConversationContext: async () => { throw new DashboardHttpError(status, "{}"); } })).toBeNull();
    }
  });
});
