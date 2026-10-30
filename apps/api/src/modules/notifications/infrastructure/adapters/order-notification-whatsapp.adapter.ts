import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { NotificationWhatsAppInput, NotificationWhatsAppResult, NotificationWhatsAppSender } from "../../application/ports/notification-whatsapp-sender.port.js";
import { SendWhatsAppMessageUseCase } from "../../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { normalizeRecoveryRecipient } from "../../../whatsapp-templates/domain/services/recovery-whatsapp-policy.js";
import { merchantOrderNotificationPhone } from "../../domain/merchant-order-notification-phone.js";
import { PAID_ORDER_RECEIPT_READER, type PaidOrderReceiptReader } from "../../application/ports/paid-order-receipt-reader.port.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const skipped = (reason: string): NotificationWhatsAppResult => ({ status: "skipped", channel: "none", reason });
const unknown = (): NotificationWhatsAppResult => ({ status: "unknown", channel: "none", reason: "provider_acceptance_unknown" });
const WINDOW_MS = 24 * 60 * 60_000;
type AnimationType = "order_paid_animation" | "order_shipped_animation";
function animationUrl(type: AnimationType): string | undefined {
  try {
    const origin = new URL(process.env.API_PUBLIC_URL || process.env.PUBLIC_API_BASE_URL || process.env.PUBLIC_API_URL || "");
    if (origin.protocol !== "https:" || origin.username || origin.password) return undefined;
    return new URL(`/whatsapp/presentation/${type === "order_paid_animation" ? "payment-paid-v1" : "order-shipped-v1"}.mp4`, origin).href;
  } catch { return undefined; }
}

