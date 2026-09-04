import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from "../domain/ports/auth-repository.port.js";
import {
  EMAIL_CHANGE_OTP_STORE,
  type EmailChangeOtpStore,
} from "../domain/ports/email-change-otp-store.port.js";
import { EmailChangeRateLimiter } from "../domain/services/email-change-rate-limiter.service.js";
import { assertValidEmail, normalizeEmail } from "../domain/validators.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";

export interface RequestEmailChangeInput {
  merchantId: string;
  newEmail: string;
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

@Injectable()
export class RequestEmailChangeUseCase {
  private readonly logger = new Logger(RequestEmailChangeUseCase.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repo: AuthRepository,
    @Inject(EMAIL_CHANGE_OTP_STORE) private readonly otpStore: EmailChangeOtpStore,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    private readonly rateLimiter: EmailChangeRateLimiter,
  ) {}

  async execute(input: RequestEmailChangeInput): Promise<{ sent: true; delivered_to: string }> {
    const newEmail = normalizeEmail(input.newEmail ?? "");
    assertValidEmail(newEmail);

    const profile = await this.repo.getOwnerProfile(input.merchantId);
    if (!profile) throw new NotFoundException("owner_profile_not_found");

    if (normalizeEmail(profile.email) === newEmail) {
      throw new BadRequestException("email_unchanged");
    }

    const existing = await this.repo.findUserByEmail(newEmail);
    if (existing) {
      throw new BadRequestException("email_taken");
    }

    this.rateLimiter.assertAllowed(profile.userId);

    const code = String(randomInt(100000, 1000000));
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.otpStore.save({
      userId: profile.userId,
      newEmail,
      codeHash,
      maxAttempts: MAX_ATTEMPTS,
      expiresAt,
    });

    this.rateLimiter.record(profile.userId);

    this.logger.warn(`[EMAIL-CHANGE-OTP] code=${code} user=${profile.userId} → ${newEmail} expires=${expiresAt.toISOString()}`);

    const fromEmail =
      process.env.RESEND_NOREPLY_EMAIL || process.env.RESEND_FROM_EMAIL || "noreply@zyon.com.br";

    await this.emailSender
      .send({
        to: newEmail,
        from: fromEmail,
        subject: "Confirme seu novo email — Zyon",
        html: this.buildEmail(code),
      })
      .catch((err) => {
        this.logger.error(`Failed to send email change OTP to ${newEmail}: ${(err as Error).message}`);
      });

    const masked = newEmail.replace(/(.{2}).*(@.*)/, "$1***$2");
    return { sent: true, delivered_to: masked };
  }

  private buildEmail(code: string): string {
    const year = new Date().getFullYear();
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
      <div style="background:#0f766e;padding:28px 32px;text-align:center;">
        <h1 style="color:#ffffff;font-size:18px;font-weight:600;margin:0;">Confirme seu novo email</h1>
      </div>
      <div style="padding:32px;">
        <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 16px;">
          Use o código abaixo para confirmar a alteração do email da sua conta:
        </p>
        <div style="font-family:monospace;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f1f5f9;border-radius:12px;margin:0 0 20px;color:#0f172a;">${code}</div>
        <p style="font-size:13px;color:#64748b;line-height:1.5;margin:0;">
          Válido por <strong>10 minutos</strong>. Você tem até 5 tentativas.
        </p>
        <p style="font-size:12px;color:#94a3b8;line-height:1.5;margin:16px 0 0;">
          Se você não solicitou esta alteração, ignore este email — sua conta permanece segura.
        </p>
      </div>
      <div style="border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
        <p style="font-size:11px;color:#94a3b8;margin:0;">© ${year} Zyon · Todos os direitos reservados</p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }
}
