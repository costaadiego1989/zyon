import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export type TeamRole = "OWNER" | "ADMIN" | "STAFF";
export function requireRole(role: string): TeamRole {
  if (role !== "OWNER" && role !== "ADMIN" && role !== "STAFF") throw new BadRequestException("invalid_team_role");
  return role;
}

// Serialize all team writers per merchant, including last-owner checks. Credentials
// and session invalidation then lock the affected user in the same transaction.
export async function lockTeam(tx: Prisma.TransactionClient, merchantId: string) {
  if (!merchantId?.trim()) throw new BadRequestException("merchant_required");
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException("merchant_not_found");
}

export async function requireTeamManager(tx: Prisma.TransactionClient, merchantId: string, userId: string) {
  if (!userId?.trim()) throw new ForbiddenException("team_manager_required");
  const actor = await tx.merchantUser.findFirst({ where: { id: userId, merchantId, disabledAt: null } });
  const role = actor?.role.toUpperCase();
  if (role !== "OWNER" && role !== "ADMIN") throw new ForbiddenException("team_manager_required");
  return role;
}

export async function revokeUserSessions(tx: Prisma.TransactionClient, userId: string) {
  const now = new Date();
  await tx.merchantAuthSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await tx.merchantPasswordResetToken.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
}
