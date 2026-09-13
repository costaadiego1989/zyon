import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { SCHEDULED_MESSAGE_REPOSITORY, type ScheduledMessageRepositoryPort } from "../../domain/ports/scheduled-message-repository.port.js";
import { PostSaleAiCopywriterService } from "../services/post-sale-ai-copywriter.service.js";
import { WHATSAPP_POST_SALE_CONTEXT_PORT, type WhatsAppPostSaleContextPort } from "../../../whatsapp-channel/domain/ports/whatsapp-post-sale-context.port.js";
import { SendWhatsAppMessageUseCase } from "../../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { PostSaleConfigService, type PostSaleCampaignConfig } from "../services/post-sale-config.service.js";
import { CampaignContactConsentService } from "../../../campaign-consent/campaign-contact-consent.service.js";

const enabledKey: Record<string, keyof PostSaleCampaignConfig> = { follow_up: "followUpEnabled", review_request: "reviewEnabled", nps: "npsEnabled", cross_sell: "crossSellEnabled", win_back: "winBackEnabled", loyalty: "loyaltyEnabled", reorder: "reorderEnabled" };

@Injectable()
export class ProcessScheduledMessagesUseCase {
  private readonly logger = new Logger(ProcessScheduledMessagesUseCase.name);
  constructor(
    @Inject(SCHEDULED_MESSAGE_REPOSITORY) private readonly messages: ScheduledMessageRepositoryPort,
    private readonly sender: SendWhatsAppMessageUseCase,
    private readonly copywriter: PostSaleAiCopywriterService,
    private readonly config: PostSaleConfigService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(WHATSAPP_POST_SALE_CONTEXT_PORT) private readonly contextPort?: WhatsAppPostSaleContextPort,
    @Optional() private readonly campaignConsent?: CampaignContactConsentService,
  ) {}

