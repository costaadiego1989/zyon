import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { connectedMetaCloudCredentials } from "../../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { whatsappE164 } from "../../../whatsapp-channel/domain/services/whatsapp-phone.js";
import {
  type PostSaleWhatsAppSenderPort,
  type PostSaleTemplateSendInput,
  type PostSaleTemplateSendResult,
} from "../../domain/ports/post-sale-whatsapp-sender.port.js";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";

const GRAPH = "https://graph.facebook.com/v23.0";

/** Direct Meta Cloud API sender for approved post-sale templates. */
@Injectable()
export class WhatsAppTemplateSenderAdapter implements PostSaleWhatsAppSenderPort {
  private readonly logger = new Logger(WhatsAppTemplateSenderAdapter.name);

  constructor(
    @Optional() @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo?: WhatsAppConfigRepository,
  ) {}

  async sendTemplate(input: PostSaleTemplateSendInput): Promise<PostSaleTemplateSendResult> {
    const credentials = await this.credentials(input.merchantId);
    if (!credentials) return { messageId: "", status: "skipped", reason: "meta_connection_unavailable" };
    if (!input.contentSid.trim()) return { messageId: "", status: "skipped", reason: "template_identifier_missing" };
    const recipient = whatsappE164(input.toNumber);
    if (!recipient) return { messageId: "", status: "skipped", reason: "invalid_phone" };

    const parameters = Object.entries(input.contentVariables ?? {})
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => ({ type: "text", text: String(value) }));
    const template: Record<string, unknown> = { name: input.contentSid, language: { code: input.language || "pt_BR" } };
    if (parameters.length) template.components = [{ type: "body", parameters }];

    let response: Response;
    try {
      response = await fetch(`${GRAPH}/${credentials.phoneNumberId}/messages`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: recipient.slice(1), type: "template", template }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error("Meta post-sale template transport failed", { merchantId: input.merchantId, reason });
      throw new Error(`whatsapp_template_transport_failed: ${reason}`);
    }
    if (response.ok) {
      const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: unknown }> } | null;
      const messageId = typeof payload?.messages?.[0]?.id === "string" ? payload.messages[0].id : "";
      if (messageId.trim()) return { messageId, status: "sent" };
      throw new Error("whatsapp_template_transport_failed: missing_message_identifier");
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      return { messageId: "", status: "failed", reason: `meta_http_${response.status}` };
    }
    throw new Error(`whatsapp_template_send_failed: ${response.status}`);
  }

  private async credentials(merchantId: string) {
    try { return connectedMetaCloudCredentials(await this.configRepo?.findByMerchantId(merchantId), merchantId); }
    catch { return null; }
  }
}
