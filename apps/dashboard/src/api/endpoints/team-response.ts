export type TeamRole = "OWNER" | "ADMIN" | "STAFF";

export interface TeamMember {
  id: string;
  userId: string;
  email: string;
  role: TeamRole;
  joinedAt: string | null;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: TeamRole;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  createdAt: string | null;
  expiresAt: string | null;
}

type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_team_response");
  return value as Row;
}
function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("invalid_team_response");
  return value;
}
function role(value: unknown): TeamRole {
  if (value !== "OWNER" && value !== "ADMIN" && value !== "STAFF") throw new Error("invalid_team_role");
  return value;
}
function date(value: unknown): string | null {
  return typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Normalize the team HTTP contract, including legacy camel-case responses. */
export function normalizeTeamResponse(value: unknown): { members: TeamMember[]; invites: TeamInvite[] } {
  const response = row(value);
  if (!Array.isArray(response.members)) throw new Error("invalid_team_response");
  if (response.invites !== undefined && !Array.isArray(response.invites)) throw new Error("invalid_team_response");
  return {
    members: response.members.map(value => {
      const member = row(value);
      return {
        id: requiredText(member.member_id ?? member.id),
        userId: requiredText(member.user_id ?? member.userId),
        email: requiredText(member.email),
        role: role(member.role),
        joinedAt: date(member.joined_at ?? member.joinedAt),
      };
    }),
    invites: ((response.invites ?? []) as unknown[]).map(value => {
      const invite = row(value);
      if (!["PENDING", "ACCEPTED", "EXPIRED"].includes(String(invite.status))) throw new Error("invalid_team_invite_status");
      return {
        id: requiredText(invite.invite_id ?? invite.id),
        email: requiredText(invite.email),
        role: role(invite.role),
        status: invite.status as TeamInvite["status"],
        createdAt: date(invite.created_at ?? invite.createdAt),
        expiresAt: date(invite.expires_at ?? invite.expiresAt),
      };
    }),
  };
}
