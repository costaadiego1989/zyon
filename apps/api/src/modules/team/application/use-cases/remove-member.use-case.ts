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
}

@Injectable()
export class RemoveMemberUseCase {
  private readonly logger = new Logger(RemoveMemberUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: RemoveMemberInput): Promise<void> {
    const member = await this.prisma.merchantTeamMember.findUnique({
      where: { merchantId_userId: { merchantId: input.merchant_id, userId: input.user_id } },
    });

    if (!member) throw new NotFoundException("team_member_not_found");

    // Prevent removing the last owner
    if (member.role === "OWNER") {
      const ownerCount = await this.prisma.merchantTeamMember.count({
        where: { merchantId: input.merchant_id, role: "OWNER" },
      });
      if (ownerCount === 1) {
        throw new BadRequestException("cannot_remove_last_owner");
      }
    }

    await this.prisma.merchantTeamMember.delete({
      where: { id: member.id },
    });
  }
}
