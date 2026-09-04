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
    if (input.new_role === "OWNER" && input.requester_role !== "OWNER") {
      throw new RoleEscalationError();
    }

    const member = await this.prisma.merchantTeamMember.findUnique({
      where: { merchantId_userId: { merchantId: input.merchant_id, userId: input.user_id } },
    });

    if (!member) throw new NotFoundException("team_member_not_found");

    if (input.requester_role !== "OWNER" && member.role === "OWNER") {
      throw new CannotModifyOwnerError();
    }

    if (member.role === "OWNER" && input.new_role !== "OWNER") {
      const ownerCount = await this.prisma.merchantTeamMember.count({
        where: { merchantId: input.merchant_id, role: "OWNER" },
      });
      if (ownerCount === 1) {
        throw new LastOwnerError();
      }
    }

    const updated = await this.prisma.merchantTeamMember.update({
      where: { id: member.id },
      data: { role: input.new_role },
    });

    return {
      member_id: updated.id,
      role: updated.role,
    };
  }
}
