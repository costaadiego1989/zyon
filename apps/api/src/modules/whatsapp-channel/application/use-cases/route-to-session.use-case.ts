/**
 * Route incoming WhatsApp message to the correct checkout session.
 *
 * Key behavior:
 * - WhatsApp phone = buyer identity (auto-register if new)
 * - Phone verified by default (it's WhatsApp — no OTP needed)
 * - Returning buyers get pre-filled data (skip already-known fields)
 * - Creates checkout session if none active
 * - 24h inactivity = session expired
 */

import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  WHATSAPP_SESSION_REPOSITORY,
  type WhatsAppSessionRepository,
  type WhatsAppSessionEntity,
} from "../../domain/ports/whatsapp-session-repository.port.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { createHash } from "node:crypto";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface RouteResult {
  whatsappSession: WhatsAppSessionEntity;
  checkoutSessionId: string;
  isNew: boolean;
  buyerData: {
    globalUserId: string;
    phone: string;
    phoneVerified: true;
    fullName?: string;
    email?: string;
    cpf?: string;
    address?: Record<string, string>;
  };
}

@Injectable()
export class RouteToSessionUseCase {
  private readonly logger = new Logger(RouteToSessionUseCase.name);

  constructor(
    @Inject(WHATSAPP_SESSION_REPOSITORY)
    private readonly sessionRepo: WhatsAppSessionRepository,
    @Inject(PRISMA_CLIENT)
    private readonly prisma: PrismaClient,
  ) {}

  async execute(input: {
    merchantId: string;
    deviceId: string;
    fromNumber: string;
    fromAlias?: string;
  }): Promise<RouteResult> {
    const phone = this.normalizePhone(input.fromNumber);
    const globalUserId = this.phoneToGlobalUserId(phone);

    // 1. Auto-register buyer if not exists
    const buyerData = await this.ensureBuyerExists(input.merchantId, phone, globalUserId, input.fromAlias);

    // 2. Find active WA session
    let waSession = await this.sessionRepo.findActiveByPhone(input.merchantId, phone);

    // 3. Check expiry (24h)
    if (waSession && this.isExpired(waSession)) {
      await this.sessionRepo.expire(waSession.id);
      waSession = null;
    }

    // 4. Create new session if needed
    if (!waSession) {
      const checkoutSessionId = await this.createCheckoutSession(input.merchantId, globalUserId, buyerData);

      waSession = await this.sessionRepo.create({
        merchantId: input.merchantId,
        buyerPhone: phone,
        buyerAlias: input.fromAlias,
        checkoutSessionId,
        deviceId: input.deviceId,
        currentOptions: [],
        previousOptions: [],
        currentPage: 0,
        lastActivityAt: new Date(),
        status: "active",
      });

      this.logger.log(`whatsapp_session_created merchant=${input.merchantId}`);

      return { whatsappSession: waSession, checkoutSessionId, isNew: true, buyerData };
    }

    // 5. Update activity
    await this.sessionRepo.update(waSession.id, { lastActivityAt: new Date() });

    return {
      whatsappSession: waSession,
      checkoutSessionId: waSession.checkoutSessionId!,
      isNew: false,
      buyerData,
    };
  }

  /**
   * Ensure buyer identity exists. WhatsApp phone = identity.
   * On first contact: creates BuyerIdentity with phone as key.
   * On returning: hydrates known fields from last checkout session.
   */
  private async ensureBuyerExists(
    merchantId: string,
    phone: string,
    globalUserId: string,
    alias?: string,
  ): Promise<RouteResult["buyerData"]> {
    // Check if buyer identity exists for this phone
    const identityKey = `phone:${phone}`;
    const existingIdentity = await this.prisma.buyerIdentity.findUnique({
      where: { merchantId_identityKey: { merchantId, identityKey } },
    });

    if (existingIdentity) {
      // Returning buyer — hydrate from last checkout session
      const lastSession = await this.prisma.checkoutSession.findFirst({
        where: { merchantId, globalUserId: existingIdentity.globalUserId },
        orderBy: { updatedAt: "desc" },
      });

      const customer = (lastSession?.customer as any) ?? {};

      this.logger.debug(`whatsapp_buyer_found merchant=${merchantId}`);
      return {
        globalUserId: existingIdentity.globalUserId,
        phone,
        phoneVerified: true,
        fullName: customer.fullName ?? alias ?? undefined,
        email: customer.email ?? undefined,
        cpf: customer.cpf ?? undefined,
        address: customer.address ?? undefined,
      };
    }

    // New buyer — create BuyerIdentity with phone as key
    const newIdentity = await this.prisma.buyerIdentity.create({
      data: {
        merchantId,
        identityKey,
        globalUserId,
      },
    });

    this.logger.log(`whatsapp_buyer_created merchant=${merchantId}`);
    return {
      globalUserId: newIdentity?.globalUserId ?? globalUserId,
      phone,
      phoneVerified: true,
      fullName: alias ?? undefined,
    };
  }

  /**
   * Create a checkout session for this WA buyer.
   * Pre-fills known buyer data so data_collection stage skips those fields.
   */
  private async createCheckoutSession(
    merchantId: string,
    globalUserId: string,
    buyerData: RouteResult["buyerData"],
  ): Promise<string> {
    const sessionId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const now = new Date();

    await this.prisma.checkoutSession.create({
      data: {
        merchantId,
        sessionId,
        globalUserId,
        conversationId,
        customer: {
          phone: buyerData.phone,
          phone_verified: true,
          fullName: buyerData.fullName ?? null,
          email: buyerData.email ?? null,
          cpf: buyerData.cpf ?? null,
          address: buyerData.address ?? null,
        },
        cart: { items: [], total: 0, currency: "BRL" },
        chatHistory: [],
        abandonmentScore: 0,
        triggerAgent: false,
        createdAt: now,
        updatedAt: now,
      },
    });

    return sessionId;
  }

  private normalizePhone(phone: string): string {
    // Remove non-digits, ensure country code
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
  }

  private phoneToGlobalUserId(phone: string): string {
    return createHash("sha256").update(`wa:${phone}`).digest("hex").slice(0, 24);
  }

  private isExpired(session: WhatsAppSessionEntity): boolean {
    return Date.now() - session.lastActivityAt.getTime() > SESSION_TTL_MS;
  }
}
