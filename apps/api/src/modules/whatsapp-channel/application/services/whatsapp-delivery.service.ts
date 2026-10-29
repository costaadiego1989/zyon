import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";
import type { WhatsAppInboxClaim } from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import type { SendResponseInput } from "../use-cases/send-whatsapp-response.use-case.js";

export class WhatsAppDeliveryUncertainError extends Error {
  constructor() { super("whatsapp_delivery_requires_reconciliation"); }
}

@Injectable()
export class WhatsAppDeliveryService {
  private readonly context = new AsyncLocalStorage<{ claim: WhatsAppInboxClaim; captured: boolean }>();
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(WHATSAPP_SENDER_PORT) private readonly sender: WhatsAppSenderPort,
  ) {}

  async capture(input: SendResponseInput): Promise<boolean> {
    const context = this.context.getStore();
    if (!context) return false;
    if (context.captured || context.claim.merchantId !== input.merchantId || context.claim.deviceId !== input.deviceId) throw new Error("whatsapp_response_scope_mismatch");
    const updated = await this.prisma.whatsAppDelivery.updateMany({
      where: { id: context.claim.id, merchantId: input.merchantId, state: "processing", processingToken: context.claim.leaseToken },
      data: { response: input as unknown as Prisma.InputJsonValue },
    });
    if (updated.count !== 1) throw new WhatsAppDeliveryUncertainError();
    context.captured = true;
    return true;
  }

  async process(claim: WhatsAppInboxClaim, run: () => Promise<void>, ownsLease: () => Promise<boolean>) {
    let row = await this.prisma.whatsAppDelivery.findUnique({ where: { id: claim.id } });
    if (!row) {
      try {
        row = await this.prisma.whatsAppDelivery.create({ data: {
          id: claim.id, merchantId: claim.merchantId, configId: claim.configId,
          deviceId: claim.deviceId, state: "processing", processingToken: claim.leaseToken,
        } });
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        throw new WhatsAppDeliveryUncertainError();
      }
      const context = { claim, captured: false };
      try {
        if (!await ownsLease()) throw new WhatsAppDeliveryUncertainError();
        await this.context.run(context, run);
        if (!context.captured) throw new Error("whatsapp_response_missing");
        const updated = await this.prisma.whatsAppDelivery.updateMany({
          where: { id: claim.id, state: "processing", processingToken: claim.leaseToken }, data: { state: "ready" },
        });
        if (updated.count !== 1) throw new WhatsAppDeliveryUncertainError();
      } catch {
        await this.prisma.whatsAppDelivery.updateMany({ where: { id: claim.id, state: "processing" }, data: { state: "processing_unknown" } });
        throw new WhatsAppDeliveryUncertainError();
      }
      row = await this.prisma.whatsAppDelivery.findUniqueOrThrow({ where: { id: claim.id } });
    }
    if (row.merchantId !== claim.merchantId || row.configId !== claim.configId) throw new Error("whatsapp_delivery_scope_mismatch");
    if (row.state === "sent") return;
    if (row.state !== "ready") {
      await this.prisma.whatsAppDelivery.updateMany({ where: { id: claim.id, state: { in: ["processing", "sending"] } }, data: { state: row.state === "sending" ? "submission_unknown" : "processing_unknown" } });
      throw new WhatsAppDeliveryUncertainError();
    }
    if (!await ownsLease()) throw new WhatsAppDeliveryUncertainError();
    const sending = await this.prisma.whatsAppDelivery.updateMany({ where: { id: claim.id, state: "ready" }, data: { state: "sending" } });
    if (sending.count !== 1) throw new WhatsAppDeliveryUncertainError();
    const response = row.response as unknown as SendResponseInput;
    let result;
    try {
      result = await this.sender.sendText({ ...response, correlationId: row.id });
    } catch {
      result = { status: "unknown" as const, messageId: "" };
    }
    if ((result.status === "sent" || result.status === "queued") && result.messageId) {
      await this.prisma.whatsAppDelivery.update({ where: { id: row.id }, data: { state: "sent", providerMessageId: result.messageId } });
      return;
    }
    if (result.status === "failed") {
      await this.prisma.whatsAppDelivery.updateMany({ where: { id: row.id, state: "sending" }, data: { state: "ready" } });
      throw new Error("whatsapp_send_rejected");
    }
    await this.prisma.whatsAppDelivery.updateMany({ where: { id: row.id, state: "sending" }, data: { state: "submission_unknown" } });
    if ((await this.prisma.whatsAppDelivery.findUniqueOrThrow({ where: { id: row.id } })).state === "sent") return;
    throw new WhatsAppDeliveryUncertainError();
  }

  // Called only after the provider webhook's signature and account have been verified.
  async reconcileMeta(merchantId: string, configId: string, input: { id?: string; status?: string; biz_opaque_callback_data?: string }) {
    if (!input.id || !["sent", "delivered", "read"].includes(input.status ?? "")) return;
    const correlationId = input.biz_opaque_callback_data;
    await this.prisma.$transaction(async tx => {
      const row = await tx.whatsAppDelivery.findFirst({ where: {
        merchantId, configId,
        ...(correlationId ? { id: correlationId } : { providerMessageId: input.id }),
      } });
      if (!row || !["sending", "submission_unknown", "sent"].includes(row.state)) return;
      if (row.providerMessageId && row.providerMessageId !== input.id) return;
      await tx.whatsAppDelivery.update({ where: { id: row.id }, data: { state: "sent", providerMessageId: input.id } });
      await tx.whatsAppWebhookInbox.updateMany({ where: { id: row.id, merchantId, status: { in: ["blocked", "pending", "dead"] } }, data: { status: "processed", processedAt: new Date(), lastError: null, leaseToken: null, leaseExpiresAt: null } });
    });
  }

  listIssues(merchantId: string) {
    return this.prisma.whatsAppDelivery.findMany({
      where: { merchantId, state: { in: ["processing_unknown", "submission_unknown"] } },
      select: { id: true, state: true, updatedAt: true, providerMessageId: true },
      orderBy: { updatedAt: "desc" }, take: 50,
    });
  }
}
