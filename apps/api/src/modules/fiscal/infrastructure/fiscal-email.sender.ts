import type { EmailSenderPort, SendEmailInput } from "../../notifications/domain/ports/email-sender.port.js";
import { EmailProviderRejection } from "../../notifications/domain/ports/email-provider-rejection.js";
import { escapeEmailHtml } from "../../../shared/messaging/email-content.js";
import type { FiscalArtifactPort } from "../domain/fiscal-artifact.port.js";
import type { FiscalDeliveryContext, FiscalDeliveryPlan, FiscalDeliverySenderPort } from "../domain/fiscal-delivery.port.js";
import type { FiscalBuyerPortalPort } from "./fiscal-buyer-portal.js";
/** Protected server/account configuration, not a merchant or buyer body assertion. */
export interface FiscalEmailAccountPort { read(): Promise<{ accountId: string; enabled: boolean } | null> }
export class FiscalEmailSender implements FiscalDeliverySenderPort {
  constructor(private readonly email: EmailSenderPort, private readonly account: FiscalEmailAccountPort, private readonly artifacts: FiscalArtifactPort, private readonly portal: FiscalBuyerPortalPort) {}
  async prepare(context: FiscalDeliveryContext): Promise<FiscalDeliveryPlan> {
    const { delivery, document } = context;
    if (delivery.channel !== "email" || delivery.responsibleSender !== "zyon" || !delivery.destination || !delivery.idempotencyKey) return { ready: false, reasonCode: "fiscal_email_destination_or_owner_invalid" };
    if (!document.authorizationProtocol || !["authorized", "cancelled"].includes(document.state)) return { ready: false, reasonCode: "fiscal_document_pending" };
    const account = await this.account.read(); if (!account?.enabled || !account.accountId.trim()) return { ready: false, reasonCode: "fiscal_email_provider_unconfigured" };
    const link = await this.portal.link(context); if (!link) return { ready: false, reasonCode: "fiscal_portal_context_unavailable" };
    const scope = { merchantId: document.merchantId, environment: document.environment };
    const attachments: NonNullable<SendEmailInput["attachments"]> = [];
    for (const kind of ["xml", "danfe"] as const) { const file = await this.artifacts.get(scope, document.id, kind); if (file) attachments.push({ filename: `nota-fiscal.${kind === "xml" ? "xml" : "pdf"}`, content: Buffer.from(file.bytes).toString("base64"), contentType: file.mimeType, contentId: "fiscal-" + kind }); }
    const label = document.environment === "homologation" ? "Nota fiscal de homologação" : "Nota fiscal";
    const text = `${label} ${document.number ?? ""}. Consulte os arquivos no seu pedido: ${link}`;
    return { ready: true, provider: "resend", accountId: account.accountId, send: async () => {
      // Recheck account binding before the actual existing adapter write.
      const current = await this.account.read(); if (!current?.enabled || current.accountId !== account.accountId) return { state: "blocked", reasonCode: "fiscal_email_account_changed" };
      try {
        const result = await this.email.send({ to: delivery.destination!, subject: label, text, html: `<p>${escapeEmailHtml(label)} ${escapeEmailHtml(document.number ?? "")}</p><p><a href="${escapeEmailHtml(link)}">Consultar nota no pedido</a></p>`, attachments, requireDelivery: true, idempotencyKey: delivery.idempotencyKey! });
        if (result.status === "skipped") return { state: "blocked", reasonCode: "fiscal_email_provider_unconfigured" };
        return result.status === "sent" && result.messageId?.trim() ? { state: "accepted", messageId: result.messageId } : { state: "delivery_unknown", reasonCode: "fiscal_email_acceptance_unknown" };
      } catch (error) { return error instanceof EmailProviderRejection ? { state: "failed", reasonCode: "fiscal_email_provider_rejected" } : { state: "delivery_unknown", reasonCode: "fiscal_email_acceptance_unknown" }; }
    } };
  }
}
