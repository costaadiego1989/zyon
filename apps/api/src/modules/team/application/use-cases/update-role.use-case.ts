import { lockTeam, requireRole, requireTeamManager, revokeUserSessions } from "./team-membership.js";
import { Injectable, Inject, NotFoundException, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export class RoleEscalationError extends Error {
  readonly code = "only_owner_can_promote_to_owner";
  constructor() { super("Only an owner can assign the OWNER role"); }
}

export class CannotModifyOwnerError extends Error {
  readonly code = "admin_cannot_modify_owner";
  constructor() { super("Admin cannot modify an owner's role"); }
}

export class LastOwnerError extends Error {
  readonly code = "cannot_remove_last_owner";
  constructor() { super("Cannot demote the last owner"); }
}

export interface UpdateRoleInput {
  merchant_id: string;
  user_id: string;
  new_role: "OWNER" | "ADMIN" | "STAFF";
  requester_id: string;
  requester_role: "OWNER" | "ADMIN" | "STAFF";
}

export interface UpdateRoleOutput {
  member_id: string;
  role: string;
}

@Injectable()
export class UpdateRoleUseCase {
  private readonly logger = new Logger(UpdateRoleUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: UpdateRoleInput): Promise<UpdateRoleOutput> {
    const role = requireRole(input.new_role);
    return this.prisma.$transaction(async tx => {
      await lockTeam(tx, input.merchant_id);
      const requesterRole = await requireTeamManager(tx, input.merchant_id, input.requester_id);
      if (role === "OWNER" && requesterRole !== "OWNER") throw new RoleEscalationError();
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${input.user_id} FOR UPDATE`;
      const member = await tx.merchantTeamMember.findUnique({ where: { merchantId_userId: { merchantId: input.merchant_id, userId: input.user_id } }, include: { user: true } });
      if (!member || member.user.merchantId !== input.merchant_id || member.user.disabledAt) throw new NotFoundException("team_member_not_found");
      if (requesterRole !== "OWNER" && member.user.role === "owner") throw new CannotModifyOwnerError();
      if (member.user.role === "owner" && role !== "OWNER") {
        const owners = await tx.merchantUser.count({ where: { merchantId: input.merchant_id, role: "owner", disabledAt: null } });
        if (owners <= 1) throw new LastOwnerError();
      }
      const updated = await tx.merchantTeamMember.update({ where: { id: member.id }, data: { role } });
      await tx.merchantUser.update({ where: { id: input.user_id }, data: { role: role.toLowerCase(), authVersion: { increment: 1 } } });
      await revokeUserSessions(tx, input.user_id);
      return { member_id: updated.id, role: updated.role };
    });
  }
}
