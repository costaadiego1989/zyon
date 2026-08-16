import { Injectable, Inject, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";
import { normalizeEmail } from "../domain/validators.js";

/**
 * Generates a time-limited password reset token, stores it, and sends
 * a reset email via the EmailSenderPort (Resend). Fails silently to prevent email enumeration.
 */
@Injectable()
export class RequestPasswordResetUseCase {
  private readonly logger = new Logger(RequestPasswordResetUseCase.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
  ) {}

  async execute(email: string): Promise<{ sent: true }> {
    const normalized = normalizeEmail(email);
    const user = await this.repo.findUserByEmail(normalized);

    if (!user) {
      this.logger.debug(`Password reset requested for unknown email: ${normalized}`);
      return { sent: true };
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60_000); // 30 minutes

    await this.repo.storePasswordResetToken(user.id, token, expiresAt);

    // Send email (fire-and-forget; token is stored regardless)
    await this.sendResetEmail(normalized, token).catch((err) => {
      this.logger.error(`Failed to send reset email to ${normalized}: ${(err as Error).message}`);
    });

    return { sent: true };
  }

  private async sendResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${process.env.DASHBOARD_URL || "http://localhost:5175"}/reset-password?token=${token}`;
    const fromEmail = process.env.RESEND_NOREPLY_EMAIL || process.env.RESEND_FROM_EMAIL || "noreply@zyon-payments.com.br";
    const year = new Date().getFullYear();

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redefinir Senha</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb; -webkit-font-smoothing: antialiased;">
  <table cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb;">
    <tr>
      <td style="padding: 48px 20px;">
        <table cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1, #4f46e5); padding: 40px 32px; text-align: center;">
              <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 56px; font-size: 28px;">🔒</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">Redefinir Senha</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Solicitação de recuperação de acesso</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #1f2937; font-size: 15px; line-height: 1.6;">
                Recebemos uma solicitação para redefinir a senha da sua conta.
              </p>
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 14px; line-height: 1.6;">
                Clique no botão abaixo para criar uma nova senha. Este link é válido por <strong>30 minutos</strong>.
              </p>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 32px 0;">
                <a href="${resetUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 14px 40px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; letter-spacing: 0.2px;">Redefinir Minha Senha</a>
              </div>

              <!-- Security notice -->
              <table cellpadding="0" cellspacing="0" style="width: 100%; background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; margin-top: 24px;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0; color: #92400e; font-size: 13px; line-height: 1.5;">
                      ⚠️ Se você não solicitou esta redefinição, ignore este email. Sua senha permanecerá a mesma.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin: 24px 0 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">
                Se o botão não funcionar, copie e cole este link no navegador:<br>
                <a href="${resetUrl}" style="color: #6366f1; word-break: break-all;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background: #f9fafb; border-top: 1px solid #f3f4f6; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">Este é um e-mail automático. Não responda.</p>
              <p style="margin: 6px 0 0; color: #9ca3af; font-size: 12px;">© ${year} Zyon • Todos os direitos reservados</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    await this.emailSender.send({
      to: email,
      from: fromEmail,
      subject: "Redefinir sua senha — Zyon",
      html,
    });
  }
}
