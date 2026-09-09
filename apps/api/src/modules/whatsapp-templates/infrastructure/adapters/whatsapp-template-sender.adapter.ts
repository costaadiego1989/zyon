import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import type {
  WhatsAppTemplateSenderPort,
  TemplateSendInput,
  TemplateSendResult,
} from "../../domain/ports/whatsapp-template-sender.port.js";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { normalizeRecoveryRecipient, isApprovedRecoveryTemplate } from "../../domain/services/recovery-whatsapp-policy.js";
import { WHATSAPP_TEMPLATE_REPOSITORY, type WhatsAppTemplateRepositoryPort } from "../../domain/ports/whatsapp-template-repository.port.js";

const GRAPH = "https://graph.facebook.com/v23.0";

/** Sends merchant-owned, Meta-approved templates through the official Cloud API. */
@Injectable()
export class WhatsAppTemplateSenderAdapter implements WhatsAppTemplateSenderPort {
  private readonly logger = new Logger(WhatsAppTemplateSenderAdapter.name);

  constructor(
    @Optional() @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo?: WhatsAppConfigRepository,
    @Optional() @Inject(WHATSAPP_TEMPLATE_REPOSITORY) private readonly templates?: WhatsAppTemplateRepositoryPort,
  ) {}

  async sendTemplate(input: TemplateSendInput): Promise<TemplateSendResult> {
    const strictRecovery = input.type === "cart_recovery";
    const credentials = await this.credentials(input.merchantId);
    if (!credentials) return { messageId: "", status: "skipped", reason: "meta_connection_unavailable" };
    if (!input.contentSid.trim()) return { messageId: "", status: "skipped", reason: "template_identifier_missing" };
    if (strictRecovery) {
      const template = await this.templates?.findByMerchantAndType(input.merchantId, "cart_recovery", "whatsapp").catch(() => null);
      if (!isApprovedRecoveryTemplate(template, input.merchantId, input.contentSid)) {
        return { messageId: "", status: "skipped", reason: "approved_template_unavailable" };
      }
    }

    const recipient = normalizeRecoveryRecipient(input.toNumber);
    if (!recipient) return { messageId: "", status: "skipped", reason: "invalid_recipient" };
    const parameters = Object.entries(input.contentVariables ?? {})
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => ({ type: "text", text: String(value) }));
    const template: Record<string, unknown> = {
      name: input.contentSid,
      language: { code: input.language || "pt_BR" },
    };
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
      this.logger.error("Meta template transport failed", { merchantId: input.merchantId, reason });
      return { messageId: "", status: "uncertain", reason: "provider_acceptance_unknown" };
    }

    if (response.ok) {
      const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: unknown }> } | null;
      const messageId = typeof payload?.messages?.[0]?.id === "string" ? payload.messages[0].id : "";
      return messageId.trim()
        ? { messageId, status: "sent" }
        : { messageId: "", status: "uncertain", reason: "provider_acceptance_unknown" };
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      // A completed Graph 4xx rejects before Meta creates a message, so email is safe.
      return { messageId: "", status: "failed", acceptance: "not_accepted", reason: `meta_http_${response.status}` };
    }
    return { messageId: "", status: "uncertain", reason: "provider_acceptance_unknown" };
  }

  private async credentials(merchantId: string) {
    try { return connectedMetaCloudCredentials(await this.configRepo?.findByMerchantId(merchantId), merchantId); }
    catch { return null; }
  }
}
