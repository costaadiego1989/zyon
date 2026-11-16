/**
 * Prisma WhatsApp Session Repository
 */

import { Injectable, Inject, ConflictException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { WhatsAppSessionRepository, WhatsAppSessionEntity, PostSaleContextData, WhatsAppRoutingCheckoutWriter } from "../../domain/ports/whatsapp-session-repository.port.js";
import { lockWhatsAppSessionIdentity } from "./prisma-whatsapp-handoff.repository.js";
import { createWhatsAppRoutingCheckoutWithin } from "./whatsapp-routing-checkout.js";
import { currentWhatsAppExecution, admitWhatsAppEffectInTransaction, admitWhatsAppDeliveryInTransaction, WhatsAppAiSuppressedError } from "../../../../shared/whatsapp/whatsapp-automation-context.js";

@Injectable()
export class PrismaWhatsAppSessionRepository implements WhatsAppSessionRepository {
  private transaction?: Prisma.TransactionClient;
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  private get client(): Prisma.TransactionClient { return this.transaction ?? this.prisma; }

  private async writeWithin<T>(id: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const frame = currentWhatsAppExecution();
    if (!frame) return work(this.client);
    if (id !== frame.authority.whatsappSessionId) throw new WhatsAppAiSuppressedError();
    const guarded = async (tx: Prisma.TransactionClient) => {
      await admitWhatsAppEffectInTransaction(tx, frame.authority.merchantId);
      return work(tx);
    };
    return this.transaction ? guarded(this.transaction) : this.prisma.$transaction(guarded);
  }

  async withRoutingLock<T>(identity: { merchantId: string; buyerPhone: string; deviceId: string }, work: (repository: WhatsAppSessionRepository, checkout: WhatsAppRoutingCheckoutWriter) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await lockWhatsAppSessionIdentity(tx, identity);
      await admitWhatsAppDeliveryInTransaction(tx, identity.merchantId);
      const repository = new PrismaWhatsAppSessionRepository(this.prisma);
      repository.transaction = tx;
      return work(repository, input => {
        if (input.merchantId !== identity.merchantId) throw new ConflictException("whatsapp_routing_checkout_scope_mismatch");
        return createWhatsAppRoutingCheckoutWithin(tx, input);
      });
    });
  }

  async findActiveByPhone(merchantId: string, buyerPhone: string, deviceId?: string): Promise<WhatsAppSessionEntity | null> {
    const row = await this.client.whatsAppSession.findFirst({
      where: { merchantId, buyerPhone, ...(deviceId ? { deviceId } : {}),
        ...(this.transaction ? { OR: [{ status: "active" }, { handoffBinding: { mode: { in: ["waiting_human", "human"] } } }] } : { status: "active" }) },
      orderBy: { lastActivityAt: "desc" },
      include: { handoffBinding: { select: { mode: true } } },
    });
    if (row && this.transaction && row.handoffBinding && row.handoffBinding.mode !== "ai" && !currentWhatsAppExecution()) {
      // A customer-service window is not a new commerce conversation.
      const retained = await this.client.whatsAppSession.update({ where: { id: row.id }, data: { status: "active", lastActivityAt: new Date() } });
      return this.toDomain(retained);
    }
    return row ? this.toDomain(row) : null;
  }

  async create(data: Omit<WhatsAppSessionEntity, "id" | "createdAt">): Promise<WhatsAppSessionEntity> {
    const write = async (tx: Prisma.TransactionClient) => {
      await admitWhatsAppEffectInTransaction(tx, data.merchantId);
      // The unique key includes expired rows. Serialize renewal on that same
      // key so retries and concurrent first messages cannot create duplicates
      // or overwrite a conversation that another worker has already renewed.
      await lockWhatsAppSessionIdentity(tx, data);
      const existing = await tx.whatsAppSession.findUnique({ where: {
        merchantId_buyerPhone_deviceId: { merchantId: data.merchantId, buyerPhone: data.buyerPhone, deviceId: data.deviceId },
      } });
      const binding = existing ? await tx.whatsAppHandoffBinding.findFirst({ where: { merchantId: data.merchantId, whatsappSessionId: existing.id } }) : null;
      if (existing && binding && binding.mode !== "ai") {
        return tx.whatsAppSession.update({ where: { id: existing.id }, data: { status: "active", lastActivityAt: data.lastActivityAt } });
      }
      if (existing?.status === "active") return existing;
      const fresh = {
        merchantId: data.merchantId,
        buyerPhone: data.buyerPhone,
        buyerAlias: data.buyerAlias ?? null,
        checkoutSessionId: data.checkoutSessionId ?? null,
        deviceId: data.deviceId,
        currentOptions: JSON.stringify(data.currentOptions),
        previousOptions: JSON.stringify(data.previousOptions),
        currentPage: data.currentPage,
        lastActivityAt: data.lastActivityAt,
        status: data.status,
        conversationState: data.conversationState ? JSON.parse(JSON.stringify(data.conversationState)) as Prisma.InputJsonValue : Prisma.DbNull,
      };
      const renewed = existing
        ? await tx.whatsAppSession.update({ where: { id: existing.id }, data: { ...fresh, postSaleContext: Prisma.DbNull } })
        : await tx.whatsAppSession.create({ data: fresh });
      if (binding) {
        if (binding.epoch === 2_147_483_647) throw new ConflictException("handoff_epoch_exhausted");
        const state = data.conversationState;
        await tx.whatsAppHandoffBinding.update({ where: { id: binding.id }, data: {
          epoch: binding.epoch + 1, conversationId: state?.conversationId ?? data.checkoutSessionId ?? null,
        } });
      }
      return renewed;
    };
    const row = this.transaction ? await write(this.transaction) : await this.prisma.$transaction(write);
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<WhatsAppSessionEntity>): Promise<WhatsAppSessionEntity> {
    const updateData: Record<string, unknown> = {};
    if (data.lastActivityAt) updateData.lastActivityAt = data.lastActivityAt;
    if (data.status) updateData.status = data.status;
    if (data.checkoutSessionId) updateData.checkoutSessionId = data.checkoutSessionId;
    if (data.buyerAlias !== undefined) updateData.buyerAlias = data.buyerAlias;
    if (data.conversationState !== undefined) updateData.conversationState = data.conversationState;

    const row = await this.writeWithin(id, tx => tx.whatsAppSession.update({
      where: { id },
      data: updateData,
    }));
    return this.toDomain(row);
  }

  async expire(id: string): Promise<void> {
    await this.writeWithin(id, tx => tx.whatsAppSession.update({
      where: { id },
      data: { status: "expired" },
    }));
  }

  async updateMenuState(id: string, currentOptions: string[], previousOptions: string[], page: number): Promise<void> {
    await this.writeWithin(id, tx => tx.whatsAppSession.update({
      where: { id },
      data: {
        currentOptions: JSON.stringify(currentOptions),
        previousOptions: JSON.stringify(previousOptions),
        currentPage: page,
      },
    }));
  }

  async setPostSaleContext(id: string, context: PostSaleContextData): Promise<void> {
    await this.writeWithin(id, tx => tx.whatsAppSession.update({
      where: { id },
      data: {
        postSaleContext: { ...context },
      },
    }));
  }

  async clearPostSaleContext(id: string): Promise<void> {
    await this.writeWithin(id, tx => tx.whatsAppSession.update({
      where: { id },
      data: {
        postSaleContext: Prisma.DbNull,
      },
    }));
  }

  private toDomain(row: any): WhatsAppSessionEntity {
    const postSaleContext = row.postSaleContext && typeof row.postSaleContext === "object" ? row.postSaleContext : undefined;
    return {
      id: row.id,
      merchantId: row.merchantId,
      buyerPhone: row.buyerPhone,
      buyerAlias: row.buyerAlias ?? undefined,
      checkoutSessionId: row.checkoutSessionId ?? undefined,
      deviceId: row.deviceId,
      currentOptions: typeof row.currentOptions === "string" ? JSON.parse(row.currentOptions) : (row.currentOptions ?? []),
      previousOptions: typeof row.previousOptions === "string" ? JSON.parse(row.previousOptions) : (row.previousOptions ?? []),
      currentPage: row.currentPage ?? 0,
      lastActivityAt: new Date(row.lastActivityAt),
      status: row.status,
      postSaleContext,
      conversationState: row.conversationState ?? undefined,
      createdAt: new Date(row.createdAt),
    };
  }
}
