import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";
import { Inject, Logger, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { EmailSenderPort, SendEmailInput, SendEmailOutput } from "../../domain/ports/email-sender.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { applyMerchantEmailBranding, resolveMerchantEmailBranding } from "../../../../shared/email/merchant-email-branding.js";

const logger = new Logger("ResendEmailAdapter");

interface ResendResponse {
  id: string;
  from: string;
  to: string;
  created_at: string;
  error?: string;
}

/**
 * Resend Email Adapter
 * Integrates with Resend (https://resend.com) for transactional email.
 *
 * Environment:
 *   RESEND_API_KEY - API key from Resend dashboard
 *   RESEND_FROM_EMAIL - Default from address (e.g., noreply@app.zyon.com.br)
 *
 * If RESEND_API_KEY is not set, falls back to console logging in dev mode.
 */
export class ResendEmailAdapter implements EmailSenderPort {
  private readonly apiKey = process.env.RESEND_API_KEY;
  private readonly fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@zyon.com.br";
  private readonly resendApiUrl = "https://api.resend.com/emails";

  constructor(
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    // A sandbox can use the configured provider while dispatching only to approved test contacts.
    const allowed = process.env.NOTIFICATION_EMAIL_ALLOWED_RECIPIENTS;
    if (allowed !== undefined) {
      const recipients = allowed.split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
      if (!recipients.includes(input.to.trim().toLowerCase())) return { messageId: "", status: "skipped" };
    }
    // Fallback: console log if no API key (dev mode)
    if (!this.apiKey) {
      if (input.requireDelivery) return { messageId: "", status: "skipped" };
      logger.warn(
        `RESEND_API_KEY not set. Logging email instead of sending.\nTo: ${input.to}\nSubject: ${input.subject}`,
      );
      return {
        messageId: `dev-${Date.now()}`,
        status: "queued",
      };
    }

    const payload = {
      from: input.from || this.fromEmail,
      to: input.to,
      subject: input.subject,
      html: await this.applyMerchantBranding(input),
    };

    try {
      const response = await fetch(this.resendApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
        },
        body: JSON.stringify(payload),
        ...(input.requireDelivery ? { signal: AbortSignal.timeout(15_000) } : {}),
      });

      if (!response.ok) {
        const error = (await response.json()) as ResendResponse;
        logger.error(
          `Resend API error (${response.status}): ${error.error || "Unknown error"}`,
        );
        if (response.status >= 400 && response.status < 500 && ![408,409].includes(response.status)) {
          throw new EmailProviderRejection(`resend_http_${response.status}`, [401,403,429].includes(response.status), `Resend API error: ${error.error || response.statusText}`);
        }
        throw new Error(`Resend API error: ${error.error || response.statusText}`);
      }

      const data = (await response.json()) as ResendResponse;
      if (input.requireDelivery && (typeof data.id !== "string" || !data.id.trim())) {
        throw new Error("Resend acceptance unknown: missing provider message ID");
      }
      logger.debug(`Email sent successfully. Message ID: ${data.id}`);

      return {
        messageId: data.id,
        status: "sent",
      };
    } catch (err) {
      logger.error(`Failed to send email to ${input.to}:`, err);
      throw err;
    }
  }

  private async applyMerchantBranding(input: SendEmailInput): Promise<string> {
    if (!input.merchantId || !this.prisma) return input.html;
    try {
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: input.merchantId },
        select: { name: true, theme: true, storeSettings: true },
      });
      return merchant
        ? applyMerchantEmailBranding(input.html, resolveMerchantEmailBranding(merchant))
        : input.html;
    } catch {
      // A branding lookup must never prevent a transactionally valid email.
      logger.warn("Merchant email branding unavailable; sending unbranded message.");
      return input.html;
    }
  }
}
