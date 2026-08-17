/**
 * Invite team member use-case.
 *
 * Creates a MerchantInvite, generates a provisional password,
 * creates the MerchantUser + MerchantTeamMember, and sends welcome email via Resend.
 */

import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";

export const EMAIL_SENDER_PORT = Symbol("EmailSenderPort");

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

function generatePassword(): string {
  return randomBytes(4).toString("hex") + "A1!";
}

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

@Injectable()
export class InviteMemberUseCase {
  private readonly logger = new Logger(InviteMemberUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
  ) {}

  async execute(input: InviteMemberInput): Promise<InviteMemberOutput> {
    // Verify merchant exists
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: input.merchant_id },
    });
    if (!merchant) throw new NotFoundException("merchant_not_found");

    // Check if user already exists as member
    const existing = await this.prisma.merchantUser.findUnique({
      where: { email: input.email },
    });
    if (existing && existing.merchantId === input.merchant_id) {
      throw new BadRequestException("user_already_member");
    }

    // Generate provisional password
    const provisionalPassword = generatePassword();
    const passwordHash = hashPassword(provisionalPassword);

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

    // Create user + team member immediately (password is provisional)
    let user = existing;
    if (!user) {
      user = await this.prisma.merchantUser.create({
        data: {
          merchantId: input.merchant_id,
          email: input.email,
          passwordHash,
          role: input.role,
        },
      });
    }

    // Create team membership
    await this.prisma.merchantTeamMember.upsert({
      where: { merchantId_userId: { merchantId: input.merchant_id, userId: user.id } },
      create: {
        merchantId: input.merchant_id,
        userId: user.id,
        role: input.role,
        invitedBy: input.invited_by,
      },
      update: { role: input.role },
    });

    // Mark invite as accepted (user is auto-created)
    await this.prisma.merchantInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED" },
    });

    // Send welcome email with provisional password
    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:5173";
    void this.sendWelcomeEmail(input.email, merchant.name, provisionalPassword, input.role, dashboardUrl);

    return {
      invite_id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expiresAt,
    };
  }

  private async sendWelcomeEmail(email: string, merchantName: string, password: string, role: string, dashboardUrl: string) {
    const roleLabel = role === "ADMIN" ? "Administrador" : "Agente";
    try {
      await this.emailSender.send({
        to: email,
        subject: `Você foi convidado para ${merchantName} — Zyon`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #0f766e;">Bem-vindo à equipe!</h2>
            <p>Você foi convidado como <strong>${roleLabel}</strong> na loja <strong>${merchantName}</strong>.</p>
            <p>Use as credenciais abaixo para acessar o painel:</p>
            <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
              <p style="margin: 4px 0;"><strong>Senha provisória:</strong> <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px;">${password}</code></p>
            </div>
            <p style="color: #6b7280; font-size: 13px;">Recomendamos alterar sua senha no primeiro acesso.</p>
            <a href="${dashboardUrl}" style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #0f766e; color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600;">Acessar Painel →</a>
          </div>
        `,
      });
      this.logger.log(`Welcome email sent to ${email}`);
    } catch (err) {
      this.logger.error(`Failed to send welcome email to ${email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
