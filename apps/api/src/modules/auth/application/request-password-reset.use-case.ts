import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import { Inject } from "@nestjs/common";
import { normalizeEmail } from "../domain/validators.js";

/**
 * Generates a time-limited password reset token, stores it, and sends
 * a reset email via Brevo SMTP. Fails silently to prevent email enumeration.
 */
@Injectable()
export class RequestPasswordResetUseCase {
  private readonly logger = new Logger(RequestPasswordResetUseCase.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
  ) {}

  async execute(email: string): Promise<{ sent: true }> {
    const normalized = normalizeEmail(email);
    const user = await this.repo.findUserByEmail(normalized);

    if (!user) {
      // Silent success to prevent email enumeration.
      this.logger.debug(`Password reset requested for unknown email: ${normalized}`);
      return { sent: true };
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60_000); // 30 minutes

    await this.repo.storePasswordResetToken(user.id, token, expiresAt);

    // Send email (fire-and-forget in v1; the token is stored regardless).
    await this.sendResetEmail(normalized, token).catch((err) => {
      this.logger.error(`Failed to send reset email to ${normalized}: ${(err as Error).message}`);
    });

    return { sent: true };
  }

  private async sendResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${process.env.DASHBOARD_URL || "http://localhost:5175"}/reset-password?token=${token}`;
    const apiKey = process.env.BREVO_API_KEY?.trim();
    const senderEmail = process.env.BREVO_SENDER_EMAIL || "no-reply@aacp.com";

    if (!apiKey) {
      this.logger.warn("BREVO_API_KEY not configured — password reset email skipped.");
      return;
    }

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { email: senderEmail, name: "Zyon" },
        to: [{ email }],
        subject: "Redefinir sua senha — Zyon",
        htmlContent: `<p>Clique no link abaixo para redefinir sua senha. Este link expira em 30 minutos.</p><p><a href="${resetUrl}">Redefinir senha</a></p><p>Se você não solicitou, ignore este email.</p>`,
      }),
    });
  }
}
