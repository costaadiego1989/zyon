import { describe, expect, it } from "vitest";
import { merchantEndpoints } from "./merchants.js";
import { normalizeTeamResponse } from "./team-response.js";
import { formatTeamDate } from "../../pages/useTeamPage.js";

const member = { member_id: "membership-1", user_id: "user-42", email: "pessoa@example.test", role: "STAFF", joined_at: "2026-09-20T12:00:00.000Z" };

describe("Team HTTP contract", () => {
  it("maps the actual ListTeamUseCase fields and uses user_id for role and removal requests", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const api = merchantEndpoints("https://api.example.test", (async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify(init?.method === "GET" ? { members: [member], total: 1 } : { ok: true }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch);
    const team = await api.listTeam("merchant-1");
    expect(team).toEqual({ members: [{ id: "membership-1", userId: "user-42", email: member.email, role: "STAFF", joinedAt: member.joined_at }], invites: [] });
    expect(formatTeamDate(team.members[0].joinedAt)).toBe("20/09/2026");
    await api.updateTeamMemberRole("merchant-1", team.members[0].userId, "ADMIN");
    await api.removeTeamMember("merchant-1", team.members[0].userId);
    expect(requests[1]).toMatchObject({ url: "https://api.example.test/v1/merchants/merchant-1/team/user-42/role", method: "PUT", body: { role: "ADMIN" } });
    expect(requests[2]).toMatchObject({ url: "https://api.example.test/v1/merchants/merchant-1/team/user-42", method: "DELETE" });
  });

  it("does not fabricate dates for missing or invalid timestamps", () => {
    for (const joined_at of [undefined, null, "", "not-a-date"]) {
      const data = normalizeTeamResponse({ members: [{ ...member, joined_at }] });
      expect(data.members[0].joinedAt).toBeNull();
      expect(formatTeamDate(data.members[0].joinedAt)).toBe("Não informada");
    }
    expect(formatTeamDate("invalid")).toBe("Não informada");
  });

  it("keeps legacy member responses and invitation expiry dates compatible", () => {
    const data = normalizeTeamResponse({ members: [{ id: "membership-1", userId: "user-42", email: member.email, role: "STAFF", joinedAt: member.joined_at }], invites: [{ id: "invite-1", email: "convite@example.test", role: "ADMIN", status: "PENDING", createdAt: member.joined_at, expiresAt: "invalid" }] });
    expect(data.members[0].userId).toBe("user-42");
    expect(data.invites[0].expiresAt).toBeNull();
  });

  it("rejects member rows without an actionable identity", () => {
    expect(() => normalizeTeamResponse({ members: [{ ...member, user_id: undefined }] })).toThrow("invalid_team_response");
  });
});
