import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";
import {
  BUYER_ADDRESS_REPOSITORY,
  type BuyerAddressRepository,
} from "../../domain/ports/buyer-address.port.js";
import {
  BUYER_CONVERSATION_REPOSITORY,
  type BuyerConversationRepository,
} from "../../domain/ports/buyer-conversation.port.js";
import {
  buildBuyerDataExport,
  type BuyerDataExportPayload,
} from "../../domain/services/build-buyer-data-export.service.js";

/**
 * LGPD Art. 18 V: data portability / subject access. Pulls every PII record
 * the platform holds for the buyer and emits a single, deterministic JSON
 * payload. No secrets (passwords, OTP hashes, session tokens) are included.
 */
@Injectable()
export class ExportBuyerDataUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(BUYER_ADDRESS_REPOSITORY) private readonly addresses: BuyerAddressRepository,
    @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversations: BuyerConversationRepository
  ) {}

  async execute(input: { globalUserId: string }): Promise<BuyerDataExportPayload> {
    if (!input.globalUserId) throw new Error("buyer_account_missing_global_user_id");

    const account = await (this.prisma.buyerAccount as unknown as {
      findUnique: (args: {
        where: { globalUserId: string };
        select: Record<string, true>;
      }) => Promise<{
        globalUserId: string;
        email: string;
        displayName: string;
        phone: string | null;
        cpf: string | null;
        createdAt: Date;
      } | null>;
    }).findUnique({
      where: { globalUserId: input.globalUserId },
      select: {
        globalUserId: true,
        email: true,
        displayName: true,
        phone: true,
        cpf: true,
        createdAt: true,
      },
    });
    if (!account) throw new Error("buyer_account_not_found");

    const [addresses, conversations, agentProfile, purchases] = await Promise.all([
      this.addresses.list(input.globalUserId),
      this.conversations.listByBuyer(input.globalUserId),
      (this.prisma.buyerAgentProfile as unknown as {
        findUnique: (args: {
          where: { globalUserId: string };
          select: Record<string, true>;
        }) => Promise<{
          name: string;
          personality: string;
          maxRounds: number;
          targetDiscountPercent: number;
          minimumAcceptableDiscountPercent: number;
          m2mEnabled: boolean;
        } | null>;
      }).findUnique({
        where: { globalUserId: input.globalUserId },
        select: {
          name: true,
          personality: true,
          maxRounds: true,
          targetDiscountPercent: true,
          minimumAcceptableDiscountPercent: true,
          m2mEnabled: true,
        },
      }),
      (this.prisma.buyerPurchaseRecord as unknown as {
        findMany: (args: {
          where: { globalUserId: string };
          select: Record<string, true>;
          orderBy: Record<string, "desc">;
        }) => Promise<
          Array<{
            merchantId: string;
            orderId: string;
            totalAmount: number;
            currency: string;
            completedAt: Date;
            items: unknown;
          }>
        >;
      }).findMany({
        where: { globalUserId: input.globalUserId },
        select: {
          merchantId: true,
          orderId: true,
          totalAmount: true,
          currency: true,
          completedAt: true,
          items: true,
        },
        orderBy: { completedAt: "desc" },
      }),
    ]);

    return buildBuyerDataExport({
      profile: {
        globalUserId: account.globalUserId,
        email: account.email,
        displayName: account.displayName,
        phone: account.phone ?? undefined,
        cpf: account.cpf ?? undefined,
        createdAt: account.createdAt,
      },
      addresses,
      agentProfile: agentProfile ?? undefined,
      conversations,
      purchases,
    });
  }
}