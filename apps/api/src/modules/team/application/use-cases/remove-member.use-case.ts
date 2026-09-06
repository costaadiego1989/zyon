import { lockTeam, requireTeamManager, revokeUserSessions } from "./team-membership.js";
import { ForbiddenException } from "@nestjs/common";
/**
 * Remove team member use-case.
 */

import { Injectable, Inject, NotFoundException, BadRequestException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface RemoveMemberInput {
  merchant_id: string;
  user_id: string;
  requester_id: string;
}

@Injectable()
export class RemoveMemberUseCase {
  private readonly logger = new Logger(RemoveMemberUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: RemoveMemberInput): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockTeam(tx, input.merchant_id);
      const requesterRole = await requireTeamManager(tx, input.merchant_id, input.requester_id);
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${input.user_id} FOR UPDATE`;
      const member = await tx.merchantTeamMember.findUnique({ where: { merchantId_userId: { merchantId: input.merchant_id, userId: input.user_id } }, include: { user: true } });
      if (!member || member.user.merchantId !== input.merchant_id || member.user.disabledAt) throw new NotFoundException("team_member_not_found");
      if (member.user.role === "owner") {
        if (requesterRole !== "OWNER") throw new ForbiddenException("admin_cannot_remove_owner");
        const owners = await tx.merchantUser.count({ where: { merchantId: input.merchant_id, role: "owner", disabledAt: null } });
        if (owners <= 1) throw new BadRequestException("cannot_remove_last_owner");
      }
      await tx.merchantTeamMember.delete({ where: { id: member.id } });
      await tx.merchantUser.update({ where: { id: input.user_id }, data: { disabledAt: new Date(), authVersion: { increment: 1 } } });
      await revokeUserSessions(tx, input.user_id);
    });
  }
}
