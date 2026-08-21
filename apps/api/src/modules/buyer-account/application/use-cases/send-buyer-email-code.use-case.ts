import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";

export interface SendBuyerEmailCodeRequest {
  email: string;
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class SendBuyerEmailCodeUseCase {
  private readonly logger = new Logger(SendBuyerEmailCodeUseCase.name);

  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
  ) {}

  async execute(input: SendBuyerEmailCodeRequest): Promise<{ sent: boolean; delivered_to: string }> {
    const email = input.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new BadRequestException("email_invalid");
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Store OTP with email as key
    await this.otpStore.save({ phone: `email:${email}`, codeHash, maxAttempts: 5, expiresAt });

    // LOG OTP for dev (always visible in terminal)
    this.logger.warn(`[OTP-EMAIL] code=${code} email=${email} expires=${expiresAt.toISOString()}`);

    // Send via Resend
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_NOREPLY_EMAIL || process.env.RESEND_FROM_EMAIL || "noreply@zyon.com.br";

    if (apiKey) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromEmail,
            to: email,
            subject: "Seu código de verificação",
            html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px;">
              <h2 style="font-size:20px;margin:0 0 12px;">Código de verificação</h2>
              <p style="color:#64748b;font-size:14px;">Use o código abaixo para confirmar seu email:</p>
              <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f1f5f9;border-radius:12px;margin:16px 0;">${code}</div>
              <p style="color:#94a3b8;font-size:12px;">Válido por 10 minutos. Se não solicitou, ignore este email.</p>
            </div>`,
          }),
        });
        this.logger.log(`Email OTP sent to ${email}`);
      } catch (err) {
        this.logger.error(`Failed to send email OTP`, { error: err });
      }
    } else {
      this.logger.warn(`[OTP] RESEND_API_KEY not configured; code for ${email}: ${code}`);
    }

    const masked = email.replace(/(.{2}).*(@.*)/, "$1***$2");
    return { sent: true, delivered_to: masked };
  }
}
