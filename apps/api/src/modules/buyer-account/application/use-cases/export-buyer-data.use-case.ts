import { Inject, Injectable } from "@nestjs/common";
import {
  BUYER_ADDRESS_REPOSITORY,
  type BuyerAddressRepository,
} from "../../domain/ports/buyer-address.port.js";
import {
  BUYER_CONVERSATION_REPOSITORY,
  type BuyerConversationRepository,
} from "../../domain/ports/buyer-conversation.port.js";
import { BUYER_ACCOUNT_PORT, type BuyerAccountPort } from "../../domain/ports/buyer-account-port.js";
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
    @Inject(BUYER_ACCOUNT_PORT) private readonly port: BuyerAccountPort,
    @Inject(BUYER_ADDRESS_REPOSITORY) private readonly addresses: BuyerAddressRepository,
    @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversations: BuyerConversationRepository,
  ) {}

  async execute(input: { globalUserId: string }): Promise<BuyerDataExportPayload> {
    if (!input.globalUserId) throw new Error("buyer_account_missing_global_user_id");

    const account = await this.port.findAccountForExport(input.globalUserId);
    if (!account) throw new Error("buyer_account_not_found");

    const [addresses, conversations, agentProfile, purchases] = await Promise.all([
      this.addresses.list(input.globalUserId),
      this.conversations.listByBuyer(input.globalUserId),
      this.port.findAgentForExport(input.globalUserId),
      this.port.listPurchasesForExport(input.globalUserId),
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
      agentProfile: agentProfile ? { globalUserId: input.globalUserId, ...agentProfile } : undefined,
      conversations,
      purchases,
    });
  }
}