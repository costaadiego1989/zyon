import { TEMPLATE_SUBMISSION_PORT, type TemplateSubmissionPort } from "../../domain/ports/template-submission.port.js";
import { isApprovedSalesTemplate } from "../../domain/services/recovery-whatsapp-policy.js";
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
import { normalizeRecoveryRecipient } from "../../domain/services/recovery-whatsapp-policy.js";
import { WHATSAPP_TEMPLATE_REPOSITORY, type WhatsAppTemplateRepositoryPort } from "../../domain/ports/whatsapp-template-repository.port.js";

const GRAPH = "https://graph.facebook.com/v23.0";

/** Sends merchant-owned, Meta-approved templates through the official Cloud API. */
@Injectable()
export class WhatsAppTemplateSenderAdapter implements WhatsAppTemplateSenderPort {
  private readonly logger = new Logger(WhatsAppTemplateSenderAdapter.name);

  constructor(
    @Optional() @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo?: WhatsAppConfigRepository,
    @Optional() @Inject(WHATSAPP_TEMPLATE_REPOSITORY) private readonly templates?: WhatsAppTemplateRepositoryPort,
    @Optional() @Inject(TEMPLATE_SUBMISSION_PORT) private readonly submission?: TemplateSubmissionPort,
  ) {}

  async sendTemplate(input: TemplateSendInput): Promise<TemplateSendResult> {
    if (!input.type) return { messageId: "", status: "skipped", reason: "template_type_required" };
    const strictTemplate = true;
    const credentials = await this.credentials(input.merchantId);
    if (!credentials) return { messageId: "", status: "skipped", reason: "meta_connection_unavailable" };
    if (!input.contentSid.trim()) return { messageId: "", status: "skipped", reason: "template_identifier_missing" };
    if (strictTemplate) {
      const template = await this.templates?.findByMerchantAndType(input.merchantId, input.type!, "whatsapp").catch(() => null);
      if (!(input.type === "order_quota" ? isApprovedMerchantTemplate(template, input.merchantId, input.type, input.contentSid)
        : isApprovedSalesTemplate(template, input.merchantId, input.type!, credentials.wabaId) && template.twilioContentSid === input.contentSid)) {
        return { messageId: "", status: "skipped", reason: "approved_template_unavailable" };
      }
      if (input.type !== "order_quota") {
        if (!this.submission || !template?.metaTemplateBody) return { messageId: "", status: "skipped", reason: "template_verification_unavailable" };
        const current = await this.submission.syncStatus(input.merchantId, input.contentSid, { language: template.metaLanguage ?? "pt_BR", body: template.metaTemplateBody }).catch(() => null);
        if (current?.status !== "approved" || current.contentSid !== input.contentSid) return { messageId: "", status: "skipped", reason: "approved_template_unavailable" };
        const latest = await this.credentials(input.merchantId);
        if (!latest || latest.wabaId !== credentials.wabaId || latest.phoneNumberId !== credentials.phoneNumberId) return { messageId: "", status: "skipped", reason: "meta_connection_changed" };
        const latestTemplate = await this.templates?.findByMerchantAndType(input.merchantId, input.type!, "whatsapp").catch(() => null);
        if (!isApprovedSalesTemplate(latestTemplate, input.merchantId, input.type!, credentials.wabaId)
          || latestTemplate.twilioContentSid !== input.contentSid || latestTemplate.metaRevision !== template.metaRevision
          || (input.language || "pt_BR") !== (template.metaLanguage || "pt_BR")) return { messageId: "", status: "skipped", reason: "template_revision_changed" };
      }
    }

    const recipient = normalizeRecoveryRecipient(input.toNumber);
    if (!recipient) return { messageId: "", status: "skipped", reason: "invalid_recipient" };
    const parameters = Object.entries(input.contentVariables ?? {})
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => ({ type: "text", text: String(value) }));
    if (parameters.some(p => !p.text.trim())) return { messageId: "", status: "skipped", reason: "template_variable_unavailable" };
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

function isApprovedMerchantTemplate(
  template: { merchantId: string; type: string; channel: string; isActive: boolean; metaStatus: string | null; twilioContentSid: string | null; metaRevision?: number; metaLastCheckedAt?: Date | null } | null | undefined,
  merchantId: string,
  type: "cart_recovery" | "order_quota",
  contentSid: string,
): boolean {
  return !!template && template.merchantId === merchantId && template.type === type
    && template.channel === "whatsapp" && template.isActive && template.metaStatus === "approved"
    && template.twilioContentSid === contentSid
    && (template.metaRevision === undefined || !!template.metaLastCheckedAt
      && template.metaLastCheckedAt.getTime() <= Date.now()
      && Date.now() - template.metaLastCheckedAt.getTime() < 15 * 60_000);
}