  async execute(): Promise<{ processed: number; sent: number; failed: number }> {
    const stats = { processed: 0, sent: 0, failed: 0 };
    const pending = await this.messages.findPendingDue(20);
    stats.processed = pending.length;
    for (const msg of pending) {
      let dispatchStarted = false;
      try {
        const cfg = await this.config.getConfig(msg.merchantId);
        if (cfg[enabledKey[msg.type]] !== true) {
          await this.messages.update(msg.id, { status: "cancelled", failureReason: "campaign_disabled" });
          continue;
        }
        const merchant = await this.prisma.merchant.findUnique({ where: { id: msg.merchantId }, select: { name: true } });
        if (!merchant) {
          await this.messages.update(msg.id, { status: "cancelled", failureReason: "merchant_unavailable" });
          continue;
        }
        if (["follow_up", "review_request", "nps", "cross_sell", "reorder"].includes(msg.type)) {
          const order = await this.prisma.completedOrder.findFirst({ where: { merchantId: msg.merchantId,
            OR: [{ id: msg.orderId }, { externalOrderId: msg.orderId }] }, select: { status: true } });
          const eligible = msg.type === "reorder" ? ["approved", "paid", "shipped", "delivered"] : ["delivered"];
          if (!order || !eligible.includes(order.status)) {
            await this.messages.update(msg.id, { status: "cancelled", failureReason: "order_no_longer_eligible" });
            continue;
          }
        }
        // Scanner-created messages may carry only the platform buyer ID or a legacy session ID.
        if (!msg.buyerPhone || !msg.buyerEmail) {
          let account = await this.prisma.buyerAccount.findUnique({ where: { globalUserId: msg.buyerId }, select: { phone: true, email: true, displayName: true } });
          if (!account) {
            const identity = await this.prisma.buyerIdentity.findFirst({ where: { id: msg.buyerId, merchantId: msg.merchantId }, select: { globalUserId: true } });
            if (identity?.globalUserId) account = await this.prisma.buyerAccount.findUnique({ where: { globalUserId: identity.globalUserId }, select: { phone: true, email: true, displayName: true } });
          }
          if (!account) {
            const session = await this.prisma.checkoutSession.findFirst({ where: { sessionId: msg.buyerId, merchantId: msg.merchantId }, select: { globalUserId: true } });
            if (session?.globalUserId) account = await this.prisma.buyerAccount.findUnique({ where: { globalUserId: session.globalUserId }, select: { phone: true, email: true, displayName: true } });
          }
          msg.buyerPhone ||= account?.phone ?? null;
          msg.buyerEmail ||= account?.email ?? null;
          msg.buyerName ||= account?.displayName ?? null;
        }
        let consentBuyerId = msg.buyerId;
        if (this.campaignConsent) {
          const direct = await this.prisma.buyerAccount.findUnique({ where: { globalUserId: consentBuyerId }, select: { globalUserId: true } });
          if (!direct) {
            const identity = await (this.prisma as any).buyerIdentity?.findFirst?.({ where: { id: msg.buyerId, merchantId: msg.merchantId }, select: { globalUserId: true } });
            const session = identity ? undefined : await (this.prisma as any).checkoutSession?.findFirst?.({ where: { sessionId: msg.buyerId, merchantId: msg.merchantId }, select: { globalUserId: true } });
            consentBuyerId = identity?.globalUserId ?? session?.globalUserId ?? consentBuyerId;
          }
        }
        const canUseWhatsApp = msg.channel === "whatsapp" && Boolean(msg.buyerPhone)
          && (!this.campaignConsent || await this.campaignConsent.canContact({ merchantId: msg.merchantId, globalUserId: consentBuyerId, channel: "whatsapp" }));
        const canUseEmail = Boolean(msg.buyerEmail)
          && (!this.campaignConsent || await this.campaignConsent.canContact({ merchantId: msg.merchantId, globalUserId: consentBuyerId, channel: "email" }));
        if (!canUseWhatsApp && !canUseEmail) {
          await this.messages.update(msg.id, { status: "cancelled", failureReason: "contact_consent_not_granted" });
          continue;
        }
        const meta = msg.metadata ?? {};
        const coupon = typeof meta.couponCode === "string" ? meta.couponCode : undefined;
        const discount = typeof meta.discountPercent === "number" ? meta.discountPercent : undefined;
        const link = typeof meta.reorderLink === "string" ? meta.reorderLink : typeof meta.link === "string" ? meta.link : undefined;
        const content = await this.copywriter.generate({ type: msg.type, channel: "email", buyerName: msg.buyerName || "Cliente",
          productName: msg.productName || "seu pedido", merchantId: msg.merchantId, buyerId: msg.buyerId,
          storeName: merchant.name, couponCode: coupon, discountPercent: discount, freeShipping: meta.freeShipping === true,
          expiresAt: typeof meta.expiresAt === "string" ? meta.expiresAt : undefined, link });
        dispatchStarted = true;
        const result = await this.sender.execute({ merchantId: msg.merchantId, type: msg.type,
          toPhone: canUseWhatsApp ? msg.buyerPhone ?? undefined : undefined,
          fallbackEmail: canUseEmail ? msg.buyerEmail ?? undefined : undefined, freeformText: content,
          variables: { buyerName: msg.buyerName ?? "Cliente", productName: msg.productName ?? "seu pedido", storeName: merchant.name,
            orderId: msg.orderId, link, coupon, discount: discount == null ? undefined : `${discount}%`,
            couponBlock: coupon ? `${coupon}${discount == null ? "" : ` (${discount}% de desconto)`}` : "Consulte as condições disponíveis na loja." },
        });
        const actualChannel = result.channel === "whatsapp_template" ? "whatsapp" : result.channel === "email" ? "email" : undefined;
        if (result.status !== "sent" || !result.messageId?.trim() || !actualChannel) {
          const unknown = result.status === "uncertain" || result.status === "sent";
          await this.messages.update(msg.id, { status: unknown ? "unknown" : result.status === "failed" ? "failed" : "skipped",
            channel: actualChannel, failureReason: result.reason ?? (unknown ? "provider_acceptance_unknown" : "no_reachable_channel") });
          if (unknown || result.status === "failed") stats.failed++;
          continue;
        }
        await this.messages.update(msg.id, { status: "sent", channel: actualChannel, sentAt: new Date(),
          providerMessageId: result.messageId, messageContent: content });
        stats.sent++;
        // Only a WhatsApp delivery may put the WhatsApp conversation into a reply stage.
        if (actualChannel === "whatsapp" && msg.buyerPhone && this.contextPort) {
          const stage = msg.type === "nps" ? "awaiting_nps" : msg.type === "review_request" ? "awaiting_review" : null;
          if (stage) await this.contextPort.setPostSaleContext(msg.merchantId, msg.buyerPhone, { stage,
            orderId: msg.orderId, buyerId: msg.buyerId, productId: typeof meta.productId === "string" ? meta.productId : undefined,
            askedAt: new Date().toISOString() }).catch(() => this.logger.warn("Failed to set post-sale reply context"));
        }
      } catch {
        stats.failed++;
        // A timeout or a failed database write after acceptance cannot authorize a resend.
        await this.messages.update(msg.id, { status: dispatchStarted ? "unknown" : "failed",
          failureReason: dispatchStarted ? "provider_acceptance_unknown" : "message_preparation_failed" }).catch(() => undefined);
      }
    }
    return stats;
  }
}
