import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { SMS_PROVIDER, type SmsSender } from "../../domain/ports/sms.port.js";

export interface SendBuyerPhoneCodeRequest {
  phone: string;
  countryCode?: string;
  merchantName?: string;
  buyerName?: string;
  fallbackEmail?: string;
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a clear, branded OTP SMS in pt-BR.
 * Format: "Olá {nome}! Seu código de acesso à {loja} é 123456. Válido por 5 min. Não compartilhe."
 */
function buildOtpMessage(code: string, merchantName?: string, buyerName?: string): string {
  const greeting = buyerName ? `Olá, ${buyerName.split(" ")[0]}! ` : "";
  const store = merchantName ? ` à ${merchantName}` : "";
  return `${greeting}Seu código de acesso${store} é ${code}. Válido por 5 minutos. Não compartilhe com ninguém.`;
}

@Injectable()
export class SendBuyerPhoneCodeUseCase {
  private readonly logger = new Logger(SendBuyerPhoneCodeUseCase.name);

  constructor(
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    @Optional() @Inject(SMS_PROVIDER) private readonly sms?: SmsSender
  ) {}

  async execute(input: SendBuyerPhoneCodeRequest): Promise<{ sent: boolean; delivered_to: string; channel: string; dev_code?: string }> {
    const normalized = input.phone.replace(/\D/g, "");
    const countryCode = input.countryCode ?? "BR";

    if (normalized.length < 8 || normalized.length > 15) {
      throw new BadRequestException("phone_invalid_length");
    }

    const phoneKey = `${countryCode}:${normalized}`;
    const code = String(randomInt(100000, 1000000));
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.otpStore.save({ phone: phoneKey, codeHash, maxAttempts: 5, expiresAt });
    this.logger.warn(`[OTP-PHONE] code=${code} phone=***${normalized.slice(-4)} expires=${expiresAt.toISOString()}`);

    let channel = "sms";
    let smsSent = false;

    // Try SMS/WhatsApp first
    if (this.sms) {
      try {
        await this.sms.send(normalized, buildOtpMessage(code, input.merchantName, input.buyerName));
        smsSent = true;
      } catch (err) {
        this.logger.error(`[OTP] SMS send failed for ***${normalized.slice(-4)}, trying email fallback`, { error: err });
      }
    } else {
      this.logger.warn(`[OTP] SMS provider not configured for phone=***${normalized.slice(-4)}`);
    }

    // Fallback: send code via email if SMS failed and email available
    if (!smsSent && input.fallbackEmail) {
      channel = "email";
      const apiKey = process.env.RESEND_API_KEY;
      const fromEmail = process.env.RESEND_NOREPLY_EMAIL || process.env.RESEND_FROM_EMAIL || "noreply@zyon.com.br";
      const storeName = input.merchantName || "Zyon";

      if (apiKey) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: fromEmail,
              to: input.fallbackEmail,
              subject: `Seu código de acesso — ${storeName}`,
              html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px;">
                <h2 style="font-size:20px;margin:0 0 12px;">Código de verificação</h2>
                <p style="color:#64748b;font-size:14px;">Não foi possível enviar por WhatsApp. Use o código abaixo:</p>
                <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f1f5f9;border-radius:12px;margin:16px 0;">${code}</div>
                <p style="color:#94a3b8;font-size:12px;">Válido por 5 minutos. Se não solicitou, ignore este email.</p>
              </div>`,
            }),
          });
          this.logger.log(`[OTP] Email fallback sent to ${input.fallbackEmail}`);
        } catch (emailErr) {
          this.logger.error(`[OTP] Email fallback also failed`, { error: emailErr });
        }
      } else {
        this.logger.warn(`[OTP] No RESEND_API_KEY; cannot send email fallback`);
      }
    }

    const isDev = process.env.NODE_ENV !== "production";
    return {
      sent: true,
      delivered_to: `***${normalized.slice(-4)}`,
      channel,
      ...(isDev ? { dev_code: code } : {}),
    };
  }
}
