/**
 * Prisma WhatsApp Session Repository
 */

import { Injectable, Inject } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { WhatsAppSessionRepository, WhatsAppSessionEntity, PostSaleContextData } from "../../domain/ports/whatsapp-session-repository.port.js";

@Injectable()
export class PrismaWhatsAppSessionRepository implements WhatsAppSessionRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findActiveByPhone(merchantId: string, buyerPhone: string, deviceId?: string): Promise<WhatsAppSessionEntity | null> {
    const row = await (this.prisma as any).whatsAppSession?.findFirst({
      where: { merchantId, buyerPhone, ...(deviceId ? { deviceId } : {}), status: "active" },
      orderBy: { lastActivityAt: "desc" },
    });
    return row ? this.toDomain(row) : null;
  }

  async create(data: Omit<WhatsAppSessionEntity, "id" | "createdAt">): Promise<WhatsAppSessionEntity> {
    const row = await this.prisma.$transaction(async tx => {
      // The unique key includes expired rows. Serialize renewal on that same
      // key so retries and concurrent first messages cannot create duplicates
      // or overwrite a conversation that another worker has already renewed.
      const key = JSON.stringify(["whatsapp-session", data.merchantId, data.buyerPhone, data.deviceId]);
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`);
      const existing = await tx.whatsAppSession.findUnique({ where: {
        merchantId_buyerPhone_deviceId: { merchantId: data.merchantId, buyerPhone: data.buyerPhone, deviceId: data.deviceId },
      } });
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
      return existing
        ? tx.whatsAppSession.update({ where: { id: existing.id }, data: { ...fresh, postSaleContext: Prisma.DbNull } })
        : tx.whatsAppSession.create({ data: fresh });
    });
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<WhatsAppSessionEntity>): Promise<WhatsAppSessionEntity> {
    const updateData: Record<string, unknown> = {};
    if (data.lastActivityAt) updateData.lastActivityAt = data.lastActivityAt;
    if (data.status) updateData.status = data.status;
    if (data.checkoutSessionId) updateData.checkoutSessionId = data.checkoutSessionId;
    if (data.buyerAlias !== undefined) updateData.buyerAlias = data.buyerAlias;
    if (data.conversationState !== undefined) updateData.conversationState = data.conversationState;

    const row = await (this.prisma as any).whatsAppSession.update({
      where: { id },
      data: updateData,
    });
    return this.toDomain(row);
  }

  async expire(id: string): Promise<void> {
    await (this.prisma as any).whatsAppSession.update({
      where: { id },
      data: { status: "expired" },
    });
  }

  async updateMenuState(id: string, currentOptions: string[], previousOptions: string[], page: number): Promise<void> {
    await (this.prisma as any).whatsAppSession.update({
      where: { id },
      data: {
        currentOptions: JSON.stringify(currentOptions),
        previousOptions: JSON.stringify(previousOptions),
        currentPage: page,
      },
    });
  }

  async setPostSaleContext(id: string, context: PostSaleContextData): Promise<void> {
    await (this.prisma as any).whatsAppSession.update({
      where: { id },
      data: {
        postSaleContext: context,
      },
    });
  }

  async clearPostSaleContext(id: string): Promise<void> {
    await (this.prisma as any).whatsAppSession.update({
      where: { id },
      data: {
        postSaleContext: null,
      },
    });
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
