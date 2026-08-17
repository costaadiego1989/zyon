/**
 * Invite team member use-case.
 *
 * Creates a MerchantInvite and sends notification (email placeholder).
 */

import { Injectable, Inject, BadRequestException, NotFoundException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface InviteMemberInput {
  merchant_id: string;
  email: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  invited_by: string;
}

export interface InviteMemberOutput {
  invite_id: string;
  email: string;
  role: string;
  expires_at: Date;
}

@Injectable()
export class InviteMemberUseCase {
  private readonly logger = new Logger(InviteMemberUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: InviteMemberInput): Promise<InviteMemberOutput> {
    // Verify merchant exists
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: input.merchant_id },
    });
    if (!merchant) throw new NotFoundException("merchant_not_found");

    // Check if user already exists
    const existing = await this.prisma.merchantUser.findUnique({
      where: { email: input.email },
    });
    if (existing && existing.merchantId === input.merchant_id) {
      throw new BadRequestException("user_already_member");
    }

    // Create invite (expires in 7 days)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invite = await this.prisma.merchantInvite.create({
      data: {
        merchantId: input.merchant_id,
        email: input.email,
        role: input.role,
        invitedBy: input.invited_by,
        expiresAt,
        status: "PENDING",
      },
    });

    // TODO: send email with invite link containing invite_id

    return {
      invite_id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expiresAt,
    };
  }
}
