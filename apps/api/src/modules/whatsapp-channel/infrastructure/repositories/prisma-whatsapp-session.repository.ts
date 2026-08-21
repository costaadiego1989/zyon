/**
 * Prisma WhatsApp Session Repository
 */

import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { WhatsAppSessionRepository, WhatsAppSessionEntity } from "../../domain/ports/whatsapp-session-repository.port.js";

@Injectable()
export class PrismaWhatsAppSessionRepository implements WhatsAppSessionRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findActiveByPhone(merchantId: string, buyerPhone: string): Promise<WhatsAppSessionEntity | null> {
    const row = await (this.prisma as any).whatsAppSession?.findFirst({
      where: { merchantId, buyerPhone, status: "active" },
      orderBy: { lastActivityAt: "desc" },
    });
    return row ? this.toDomain(row) : null;
  }

  async create(data: Omit<WhatsAppSessionEntity, "id" | "createdAt">): Promise<WhatsAppSessionEntity> {
    const row = await (this.prisma as any).whatsAppSession.create({
      data: {
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
      },
    });
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<WhatsAppSessionEntity>): Promise<WhatsAppSessionEntity> {
    const updateData: Record<string, unknown> = {};
    if (data.lastActivityAt) updateData.lastActivityAt = data.lastActivityAt;
    if (data.status) updateData.status = data.status;
    if (data.checkoutSessionId) updateData.checkoutSessionId = data.checkoutSessionId;
    if (data.buyerAlias !== undefined) updateData.buyerAlias = data.buyerAlias;

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

  private toDomain(row: any): WhatsAppSessionEntity {
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
      createdAt: new Date(row.createdAt),
    };
  }
}
