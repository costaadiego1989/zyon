import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { applyMerchantEmailBranding, resolveMerchantEmailBranding } from "../../../shared/email/merchant-email-branding.js";

export interface BuyerEmailCapturePayload {
  buyerEmail: string;
  merchantName?: string;
  merchantId: string;
  sessionId: string;
  buyerFirstNameHint?: string;
}

export interface OtpEmailPayload {
  buyerEmail: string;
  otpCode: string;
  merchantName?: string;
  merchantId: string;
  buyerFirstNameHint?: string;
}

@Injectable()
export class BrevoBuyerEmailNotifier {
  private readonly logger = new Logger(BrevoBuyerEmailNotifier.name);

  constructor(
    @Optional() private readonly http?: HttpClientService,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  notifyCaptured(payload: BuyerEmailCapturePayload): void {
    void this.trySend(payload);
  }

  sendOtpCode(payload: OtpEmailPayload): void {
    void this.trySendOtp(payload);
  }

  private async trySendOtp(payload: OtpEmailPayload): Promise<void> {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
    const senderName = process.env.BREVO_SENDER_NAME?.trim() || payload.merchantName || "Checkout";
    if (!apiKey || !senderEmail) {
      this.logger.debug(`brevo_otp_skipped: no BREVO_API_KEY or BREVO_SENDER_EMAIL`);
      return;
    }

    const subject = `${payload.otpCode} é seu código de verificação`;
    const greeting = payload.buyerFirstNameHint ? `Olá, ${payload.buyerFirstNameHint}.` : "Olá.";
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<p>${greeting}</p>
<p>Use o código abaixo para confirmar seu e-mail no checkout de <strong>${payload.merchantName ?? payload.merchantId}</strong>:</p>
<div style="text-align:center;margin:24px 0">
  <span style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#7c3aed;background:#f4f1ff;padding:12px 24px;border-radius:8px">${payload.otpCode}</span>
</div>
<p style="color:#666;font-size:13px">Este código expira em 10 minutos. Se você não iniciou esta compra, ignore este e-mail.</p>
</div>`;
    const brandedHtml = await this.withMerchantBranding(payload, html);

    try {
      const res = await (this.http ?? this.fallbackHttp()).fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": apiKey
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: payload.buyerEmail }],
          subject,
          htmlContent: brandedHtml
        })
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.logger.warn(`brevo_otp_http_${res.status} ${body.slice(0, 200)}`);
      } else {
        this.logger.log(`OTP sent to ${payload.buyerEmail}`);
      }
    } catch (err) {
      this.logger.debug(`brevo_otp_skipped ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async trySend(payload: BuyerEmailCapturePayload): Promise<void> {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
    const senderName = process.env.BREVO_SENDER_NAME?.trim() || payload.merchantName || "Checkout";
    if (!apiKey || !senderEmail) return;

    const subject = `[${payload.merchantName ?? payload.merchantId}] Confirme o uso deste e-mail na compra`;
    const greeting = payload.buyerFirstNameHint ? `Olá, ${payload.buyerFirstNameHint}. ` : "";
    const html = `<p>${greeting}Registramos o e-mail <strong>${payload.buyerEmail}</strong> nesta sessão de checkout (${payload.sessionId}).</p>
<p>Se você não iniciou esta compra, pode ignorar este aviso ou falar com a loja.</p>`;

    const brandedHtml = await this.withMerchantBranding(payload, html);

    try {
      const res = await (this.http ?? this.fallbackHttp()).fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": apiKey
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: payload.buyerEmail }],
          subject,
          htmlContent: brandedHtml
        })
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.logger.warn(`brevo_send_http_${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      this.logger.debug(`brevo_send_skipped ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async withMerchantBranding(
    payload: Pick<BuyerEmailCapturePayload, "merchantId" | "merchantName">,
    html: string,
  ): Promise<string> {
    const fallback = resolveMerchantEmailBranding({ name: payload.merchantName ?? "Sua loja" });
    if (!this.prisma) return applyMerchantEmailBranding(html, fallback);
    try {
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: payload.merchantId },
        select: { name: true, theme: true, storeSettings: true },
      });
      return applyMerchantEmailBranding(html, merchant ? resolveMerchantEmailBranding(merchant) : fallback);
    } catch {
      return applyMerchantEmailBranding(html, fallback);
    }
  }

  private fallbackHttp(): HttpClientService {
    return new HttpClientService({ timeout: 5500, retries: 1 });
  }
}
