import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PrismaClient, DigitalEntitlement } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";
import { SendWhatsAppMessageUseCase } from "../../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { DigitalDownloadLinkService } from "../../domain/services/digital-download-link.service.js";
import { projectDigitalFulfillment } from "../../../../shared/persistence/order-fulfillment.js";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

@Injectable()
export class DigitalFulfillmentService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
    @Inject(SendWhatsAppMessageUseCase) private readonly whatsapp: SendWhatsAppMessageUseCase,
    @Inject(DigitalDownloadLinkService) private readonly links: DigitalDownloadLinkService,
  ) {}

  async deliver(merchantId: string, deliveryId: string): Promise<void> {
    const delivery = await this.prisma.digitalDelivery.findFirst({ where: { id: deliveryId, merchantId }, include: { entitlement: { include: { order: true, payment: true } } } });
    if (!delivery) return;
    if (["sent", "blocked", "uncertain", "revoked"].includes(delivery.status)) {
      await this.prisma.$transaction(tx => projectDigitalFulfillment(tx, merchantId, delivery.entitlement.orderId));
      return;
    }
    if (delivery.status === "sending") {
      if (delivery.claimedAt && delivery.claimedAt.getTime() < Date.now() - 15 * 60_000) {
        await this.prisma.digitalDelivery.updateMany({ where: { id: deliveryId, merchantId, status: "sending", claimedAt: delivery.claimedAt }, data: { status: "uncertain", reason: "provider_acceptance_unknown" } });
        await this.prisma.$transaction(tx => projectDigitalFulfillment(tx, merchantId, delivery.entitlement.orderId));
        return;
      }
      throw new Error("digital_delivery_in_progress");
    }
    const grant = delivery.entitlement;
    const creation = grant.payment.creation as { qa_seed?: string; provider?: string } | null;
    if (creation?.qa_seed === "zyon_fulfillment_qa_20261005" && creation.provider === "qa_disabled") {
      await this.prisma.digitalDelivery.updateMany({ where: { id: deliveryId, merchantId, status: "pending" }, data: { status: "blocked", reason: "sandbox_fixture_transport_disabled" } });
      await this.prisma.$transaction(tx => projectDigitalFulfillment(tx, merchantId, grant.orderId));
      return;
    }
    if (!await this.isAvailable(grant)) {
      await this.prisma.digitalDelivery.updateMany({ where: { id: deliveryId, merchantId, status: "pending" }, data: { status: "revoked", reason: "digital_access_unavailable" } });
      await this.prisma.$transaction(tx => projectDigitalFulfillment(tx, merchantId, grant.orderId));
      return;
    }
    // Configuration errors occur before claiming or dispatching and are retryable.
    const link = this.links.issue(grant);
    const claimed = await this.prisma.digitalDelivery.updateMany({ where: { id: deliveryId, merchantId, status: "pending" }, data: { status: "sending", claimedAt: new Date(), reason: null } });
    if (claimed.count !== 1) throw new Error("digital_delivery_in_progress");
    let state: { status: string; reason?: string; providerId?: string };
    try {
      if (delivery.channel === "email") {
        const result = await this.email.send({ to: delivery.destination, subject: `Seu produto digital: ${grant.productName}`.replace(/[\r\n]/g, " "),
          html: `<p>Olá${delivery.buyerName ? `, ${escapeHtml(delivery.buyerName)}` : ""}!</p><p>Seu pagamento foi confirmado. Acesse <strong>${escapeHtml(grant.productName)}</strong>:</p><p><a href="${escapeHtml(link)}">Baixar produto digital</a></p><p>O acesso fica disponível até ${grant.expiresAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Guarde este link.</p>`,
          requireDelivery: true, idempotencyKey: `digital-delivery-${delivery.id}` });
        state = result.messageId?.trim() && ["sent", "queued"].includes(result.status)
          ? { status: "sent", providerId: result.messageId }
          : result.status === "skipped" ? { status: "blocked", reason: "email_not_configured" }
          : { status: "uncertain", reason: "provider_acceptance_unknown" };
      } else if (delivery.channel === "whatsapp") {
        const result = await this.whatsapp.execute({ merchantId, type: "digital_delivery", toPhone: delivery.destination,
          variables: { buyerName: delivery.buyerName ?? "Cliente", productName: grant.productName, orderId: grant.order.externalOrderId, link } });
        state = result.channel === "whatsapp_template" && result.status === "sent" && result.messageId
          ? { status: "sent", providerId: result.messageId }
          : result.status === "skipped" ? { status: "blocked", reason: "whatsapp_template_unavailable" }
          : { status: "uncertain", reason: "provider_acceptance_unknown" };
      } else state = { status: "blocked", reason: "invalid_delivery_channel" };
    } catch (error) {
      state = error instanceof EmailProviderRejection
        ? { status: "blocked", reason: "email_provider_rejected" }
        : { status: "uncertain", reason: "provider_acceptance_unknown" };
    }
    await this.prisma.digitalDelivery.updateMany({ where: { id: deliveryId, merchantId, status: "sending" },
      data: { ...state, ...(state.status === "sent" ? { sentAt: new Date() } : {}) } });
    await this.prisma.$transaction(tx => projectDigitalFulfillment(tx, merchantId, grant.orderId));
  }

  async resolve(token: unknown): Promise<string> {
    let claims: ReturnType<DigitalDownloadLinkService["verify"]>;
    try { claims = this.links.verify(token); } catch { throw new Error("digital_access_denied"); }
    const grant = await this.prisma.digitalEntitlement.findFirst({ where: { id: claims.id, merchantId: claims.merchantId }, include: { order: true, payment: true } });
    if (!grant || grant.expiresAt.getTime() !== claims.exp || !await this.isAvailable(grant)) throw new Error("digital_access_denied");
    const updated = await this.prisma.digitalEntitlement.updateMany({ where: { id: grant.id, merchantId: grant.merchantId, status: "active", expiresAt: { gt: new Date() } },
      data: { downloadCount: { increment: 1 }, lastAccessAt: new Date() } });
    if (updated.count !== 1) throw new Error("digital_access_denied");
    return grant.downloadUrl;
  }

  async list(merchantId: string, externalOrderId: string) {
    const grants = await this.prisma.digitalEntitlement.findMany({ where: { merchantId, order: { merchantId, externalOrderId } }, include: { deliveries: true, order: true, payment: true } });
    return { products: await Promise.all(grants.map(async grant => ({ id: grant.id, name: grant.productName,
      status: grant.expiresAt.getTime() <= Date.now() ? "expired" : await this.isAvailable(grant) ? "active" : "revoked",
      expiresAt: grant.expiresAt, downloadCount: grant.downloadCount,
      deliveries: grant.deliveries.map(d => ({ id: d.id, channel: d.channel, status: d.status, reason: d.reason, sentAt: d.sentAt })) }))) };
  }

  async retryBlocked(merchantId: string, deliveryId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const changed = await tx.digitalDelivery.updateMany({ where: { id: deliveryId, merchantId, status: "blocked" }, data: { status: "pending", reason: null, claimedAt: null } });
      if (changed.count !== 1) throw new Error("digital_delivery_retry_not_allowed");
      const eventId = randomUUID();
      await tx.outboxMessage.create({ data: { eventId, merchantId, eventType: "digital.delivery.requested", status: "pending", schemaVersion: 1, producer: "notifications", correlationId: eventId, causationId: deliveryId, occurredAt: new Date(), payload: { merchantId, deliveryId } } });
    });
  }

  private async isAvailable(grant: DigitalEntitlement & { order: { status: string; externalOrderId: string }; payment: { status: string; amountCents: number; approvedAmountCents: number | null } }): Promise<boolean> {
    if (grant.status !== "active" || grant.expiresAt.getTime() <= Date.now() ||
        !["approved", "paid", "processing", "shipped", "delivered"].includes(grant.order.status) ||
        grant.payment.status !== "approved" || grant.payment.approvedAmountCents !== grant.payment.amountCents) return false;
    const refunded = await this.prisma.return.findFirst({ where: { merchantId: grant.merchantId, orderId: grant.order.externalOrderId,
      items: { some: { variantId: grant.variantId } }, refund: { is: { status: "COMPLETED" } } }, select: { id: true } });
    return !refunded;
  }
}
