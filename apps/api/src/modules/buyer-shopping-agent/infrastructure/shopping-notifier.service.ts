import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";
import { SendWhatsAppMessageUseCase } from "../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { ShoppingActivity } from "../domain/shopping-agent.js";
import { buildShoppingAgentEmail, shoppingAgentEmailFrom } from "./shopping-agent-email.js";

export const SHOPPING_NOTIFIER = Symbol("ShoppingNotifier");
export interface ShoppingNotifier {
  send(input: { buyerId: string; merchantId: string; channel: "email" | "whatsapp"; activity: ShoppingActivity }): Promise<{ status: "sent" | "skipped" | "uncertain"; providerId?: string }>;
}
@Injectable()
export class ShoppingNotifierService implements ShoppingNotifier {
  constructor(
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
    private readonly whatsapp: SendWhatsAppMessageUseCase,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyers: BuyerAccountRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}
  async send(input: { buyerId: string; merchantId: string; channel: "email" | "whatsapp"; activity: ShoppingActivity }) {
    const [buyer, merchant, preference] = await Promise.all([this.buyers.findByGlobalUserId(input.buyerId), this.merchants.getProfile(input.merchantId),
      this.prisma.buyerPreference.findUnique({ where: { globalUserId: input.buyerId }, select: { emailOptIn: true, whatsappOptIn: true } })]);
    if (!buyer || !merchant || input.channel === "email" && preference?.emailOptIn === false || input.channel === "whatsapp" && preference?.whatsappOptIn === false) return { status: "skipped" as const };
    const base = (process.env.STOREFRONT_PUBLIC_URL ?? "https://storefront.zyon-payments.com.br").replace(/\/$/, "");
    const link = `${base}/store/${encodeURIComponent(merchant.slug ?? merchant.storeSettings?.slug ?? input.merchantId)}?agent=${encodeURIComponent(input.activity.id)}`;
    if (input.channel === "whatsapp") {
      if (!buyer.phone) return { status: "skipped" as const };
      const result = await this.whatsapp.execute({ merchantId: input.merchantId, type: "shopping_agent_alert", toPhone: buyer.phone,
        variables: { buyerName: buyer.displayName, storeName: merchant.name, productName: input.activity.quote?.items.map(i => i.name).join(", ") ?? "sua tarefa", link } });
      return { status: result.status === "sent" ? "sent" as const : result.status === "uncertain" ? "uncertain" as const : "skipped" as const, providerId: result.messageId };
    }
    const message = buildShoppingAgentEmail({ buyerName: buyer.displayName, storeName: merchant.name,
      logoUrl: merchant.theme?.logoUrl || merchant.storeSettings?.styles?.logoUrl, link, activity: input.activity });
    const result = await this.email.send({ to: buyer.email, ...message,
      from: shoppingAgentEmailFrom(process.env.RESEND_FROM_EMAIL || "noreply@zyon.com.br", merchant.name),
      requireDelivery: true, idempotencyKey: `shopping-agent/${input.activity.id}/email` });
    return { status: result.status === "skipped" || !result.messageId ? "skipped" as const : "sent" as const, providerId: result.messageId };
  }
}
