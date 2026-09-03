import { BadRequestException, Inject, Injectable , Logger, Optional} from "@nestjs/common";
import { normalizeMerchantCryptoPayments } from "../../domain/services/merchant-crypto.validation.js";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository,
} from "../../domain/ports/merchant-rules.repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { extractPaymentMethods } from "../merchant.use-cases.js";

export interface EnableCryptoPaymentsInput {
  merchantId: string;
  enabled: boolean;
  chain: "polygon" | "base";
  network: "mainnet" | "testnet";
  treasuryAddress: string;
  token?: "USDC";
}

@Injectable()
export class EnableCryptoPaymentsUseCase {
  private readonly logger = new Logger(EnableCryptoPaymentsUseCase.name);

  constructor(
    @Inject(MERCHANT_RULES_REPOSITORY)
    private readonly rulesRepository: MerchantRulesRepository,
    @Optional() @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus?: DomainEventBus,
  ) {}

  async execute(input: EnableCryptoPaymentsInput): Promise<{ success: boolean }> {
    try {
      const cryptoPayments = normalizeMerchantCryptoPayments({
        enabled: input.enabled,
        chain: input.chain,
        network: input.network,
        treasuryAddress: input.treasuryAddress,
        token: input.token ?? "USDC",
        quoteTtlSeconds: 900,
      });
      const updated = await this.rulesRepository.updateRules(input.merchantId, { cryptoPayments });

      // Toggling crypto changes the buyer-facing payment methods list — reindex
      // the knowledge base so the agent tells buyers the right payment options.
      void this.eventBus?.publish({
        eventType: "merchant.config_updated",
        merchantId: input.merchantId,
        payload: {
          merchantId: input.merchantId,
          paymentMethods: extractPaymentMethods(updated),
          installments: undefined,
          deliveryRegions: undefined,
        },
      });

      return { success: true };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "crypto_payments_invalid");
    }
  }
}
