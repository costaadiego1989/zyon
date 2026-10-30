import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { NotificationWhatsAppInput, NotificationWhatsAppResult, NotificationWhatsAppSender } from "../../application/ports/notification-whatsapp-sender.port.js";
import { SendWhatsAppMessageUseCase } from "../../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { normalizeRecoveryRecipient } from "../../../whatsapp-templates/domain/services/recovery-whatsapp-policy.js";
import { merchantOrderNotificationPhone } from "../../domain/merchant-order-notification-phone.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const skipped = (reason: string): NotificationWhatsAppResult => ({ status: "skipped", channel: "none", reason });
const unknown = (): NotificationWhatsAppResult => ({ status: "unknown", channel: "none", reason: "provider_acceptance_unknown" });
const WINDOW_MS = 24 * 60 * 60_000;

@Injectable()
export class OrderNotificationWhatsAppAdapter implements NotificationWhatsAppSender {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository,
    private readonly templates: SendWhatsAppMessageUseCase) {}

  async execute(input: NotificationWhatsAppInput): Promise<NotificationWhatsAppResult> {
    const recipient = input.toPhone ? normalizeRecoveryRecipient(input.toPhone) : null;
    if (!recipient || !input.orderId?.trim() || !input.merchantId?.trim()) return skipped("notification_scope_invalid");
    const config = await this.configs.findByMerchantId(input.merchantId);
    const credentials = connectedMetaCloudCredentials(config, input.merchantId);
    if (!config || !credentials) return skipped("meta_connection_unavailable");
    const merchant = await this.prisma.merchant.findUnique({ where: { id: input.merchantId },
      select: { name: true, budgetWhatsapp: true, storeSettings: true } });
    if (!merchant) return skipped("merchant_unavailable");
    const deviceId = config.deviceId ?? `META_CLOUD:${config.id}`;
    let inboundTimestamp: number | undefined;
    if (input.type === "merchant_order_paid") {
      if (merchantOrderNotificationPhone(merchant.budgetWhatsapp, merchant.storeSettings, config.whatsappNumber ?? config.phoneNumber) !== recipient) {
        return skipped("merchant_recipient_unavailable");
      }
      if (!input.freeformText?.trim() || input.freeformText.length > 4096) return skipped("notification_content_invalid");
      // This inbox is populated only after signature/account routing verification.
      // Require the persisted connection, merchant, sender and provider scope too.
      const inbound = await this.prisma.whatsAppWebhookInbox.findFirst({ where: {
        merchantId: input.merchantId, configId: config.id, deviceId, kind: "message",
        createdAt: { gte: new Date(Date.now() - WINDOW_MS), lte: new Date() },
        AND: [
          { payload: { path: ["provider"], equals: "META_CLOUD" } },
          { payload: { path: ["merchantId"], equals: input.merchantId } },
          { payload: { path: ["deviceId"], equals: deviceId } },
          { OR: [recipient, recipient.slice(1)].map(fromNumber => ({ payload: { path: ["fromNumber"], equals: fromNumber } })) },
        ],
      }, orderBy: { createdAt: "desc" }, select: { payload: true } });
      const payload = inbound?.payload as Record<string, unknown> | undefined;
      inboundTimestamp = typeof payload?.timestamp === "number" ? payload.timestamp : undefined;
      if (payload?.provider !== "META_CLOUD" || payload.merchantId !== input.merchantId || payload.deviceId !== deviceId
        || typeof payload.fromNumber !== "string" || normalizeRecoveryRecipient(payload.fromNumber) !== recipient
        || !this.withinWindow(inboundTimestamp)) return skipped("merchant_approved_template_required");
    }
    const id = "order_notification:" + digest(JSON.stringify([input.merchantId, input.type, input.orderId, input.idempotencyKey ?? input.orderId, recipient]));
    const existing = await this.prisma.whatsAppDelivery.findUnique({ where: { id } });
    if (existing) return this.previous(existing, input.merchantId, config.id);
    const processingToken = randomUUID();
    const metadata = { kind: "order_notification", orderId: input.orderId, type: input.type, recipientHash: digest(recipient),
      channel: input.type === "merchant_order_paid" ? "whatsapp_session" : "whatsapp_template" };
    try {
      await this.prisma.whatsAppDelivery.create({ data: { id, merchantId: input.merchantId, configId: config.id,
        deviceId, state: "sending", processingToken, response: metadata } });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      const winner = await this.prisma.whatsAppDelivery.findUnique({ where: { id } });
      return winner ? this.previous(winner, input.merchantId, config.id) : unknown();
    }
    let result: NotificationWhatsAppResult;
    try {
      if (input.type === "merchant_order_paid") {
        const current = await this.configs.findByMerchantId(input.merchantId);
        const latest = connectedMetaCloudCredentials(current, input.merchantId);
        const currentMerchant = await this.prisma.merchant.findUnique({ where: { id: input.merchantId },
          select: { budgetWhatsapp: true, storeSettings: true } });
        if (!latest || current?.id !== config.id || (current.deviceId ?? `META_CLOUD:${current.id}`) !== deviceId
          || latest.wabaId !== credentials.wabaId || latest.phoneNumberId !== credentials.phoneNumberId) {
          result = skipped("meta_connection_changed");
        } else if (!currentMerchant || merchantOrderNotificationPhone(currentMerchant.budgetWhatsapp, currentMerchant.storeSettings,
          current.whatsappNumber ?? current.phoneNumber) !== recipient) {
          result = skipped("merchant_recipient_changed");
        } else if (!this.withinWindow(inboundTimestamp)) {
          result = skipped("merchant_approved_template_required");
        } else {
          const response = await fetch(`https://graph.facebook.com/v23.0/${latest.phoneNumberId}/messages`, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
            headers: { Authorization: `Bearer ${latest.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to: recipient.slice(1), type: "text",
              text: { body: input.freeformText }, biz_opaque_callback_data: id }),
          });
          if (response.ok) {
            const body = await response.json().catch(() => null) as { messages?: Array<{ id?: unknown }> } | null;
            const messageId = body?.messages?.[0]?.id;
            result = typeof messageId === "string" && !!messageId.trim()
              ? { status: "accepted", channel: "whatsapp_session", messageId } : unknown();
          } else result = response.status >= 400 && response.status < 500 && response.status !== 408
            ? { status: "failed", channel: "whatsapp_session", reason: `meta_http_${response.status}` } : unknown();
        }
      } else {
        // Buyer email is an independent channel in the order use case. Do not
        // switch channels after a provider result or send that email twice.
        const sent = await this.templates.execute({ ...input, type: input.type, correlationId: id, toPhone: recipient,
          fallbackEmail: undefined, variables: { ...input.variables, storeName: merchant.name } });
        result = sent.status === "sent" && sent.channel === "whatsapp_template" && sent.messageId?.trim()
          ? { status: "accepted", channel: "whatsapp_template", messageId: sent.messageId }
          : sent.status === "skipped" ? skipped(sent.reason ?? "approved_template_unavailable")
            : sent.status === "failed" ? { status: "failed", channel: "whatsapp_template", reason: sent.reason }
              : unknown();
      }
    } catch { result = unknown(); }
    const state = result.status === "accepted" ? "sent" : result.status === "unknown" ? "submission_unknown" : `notification_${result.status}`;
    const saved = await this.prisma.whatsAppDelivery.updateMany({ where: { id, merchantId: input.merchantId,
      configId: config.id, state: "sending", processingToken }, data: { state,
        response: { ...metadata, ...result, channel: metadata.channel } as Prisma.InputJsonValue, providerMessageId: result.messageId ?? null } });
    if (saved.count !== 1) {
      const reconciled = await this.prisma.whatsAppDelivery.findUnique({ where: { id } });
      return reconciled ? this.previous(reconciled, input.merchantId, config.id) : unknown();
    }
    return result;
  }

  private withinWindow(timestamp: number | undefined): boolean {
    return typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp <= Date.now() && Date.now() - timestamp < WINDOW_MS;
  }

  private previous(row: { merchantId: string; configId: string; state: string; providerMessageId: string | null; response: unknown }, merchantId: string, configId: string): NotificationWhatsAppResult {
    if (row.merchantId !== merchantId || row.configId !== configId) return unknown();
    const response = row.response as Partial<NotificationWhatsAppResult> | null;
    if (row.state === "notification_delivery_failed") return { status: "failed",
      channel: response?.channel === "whatsapp_session" ? "whatsapp_session" : "whatsapp_template",
      reason: "provider_delivery_failed", ...(row.providerMessageId ? { messageId: row.providerMessageId } : {}) };
    if (row.state === "sent" && row.providerMessageId?.trim()) return { status: "accepted",
      channel: response?.channel === "whatsapp_session" ? "whatsapp_session" : "whatsapp_template", messageId: row.providerMessageId };
    if (row.state === "notification_skipped") return skipped(response?.reason ?? "approved_template_unavailable");
    if (row.state === "notification_failed") return { status: "failed", channel: response?.channel ?? "none", reason: response?.reason };
    // A prior attempt may have crossed the provider boundary. No automatic replay.
    return unknown();
  }
}
