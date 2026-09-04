import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from "../domain/ports/auth-repository.port.js";
import {
  EMAIL_CHANGE_OTP_STORE,
  type EmailChangeOtpStore,
} from "../domain/ports/email-change-otp-store.port.js";
import {
  EmailAlreadyRegisteredError,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
} from "../domain/errors.js";
import { EmailChangeRateLimiter } from "../domain/services/email-change-rate-limiter.service.js";
import { Prisma } from "@prisma/client";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";

export interface ConfirmEmailChangeInput {
  merchantId: string;
  newEmail: string;
  code: string;
}

@Injectable()
export class ConfirmEmailChangeUseCase {
  private readonly logger = new Logger(ConfirmEmailChangeUseCase.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
    @Inject(EMAIL_CHANGE_OTP_STORE) private readonly otpStore: EmailChangeOtpStore,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    private readonly rateLimiter: EmailChangeRateLimiter,
  ) {}

  async execute(input: ConfirmEmailChangeInput): Promise<{ email: string }> {
    const profile = await this.repo.getOwnerProfile(input.merchantId);
    if (!profile) throw new NotFoundException("owner_profile_not_found");

    const record = await this.otpStore.findActive(profile.userId);
    if (!record) throw new OtpExpiredError();

    if (record.attempts >= record.maxAttempts) throw new OtpLockedError();

    const providedHash = createHash("sha256").update(input.code.trim()).digest("hex");
    if (providedHash !== record.codeHash) {
      await this.otpStore.incrementAttempts(profile.userId);
      const updated = await this.otpStore.findActive(profile.userId);
      if (updated && updated.attempts >= updated.maxAttempts) throw new OtpLockedError();
      throw new OtpInvalidError();
    }

    // Confirm the newEmail matches what was requested.
    if (input.newEmail.trim().toLowerCase() !== record.newEmail) {
      throw new BadRequestException("email_mismatch");
    }

    const oldEmail = profile.email;

    try {
      await this.repo.updateUserEmail(profile.userId, record.newEmail);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new EmailAlreadyRegisteredError(record.newEmail);
      }
      if (err instanceof Error && (err as any).code === "P2002") {
        throw new EmailAlreadyRegisteredError(record.newEmail);
      }
      throw err;
    }

    await this.otpStore.consume(profile.userId);
    this.rateLimiter.clear(profile.userId);

    // Notify old email (defense against account takeover).
    void this.notifyOldEmail(oldEmail, record.newEmail).catch((err) => {
      this.logger.error(`Failed to notify old email ${oldEmail}: ${(err as Error).message}`);
    });

    return { email: record.newEmail };
  }

  private async notifyOldEmail(oldEmail: string, newEmail: string): Promise<void> {
    const fromEmail =
      process.env.RESEND_NOREPLY_EMAIL || process.env.RESEND_FROM_EMAIL || "noreply@zyon.com.br";
    const supportUrl = `${process.env.DASHBOARD_URL || "http://localhost:5175"}/support`;
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,sans-serif;background:#f8fafc;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 12px;">Email da sua conta foi alterado</h1>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 12px;">
        O email da sua conta Zyon foi alterado de <strong>${oldEmail}</strong> para <strong>${newEmail}</strong>.
      </p>
      <p style="font-size:13px;color:#64748b;line-height:1.5;margin:0 0 16px;">
        Se você não fez esta alteração, entre em contato conosco imediatamente.
      </p>
      <a href="${supportUrl}" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Não fui eu — abrir suporte</a>
    </div>
  </div>
</body>
</html>`;

    await this.emailSender.send({
      to: oldEmail,
      from: fromEmail,
      subject: "Seu email foi alterado — Zyon",
      html,
    });
  }
}
