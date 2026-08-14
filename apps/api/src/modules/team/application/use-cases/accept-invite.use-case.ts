/**
 * Accept invite use-case.
 *
 * Validates invite token and creates MerchantTeamMember.
 */

import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

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
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: AcceptInviteInput): Promise<AcceptInviteOutput> {
    const invite = await this.prisma.merchantInvite.findUnique({
      where: { id: input.invite_id },
    });

    if (!invite) throw new NotFoundException("invite_not_found");
    if (invite.status !== "PENDING") throw new BadRequestException("invite_not_pending");
    if (new Date() > invite.expiresAt) throw new BadRequestException("invite_expired");

    // Verify user exists
    const user = await this.prisma.merchantUser.findUnique({
      where: { id: input.user_id },
    });
    if (!user) throw new NotFoundException("user_not_found");
    if (user.email !== invite.email) throw new BadRequestException("email_mismatch");

    // Create team member
    const member = await this.prisma.merchantTeamMember.create({
      data: {
        merchantId: invite.merchantId,
        userId: input.user_id,
        role: invite.role,
        invitedBy: invite.invitedBy,
      },
    });

    // Mark invite as accepted
    await this.prisma.merchantInvite.update({
      where: { id: input.invite_id },
      data: { status: "ACCEPTED" },
    });

    return {
      member_id: member.id,
      merchant_id: member.merchantId,
      role: member.role,
    };
  }
}
