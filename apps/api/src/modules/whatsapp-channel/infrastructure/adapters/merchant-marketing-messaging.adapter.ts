import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  MARKETING_ACCEPT,
  MARKETING_DECLINE,
  type MerchantMarketingMessaging,
  type MerchantMarketingSendResult,
} from "../../../../shared/contracts/marketing.js";
import {
  TEMPLATE_SUBMISSION_PORT,
  type TemplateSubmissionPort,
} from "../../../whatsapp-templates/public-api.js";
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsAppConfigRepository,
} from "../../domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../domain/services/connected-meta-cloud-credentials.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";

export const MERCHANT_MARKETING_FETCH = Symbol("MERCHANT_MARKETING_FETCH");
/** Channel-owned transport. No caller supplies a token, WABA or Graph endpoint. */
@Injectable()
export class MerchantMarketingMessagingAdapter
  implements MerchantMarketingMessaging
{
  private readonly graph = `https://graph.facebook.com/${
    /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION ?? "")
      ? process.env.META_GRAPH_API_VERSION
      : "v23.0"
  }`;
  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configs: WhatsAppConfigRepository,
    @Inject(TEMPLATE_SUBMISSION_PORT)
    private readonly templates: TemplateSubmissionPort,
    @Optional()
    @Inject(MERCHANT_MARKETING_FETCH)
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async sendFreeform(
    input: Parameters<MerchantMarketingMessaging["sendFreeform"]>[0]
  ) {
    const connection = await this.connection(input.merchantId);
    const phone = whatsappE164(input.phone);
    if (
      !connection ||
      !phone ||
      input.deviceId !== `META_CLOUD:${connection.configId}`
    )
      return {
        status: "suppressed" as const,
        reason: "meta_connection_unavailable",
      };
    return this.send(connection, {
      messaging_product: "whatsapp",
      to: phone.slice(1),
      type: "text",
      text: { body: input.text },
    });
  }
  async sendOpening(
    input: Parameters<MerchantMarketingMessaging["sendOpening"]>[0]
  ) {
    const connection = await this.connection(input.merchantId);
    const phone = whatsappE164(input.phone);
    if (
      !connection ||
      !phone ||
      input.deviceId !== `META_CLOUD:${connection.configId}`
    )
      return {
        status: "suppressed" as const,
        reason: "meta_connection_unavailable",
      };
    return this.send(connection, {
      messaging_product: "whatsapp",
      to: phone.slice(1),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: input.text },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: MARKETING_ACCEPT, title: "Quero receber" },
            },
            {
              type: "reply",
              reply: { id: MARKETING_DECLINE, title: "Agora não" },
            },
          ],
        },
      },
    });
  }
  async submitTemplate(
    input: Parameters<MerchantMarketingMessaging["submitTemplate"]>[0]
  ) {
    const connection = await this.connection(input.merchantId);
    if (!connection)
      return { name: "", status: "connection_unavailable", wabaId: null };
    try {
      const result = await this.templates.createAndSubmit({
        merchantId: input.merchantId,
        friendlyName: input.name,
        language: input.language,
        metaBody: input.body,
        sampleVariables: {},
        category: "MARKETING",
      });
      return {
        name: result.contentSid || input.name,
        status: result.status,
        wabaId: connection.wabaId,
      };
    } catch {
      return {
        name: input.name,
        status: "submission_unknown",
        wabaId: connection.wabaId,
      };
    }
  }
  async inspectTemplate(
    input: Parameters<MerchantMarketingMessaging["checkTemplate"]>[0]
  ) {
    const connection = await this.connection(input.merchantId);
    if (!connection || (input.wabaId && connection.wabaId !== input.wabaId))
      return {
        name: input.name,
        status: "connection_unavailable",
        wabaId: input.wabaId,
      };
    const result = await this.templates.syncStatus(
      input.merchantId,
      input.name,
      { body: input.body, language: input.language, category: "MARKETING" }
    );
    const latest = await this.connection(input.merchantId);
    if (
      latest?.configId !== connection.configId ||
      latest.wabaId !== connection.wabaId ||
      latest.phoneNumberId !== connection.phoneNumberId
    )
      return {
        name: input.name,
        status: "connection_changed",
        wabaId: input.wabaId,
      };
    return {
      name: input.name,
      status: result.contentSid === input.name ? result.status : "unavailable",
      wabaId: connection.wabaId,
    };
  }
  async checkTemplate(
    input: Parameters<MerchantMarketingMessaging["checkTemplate"]>[0]
  ) {
    const connection = await this.connection(input.merchantId);
    if (!connection || connection.wabaId !== input.wabaId) return false;
    const status = await this.templates.syncStatus(
      input.merchantId,
      input.name,
      { body: input.body, language: input.language, category: "MARKETING" }
    );
    if (status.status !== "approved" || status.contentSid !== input.name)
      return false;
    const latest = await this.connection(input.merchantId);
    return (
      latest?.configId === connection.configId &&
      latest.wabaId === connection.wabaId &&
      latest.phoneNumberId === connection.phoneNumberId
    );
  }
  async sendCampaign(
    input: Parameters<MerchantMarketingMessaging["sendCampaign"]>[0]
  ) {
    const phone = whatsappE164(input.phone);
    if (!phone)
      return { status: "suppressed" as const, reason: "invalid_recipient" };
    const before = await this.connection(input.merchantId);
    if (
      !before ||
      before.wabaId !== input.wabaId ||
      !(await this.checkTemplate({ ...input, name: input.templateName }))
    )
      return {
        status: "suppressed" as const,
        reason: "approved_template_unavailable",
      };
    const connection = await this.connection(input.merchantId);
    if (
      !connection ||
      connection.configId !== before.configId ||
      connection.wabaId !== before.wabaId ||
      connection.phoneNumberId !== before.phoneNumberId
    )
      return {
        status: "suppressed" as const,
        reason: "meta_connection_changed",
      };
    return this.send(connection, {
      messaging_product: "whatsapp",
      to: phone.slice(1),
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.language },
      },
    });
  }
  private async connection(merchantId: string) {
    const config = await this.configs.findByMerchantId(merchantId);
    const credentials = connectedMetaCloudCredentials(config, merchantId);
    return credentials && config
      ? { ...credentials, configId: config.id }
      : null;
  }
  private async send(
    connection: { accessToken: string; phoneNumberId: string },
    payload: object
  ): Promise<MerchantMarketingSendResult> {
    try {
      const response = await this.fetcher(
        `${this.graph}/${connection.phoneNumberId}/messages`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok)
        return response.status >= 400 &&
          response.status < 500 &&
          ![408, 409, 429].includes(response.status)
          ? { status: "failed", reason: `meta_http_${response.status}` }
          : { status: "unknown", reason: "provider_acceptance_unknown" };
      const data = (await response.json()) as {
        messages?: Array<{ id?: unknown }>;
      };
      const id = data.messages?.[0]?.id;
      return typeof id === "string" && id.trim()
        ? { status: "accepted", messageId: id }
        : { status: "unknown", reason: "provider_acceptance_unknown" };
    } catch {
      return { status: "unknown", reason: "provider_acceptance_unknown" };
    }
  }
}
