/**
 * List team members use-case.
 */

import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface TeamMemberInfo {
  member_id: string;
  user_id: string;
  email: string;
  role: string;
  joined_at: Date;
}

export interface ListTeamOutput {
  members: TeamMemberInfo[];
  total: number;
}

@Injectable()
export class ListTeamUseCase {
  private readonly logger = new Logger(ListTeamUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchant_id: string): Promise<ListTeamOutput> {
    // Verify merchant exists
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchant_id },
    });
    if (!merchant) throw new NotFoundException("merchant_not_found");

    const members = await this.prisma.merchantTeamMember.findMany({
      where: { merchantId: merchant_id },
      include: { user: { select: { email: true } } },
      orderBy: { joinedAt: "desc" },
    });

    return {
      members: members.map((m) => ({
        member_id: m.id,
        user_id: m.userId,
        email: m.user.email,
        role: m.role,
        joined_at: m.joinedAt,
      })),
      total: members.length,
    };
  }
}
