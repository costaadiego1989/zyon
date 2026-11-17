/**
 * Prisma WhatsApp Session Repository
 */

import { Injectable, Inject, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { readStoredCheckoutCouponBinding } from "../../../checkout/domain/services/checkout-coupon-storage.js";
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
      if (existing?.status === "expired" && data.deviceId.startsWith("META_CLOUD:") && !data.checkoutSessionId && data.conversationState?.stage === "store") {
        const retained = await this.recoverableNativeCart(tx, existing);
        if (retained) {
          fresh.checkoutSessionId = retained.checkoutSessionId ?? null;
          fresh.conversationState = this.freshNativeState(retained);
        }
      }
      return existing
        ? tx.whatsAppSession.update({ where: { id: existing.id }, data: { ...fresh, postSaleContext: Prisma.DbNull } })
        : tx.whatsAppSession.create({ data: fresh });
    });
    return this.toDomain(row);
  }

  /** One renewal transaction preserves the cart, clears private state and rolls back on failed checks. */
  async renewExpiredNative(expected: WhatsAppSessionEntity): Promise<{ session: WhatsAppSessionEntity; renewed: boolean }> {
    if (!expected.deviceId.startsWith("META_CLOUD:")) throw new ServiceUnavailableException("whatsapp_recovery_scope_unavailable");
    const result = await this.prisma.$transaction(async tx => {
      const key = JSON.stringify(["whatsapp-session", expected.merchantId, expected.buyerPhone, expected.deviceId]);
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`);
      const current = await tx.whatsAppSession.findUnique({ where: { merchantId_buyerPhone_deviceId: {
        merchantId: expected.merchantId, buyerPhone: expected.buyerPhone, deviceId: expected.deviceId,
      } } });
      if (!current || current.id !== expected.id || current.status === "handoff") {
        throw new ServiceUnavailableException("whatsapp_recovery_scope_unavailable");
      }
      // Another worker may already have handled a newer message. Never replace its state.
      if (current.status === "active" && (current.lastActivityAt.getTime() !== expected.lastActivityAt.getTime()
        || Date.now() - current.lastActivityAt.getTime() <= 24 * 3600_000)) return { row: current, renewed: false };
      const retained = await this.recoverableNativeCart(tx, current);
      const row = await tx.whatsAppSession.update({ where: { id: current.id }, data: {
        status: "active", lastActivityAt: new Date(), checkoutSessionId: retained?.checkoutSessionId ?? null, currentOptions: "[]", previousOptions: "[]", currentPage: 0,
        postSaleContext: Prisma.DbNull, conversationState: this.freshNativeState(retained ?? { cartRef: randomUUID() }),
      } });
      return { row, renewed: true };
    });
    return { session: this.toDomain(result.row), renewed: result.renewed };
  }

  private freshNativeState(target: { cartRef: string; checkoutSessionId?: string; checkoutConversationId?: string }): Prisma.InputJsonObject {
    return { version: 1, conversationId: target.cartRef, stage: target.checkoutSessionId ? "checkout" : "store",
      ...(target.checkoutSessionId ? { checkoutSessionId: target.checkoutSessionId, checkoutConversationId: target.checkoutConversationId!, recoveredCheckout: true } : {}),
      history: [], revision: "", page: 0, previousViews: [] };
  }

  private async recoverableNativeCart(tx: Prisma.TransactionClient, row: {
    merchantId: string; buyerPhone: string; checkoutSessionId: string | null; conversationState: unknown;
  }): Promise<{ cartRef: string; checkoutSessionId?: string; checkoutConversationId?: string } | undefined> {
    const state = row.conversationState as { conversationId?: unknown; stage?: unknown } | null;
    const ref = state?.conversationId;
    if (typeof ref !== "string" || !ref || state?.stage === "completed") return undefined;
    try {
      const cart = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: row.merchantId, sessionId: ref } } });
      if (!cart || cart.expiresAt.getTime() <= Date.now() || !Array.isArray(cart.items) || cart.items.length === 0) return undefined;
      const related = await tx.checkoutSession.findMany({ where: { merchantId: row.merchantId, OR: [
        { sessionId: ref }, { conversationId: ref }, { cart: { path: ["cart_ref"], equals: ref } },
        ...(row.checkoutSessionId ? [{ sessionId: row.checkoutSessionId }] : []),
      ] }, select: { sessionId: true, conversationId: true, globalUserId: true, cart: true, customer: true } });
      if (row.checkoutSessionId && !related.some(x => x.sessionId === row.checkoutSessionId)) return undefined;
      if (related.length) {
        const scope = { merchantId: row.merchantId, sessionId: { in: related.map(x => x.sessionId) } };
        const [order, payment] = await Promise.all([
          tx.completedOrder.findFirst({ where: scope, select: { id: true } }),
          tx.paymentIntent.findFirst({ where: { ...scope, status: "approved" }, select: { id: true } }),
        ]);
        if (order || payment) return undefined;
      }
      const checkoutRows = related.filter(entry => (entry.cart as { cart_ref?: unknown } | null)?.cart_ref === ref);
      const checkout = row.checkoutSessionId ? related.find(entry => entry.sessionId === row.checkoutSessionId)
        : checkoutRows.length === 1 ? checkoutRows[0] : undefined;
      if (!row.checkoutSessionId && checkoutRows.length > 1) return undefined;
      if (checkout) {
        const customer = checkout.customer as { phone?: unknown; phone_verified?: unknown } | null;
        if ((checkout.cart as { cart_ref?: unknown } | null)?.cart_ref !== ref || customer?.phone_verified !== true
          || typeof customer.phone !== "string" || customer.phone.replace(/\D/g, "") !== row.buyerPhone.replace(/\D/g, "")) return undefined;
        const binding = readStoredCheckoutCouponBinding(checkout.cart);
        if (binding && (binding.merchantId !== row.merchantId || binding.cartId !== ref || binding.checkoutSessionId !== checkout.sessionId
          || binding.buyerId !== checkout.globalUserId || binding.state === "released")) return undefined;
        return { cartRef: ref, checkoutSessionId: checkout.sessionId, checkoutConversationId: checkout.conversationId };
      }
      return { cartRef: ref };
    } catch { throw new ServiceUnavailableException("whatsapp_recovery_cart_unavailable"); }
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