@Injectable()
export class OrderNotificationWhatsAppAdapter implements NotificationWhatsAppSender {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository,
    private readonly templates: SendWhatsAppMessageUseCase,
    @Optional() @Inject(PAID_ORDER_RECEIPT_READER) private readonly receipts?: PaidOrderReceiptReader) {}

  async execute(input: NotificationWhatsAppInput): Promise<NotificationWhatsAppResult> {
    const recipient = input.toPhone ? normalizeRecoveryRecipient(input.toPhone) : null;
    if (!recipient || !input.orderId?.trim() || !input.merchantId?.trim()) return skipped("notification_scope_invalid");
    const animationType = input.type === "order_paid_animation" || input.type === "order_shipped_animation" ? input.type : undefined;
    const sessionMessage = input.type === "merchant_order_paid" || Boolean(animationType);
    const videoUrl = animationType ? animationUrl(animationType) : undefined;
    if (animationType && !videoUrl) return skipped("animation_asset_origin_unavailable");
    const config = await this.configs.findByMerchantId(input.merchantId);
    const credentials = connectedMetaCloudCredentials(config, input.merchantId);
    if (!config || !credentials) return skipped("meta_connection_unavailable");
    const merchant = await this.prisma.merchant.findUnique({ where: { id: input.merchantId },
      select: { name: true, budgetWhatsapp: true, storeSettings: true } });
    if (!merchant) return skipped("merchant_unavailable");
    if (animationType) {
      const sender = normalizeRecoveryRecipient(config.whatsappNumber ?? config.phoneNumber ?? "");
      if (!sender || sender === recipient) return skipped("buyer_animation_recipient_invalid");
      const scope = await this.animationScope(input, recipient, animationType);
      if (!scope) return skipped("buyer_animation_order_scope_unavailable");
      input = { ...input, orderId: scope.externalOrderId };
    }
    const deviceId = config.deviceId ?? `META_CLOUD:${config.id}`;
    let inboundTimestamp: number | undefined;
    if (sessionMessage) {
      if (!animationType && merchantOrderNotificationPhone(merchant.budgetWhatsapp, merchant.storeSettings, config.whatsappNumber ?? config.phoneNumber) !== recipient) {
        return skipped("merchant_recipient_unavailable");
      }
      if (!animationType && (!input.freeformText?.trim() || input.freeformText.length > 4096)) return skipped("notification_content_invalid");
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
        || !this.withinWindow(inboundTimestamp)) return skipped(animationType ? "buyer_animation_session_window_required" : "merchant_approved_template_required");
    }
    // Correction purpose belongs to the receipt only; an order animation is once per type/order.
    const purpose = animationType ? `${animationType}:v1` : input.idempotencyKey ?? input.orderId;
    const id = "order_notification:" + digest(JSON.stringify([input.merchantId, input.type, input.orderId, purpose, recipient]));
    const existing = await this.prisma.whatsAppDelivery.findUnique({ where: { id } });
    if (existing) return this.previous(existing, input.merchantId, config.id);
    const processingToken = randomUUID();
    const metadata = { kind: "order_notification", orderId: input.orderId, type: input.type, recipientHash: digest(recipient),
      channel: sessionMessage ? "whatsapp_session" : "whatsapp_template" };
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
      if (sessionMessage) {
        const current = await this.configs.findByMerchantId(input.merchantId);
        const latest = connectedMetaCloudCredentials(current, input.merchantId);
        const currentMerchant = await this.prisma.merchant.findUnique({ where: { id: input.merchantId },
          select: { budgetWhatsapp: true, storeSettings: true } });
        if (!latest || current?.id !== config.id || (current.deviceId ?? `META_CLOUD:${current.id}`) !== deviceId
          || latest.wabaId !== credentials.wabaId || latest.phoneNumberId !== credentials.phoneNumberId) {
          result = skipped("meta_connection_changed");
        } else if (!animationType && (!currentMerchant || merchantOrderNotificationPhone(currentMerchant.budgetWhatsapp, currentMerchant.storeSettings,
          current.whatsappNumber ?? current.phoneNumber) !== recipient)) {
          result = skipped("merchant_recipient_changed");
        } else if (animationType && (!normalizeRecoveryRecipient(current.whatsappNumber ?? current.phoneNumber ?? "")
          || normalizeRecoveryRecipient(current.whatsappNumber ?? current.phoneNumber ?? "") === recipient
          || !await this.animationScope(input, recipient, animationType))) {
          result = skipped("buyer_animation_order_scope_changed");
        } else if (!this.withinWindow(inboundTimestamp)) {
          result = skipped(animationType ? "buyer_animation_session_window_required" : "merchant_approved_template_required");
        } else {
          const response = await fetch(`https://graph.facebook.com/v23.0/${latest.phoneNumberId}/messages`, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
            headers: { Authorization: `Bearer ${latest.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to: recipient.slice(1),
              ...(animationType ? { type: "video", video: { link: videoUrl,
                caption: animationType === "order_paid_animation" ? "✅ Pagamento aprovado!" : "📦 Pedido enviado!" } }
                : { type: "text", text: { body: input.freeformText } }), biz_opaque_callback_data: id }),
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
        const sent = await this.templates.execute({ ...input, type: input.type as "order_confirmation" | "order_nonphysical_confirmation" | "order_shipped" | "order_delivered", correlationId: id, toPhone: recipient,
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

  private async animationScope(input: NotificationWhatsAppInput, recipient: string, type: AnimationType): Promise<{ externalOrderId: string } | null> {
    const order = await this.prisma.completedOrder.findFirst({ where: { merchantId: input.merchantId,
      OR: [{ id: input.orderId }, { externalOrderId: input.orderId }] },
      select: { id: true, merchantId: true, sessionId: true, externalOrderId: true, status: true } });
    if (!order || !order.sessionId || order.merchantId !== input.merchantId || (order.id !== input.orderId && order.externalOrderId !== input.orderId)) return null;
    if (type === "order_paid_animation") {
      if (order.status !== "approved" || !this.receipts) return null;
      const event = await this.receipts.read({ merchantId: input.merchantId, externalOrderId: order.externalOrderId });
      if (!event?.paidReceipt || event.merchantId !== input.merchantId || event.orderId !== order.externalOrderId
        || !event.buyerPhone || normalizeRecoveryRecipient(event.buyerPhone) !== recipient) return null;
    } else {
      // The current operational command emits order.shipped directly after this state change.
      // A pending/preparing order cannot authorize a shipment animation.
      if (order.status !== "shipped") return null;
      const notice = await this.prisma.outboxMessage.findFirst({ where: { merchantId: input.merchantId,
        eventType: "order.confirmed", causationId: order.externalOrderId,
        payload: { path: ["orderId"], equals: order.externalOrderId } }, orderBy: { createdAt: "asc" }, select: { payload: true } });
      const payload = notice?.payload as Record<string, unknown> | undefined;
      if (payload?.type !== "ORDER_CONFIRMATION" || payload.merchantId !== input.merchantId || payload.orderId !== order.externalOrderId
        || typeof payload.buyerPhone !== "string" || normalizeRecoveryRecipient(payload.buyerPhone) !== recipient) return null;
    }
    return { externalOrderId: order.externalOrderId };
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
