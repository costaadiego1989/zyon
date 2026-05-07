import { Injectable, Logger } from "@nestjs/common";

export interface BuyerEmailCapturePayload {
  buyerEmail: string;
  merchantName?: string;
  merchantId: string;
  sessionId: string;
  buyerFirstNameHint?: string;
}

/**
 * E-mail opcional de confirmação após primeiro e-mail digitado no checkout.
 * Sem BREVO_API_KEY ou BREVO_SENDER_EMAIL: no-op silenciosa (nunca quebra o fluxo).
 */
@Injectable()
export class BrevoBuyerEmailNotifier {
  private readonly logger = new Logger(BrevoBuyerEmailNotifier.name);

  /** Fire-and-forget; erros apenas em log debug. */
  notifyCaptured(payload: BuyerEmailCapturePayload): void {
    void this.trySend(payload);
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

    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 5500);

    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": apiKey
        },
        signal: controller.signal,
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: payload.buyerEmail }],
          subject,
          htmlContent: html
        })
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.logger.warn(`brevo_send_http_${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      this.logger.debug(`brevo_send_skipped ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
}
