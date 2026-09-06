import { lockTeam, requireRole, requireTeamManager, revokeUserSessions } from "./team-membership.js";
/**
 * Accept invite use-case.
 *
 * Validates invite token and creates MerchantTeamMember.
 */

import { Injectable, Inject, BadRequestException, NotFoundException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface AcceptInviteInput {
  invite_id: string;
  user_id: string;
}

export interface AcceptInviteOutput {
  member_id: string;
  merchant_id: string;
  role: string;
}

@Injectable()
export class AcceptInviteUseCase {
  private readonly logger = new Logger(AcceptInviteUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: AcceptInviteInput): Promise<AcceptInviteOutput> {
    return this.prisma.$transaction(async tx => {
      const candidate = await tx.merchantInvite.findUnique({ where: { id: input.invite_id } });
      if (!candidate) throw new NotFoundException("invite_not_found");
      await lockTeam(tx, candidate.merchantId);
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${input.user_id} FOR UPDATE`;
      const user = await tx.merchantUser.findUnique({ where: { id: input.user_id } });
      if (!user || user.disabledAt || user.merchantId !== candidate.merchantId || user.email !== candidate.email) throw new BadRequestException("invite_identity_mismatch");
      const claimed = await tx.merchantInvite.updateMany({ where: { id: input.invite_id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: "ACCEPTED" } });
      if (claimed.count !== 1) throw new BadRequestException("invite_not_pending_or_expired");
      const role = requireRole(candidate.role);
      const inviterRole = await requireTeamManager(tx, candidate.merchantId, candidate.invitedBy);
      if (role === "OWNER" && inviterRole !== "OWNER") throw new BadRequestException("only_owner_can_promote_to_owner");
      if (user.role === "owner") throw new BadRequestException("owner_role_requires_explicit_change");
      // Existing active memberships use the role command so last-owner checks cannot be bypassed.
      const existing = await tx.merchantTeamMember.findUnique({ where: { merchantId_userId: { merchantId: candidate.merchantId, userId: user.id } } });
      if (existing) throw new BadRequestException("user_already_member");
      const member = await tx.merchantTeamMember.create({ data: { merchantId: candidate.merchantId, userId: user.id, role, invitedBy: candidate.invitedBy } });
      await tx.merchantUser.update({ where: { id: user.id }, data: { role: role.toLowerCase(), authVersion: { increment: 1 } } });
      await revokeUserSessions(tx, user.id);
      return { member_id: member.id, merchant_id: member.merchantId, role: member.role };
    });
  }
}
