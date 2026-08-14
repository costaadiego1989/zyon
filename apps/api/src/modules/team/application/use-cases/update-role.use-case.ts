/**
 * Update team member role use-case.
 */

import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface UpdateRoleInput {
  merchant_id: string;
  user_id: string;
  new_role: "OWNER" | "ADMIN" | "STAFF";
}

export interface UpdateRoleOutput {
  member_id: string;
  role: string;
}

@Injectable()
export class UpdateRoleUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: UpdateRoleInput): Promise<UpdateRoleOutput> {
    // Find the team member
    const member = await this.prisma.merchantTeamMember.findUnique({
      where: { merchantId_userId: { merchantId: input.merchant_id, userId: input.user_id } },
    });

    if (!member) throw new NotFoundException("team_member_not_found");

    // Prevent downgrading the last owner
    if (member.role === "OWNER" && input.new_role !== "OWNER") {
      const ownerCount = await this.prisma.merchantTeamMember.count({
        where: { merchantId: input.merchant_id, role: "OWNER" },
      });
      if (ownerCount === 1) {
        throw new BadRequestException("cannot_remove_last_owner");
      }
    }

    // Update role
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
