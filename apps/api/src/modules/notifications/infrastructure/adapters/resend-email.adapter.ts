import { Logger } from "@nestjs/common";
import type { EmailSenderPort, SendEmailInput, SendEmailOutput } from "../../domain/ports/email-sender.port.js";

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

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    // Fallback: console log if no API key (dev mode)
    if (!this.apiKey) {
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
      html: input.html,
    };

    try {
      const response = await fetch(this.resendApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = (await response.json()) as ResendResponse;
        logger.error(
          `Resend API error (${response.status}): ${error.error || "Unknown error"}`,
        );
        throw new Error(`Resend API error: ${error.error || response.statusText}`);
      }

      const data = (await response.json()) as ResendResponse;
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
}
