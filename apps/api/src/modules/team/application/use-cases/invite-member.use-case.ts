import { lockTeam, requireRole, requireTeamManager, revokeUserSessions } from "./team-membership.js";
import { assertValidEmail, normalizeEmail } from "../../../auth/domain/validators.js";
import { ForbiddenException } from "@nestjs/common";
/**
 * Invite team member use-case.
 *
 * Creates a MerchantInvite, generates a provisional password,
 * creates the MerchantUser + MerchantTeamMember, and sends welcome email via Resend.
 */

import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";

export { EMAIL_SENDER_PORT };

export interface InviteMemberInput {
  merchant_id: string;
  name?: string;
  email: string;
  phone?: string;
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
  return randomBytes(16).toString("hex") + "A1!";
}

@Injectable()
export class InviteMemberUseCase {
  private readonly logger = new Logger(InviteMemberUseCase.name);
  private readonly passwordHasher = new PasswordHasher();

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
  ) {}

  async execute(input: InviteMemberInput): Promise<InviteMemberOutput> {
    const role = requireRole(input.role);
    assertValidEmail(input.email);
    const email = normalizeEmail(input.email);
    const provisionalPassword = generatePassword();
    const passwordHash = await this.passwordHasher.hash(provisionalPassword);
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const { merchant, invite } = await this.prisma.$transaction(async tx => {
      await lockTeam(tx, input.merchant_id);
      const actor = await requireTeamManager(tx, input.merchant_id, input.invited_by);
      if (role === "OWNER" && actor !== "OWNER") throw new ForbiddenException("only_owner_can_promote_to_owner");
      const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: input.merchant_id } });
      const existing = await tx.merchantUser.findUnique({ where: { email } });
      if (existing && existing.merchantId !== input.merchant_id) throw new BadRequestException("email_belongs_to_another_merchant");
      if (existing && !existing.disabledAt) throw new BadRequestException("user_already_member");
      if (existing) await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${existing.id} FOR UPDATE`;
      const user = existing ? await tx.merchantUser.update({ where: { id: existing.id }, data: { disabledAt: null, passwordHash, role: role.toLowerCase(), authVersion: { increment: 1 } } }) :
        await tx.merchantUser.create({ data: { merchantId: input.merchant_id, email, passwordHash, role: role.toLowerCase() } });
      await revokeUserSessions(tx, user.id);
      await tx.merchantTeamMember.upsert({ where: { merchantId_userId: { merchantId: input.merchant_id, userId: user.id } },
        create: { merchantId: input.merchant_id, userId: user.id, role, invitedBy: input.invited_by }, update: { role, invitedBy: input.invited_by } });
      const invite = await tx.merchantInvite.create({ data: { merchantId: input.merchant_id, email, role, invitedBy: input.invited_by, expiresAt, status: "ACCEPTED" } });
      return { merchant, invite };
    });

    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:5175";
    await this.sendWelcomeEmail(email, input.name || input.email, merchant.name, provisionalPassword, input.role, dashboardUrl);

    return {
      invite_id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expiresAt,
    };
  }

  private async sendWelcomeEmail(email: string, name: string, merchantName: string, password: string, role: string, dashboardUrl: string) {
    const roleLabel = role === "ADMIN" ? "Administrador" : "Agente de Suporte";
    try {
      await this.emailSender.send({
        to: email,
        subject: `${name}, você foi convidado para ${merchantName}`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
    <div style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
      <!-- Header -->
      <div style="background:#0f766e;padding:32px 32px 24px;text-align:center;">
        <h1 style="color:#ffffff;font-size:20px;font-weight:600;margin:0;">Bem-vindo à equipe!</h1>
      </div>
      <!-- Body -->
      <div style="padding:32px;">
        <p style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 16px;">
          Olá <strong>${name}</strong>,
        </p>
        <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 20px;">
          Você foi convidado como <strong>${roleLabel}</strong> na loja <strong>${merchantName}</strong>.
          Abaixo estão suas credenciais de acesso ao painel de gerenciamento.
        </p>
        <!-- Credentials box -->
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#64748b;width:100px;">Email</td>
              <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:500;">${email}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#64748b;">Senha</td>
              <td style="padding:6px 0;">
                <code style="background:#e2e8f0;padding:3px 8px;border-radius:4px;font-size:13px;color:#0f172a;font-weight:600;">${password}</code>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#64748b;">Função</td>
              <td style="padding:6px 0;font-size:13px;color:#0f172a;">${roleLabel}</td>
            </tr>
          </table>
        </div>
        <!-- CTA -->
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${dashboardUrl}" style="display:inline-block;padding:12px 28px;background:#0f766e;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Acessar Painel →</a>
        </div>
        <p style="font-size:12px;color:#94a3b8;line-height:1.5;margin:0;text-align:center;">
          Recomendamos alterar sua senha no primeiro acesso.<br/>
          Este convite expira em 7 dias.
        </p>
      </div>
      <!-- Footer -->
      <div style="border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
        <p style="font-size:11px;color:#94a3b8;margin:0;">Enviado por Zyon · Plataforma de e-commerce conversacional</p>
      </div>
    </div>
  </div>
</body>
</html>
        `,
      });
      this.logger.log(`Welcome email sent to ${email}`);
    } catch (err) {
      this.logger.error(`Failed to send welcome email to ${email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
