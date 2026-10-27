import type { BuyerAddress } from "../entities/buyer-address.entity.js";
import type { BuyerConversation } from "../ports/buyer-conversation.port.js";

export interface BuyerDataExportInput {
  profile: {
    globalUserId: string;
    email: string;
    displayName: string;
    phone?: string;
    cpf?: string;
    createdAt: Date;
  };
  addresses: BuyerAddress[];
  agentProfile?: {
    globalUserId: string;
    name: string;
    personality: string;
    maxRounds: number;
    targetDiscountPercent: number;
    minimumAcceptableDiscountPercent: number;
    m2mEnabled: boolean;
  };
  conversations: BuyerConversation[];
  purchases: Array<{
    merchantId: string;
    orderId: string;
    totalAmount: number;
    currency: string;
    completedAt: Date;
    items: unknown;
  }>;
}

export interface BuyerDataExportPayload {
  schemaVersion: "1.0";
  generatedAt: Date;
  generatedFor: { globalUserId: string };
  sections: {
    profile: {
      email: string;
      displayName: string;
      phone: string | null;
      cpf: string | null;
      createdAt: string;
    };
    addresses: Array<{
      id: string;
      zip: string;
      zipFormatted: string;
      street: string;
      number: string;
      complement: string | null;
      neighborhood: string;
      city: string;
      state: string;
      isDefault: boolean;
      createdAt: string;
    }>;
    agentProfile?: {
      name: string;
      personality: string;
      maxRounds: number;
      targetDiscountPercent: number;
      minimumAcceptableDiscountPercent: number;
      m2mEnabled: boolean;
    };
    conversations: Array<{
      id: string;
      sessionId: string;
      merchantId: string;
      startedAt: string;
      lastMessageAt: string;
      messages: Array<{
        id: string;
        role: string;
        content: string;
        createdAt: string;
        rating: "up" | "down" | null;
      }>;
    }>;
    purchases: Array<{
      merchantId: string;
      orderId: string;
      totalAmount: number;
      currency: string;
      completedAt: string;
      items: unknown;
    }>;
  };
}

/**
 * LGPD Art. 18 V/VIII: subject access. Builds a deterministic, machine-readable
 * JSON payload containing all personal data we hold for the buyer. Sensitive
 * credentials (password hash, OTP hashes, session tokens) are NEVER included.
 */
export function buildBuyerDataExport(input: BuyerDataExportInput): BuyerDataExportPayload {
  return {
    schemaVersion: "1.0",
    generatedAt: new Date(),
    generatedFor: { globalUserId: input.profile.globalUserId },
    sections: {
      profile: {
        email: input.profile.email.trim().toLowerCase(),
        displayName: input.profile.displayName.trim(),
        phone: input.profile.phone ?? null,
        cpf: input.profile.cpf ?? null,
        createdAt: input.profile.createdAt.toISOString(),
      },
      addresses: input.addresses.map((a) => ({
        id: a.id,
        zip: a.zip,
        zipFormatted: a.zipFormatted,
        street: a.street,
        number: a.number,
        complement: a.complement ?? null,
        neighborhood: a.neighborhood,
        city: a.city,
        state: a.state,
        isDefault: a.isDefault,
        createdAt: a.createdAt.toISOString(),
      })),
      agentProfile: input.agentProfile
        ? {
            name: input.agentProfile.name,
            personality: input.agentProfile.personality,
            maxRounds: input.agentProfile.maxRounds,
            targetDiscountPercent: input.agentProfile.targetDiscountPercent,
            minimumAcceptableDiscountPercent: input.agentProfile.minimumAcceptableDiscountPercent,
            m2mEnabled: input.agentProfile.m2mEnabled,
          }
        : undefined,
      conversations: input.conversations.map((c) => ({
        id: c.id,
        sessionId: c.sessionId,
        merchantId: c.merchantId,
        startedAt: c.startedAt.toISOString(),
        lastMessageAt: c.lastMessageAt.toISOString(),
        messages: c.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
          rating: m.rating,
        })),
      })),
      purchases: input.purchases.map((p) => ({
        merchantId: p.merchantId,
        orderId: p.orderId,
        totalAmount: p.totalAmount,
        currency: p.currency,
        completedAt: p.completedAt.toISOString(),
        items: p.items,
      })),
    },
  };
}
