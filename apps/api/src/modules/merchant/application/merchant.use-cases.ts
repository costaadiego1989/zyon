import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../domain/ports/merchant-repository.port.js";
import type { MerchantProfile, MerchantRules } from "../domain/merchant.types.js";
import { normalizeMerchantCryptoPayments } from "../domain/services/merchant-crypto.validation.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";

@Injectable()
export class GetMerchantProfileUseCase {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repository: MerchantRepository) {}

  async execute(merchantId: string): Promise<MerchantProfile> {
    const profile = await this.repository.getProfile(merchantId);
    if (!profile) throw new NotFoundException("merchant_not_found");
    return profile;
  }
}

@Injectable()
export class GetMerchantRulesUseCase {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repository: MerchantRepository) {}

  execute(merchantId: string): Promise<MerchantRules> {
    return this.repository.getRules(merchantId);
  }
}

@Injectable()
export class UpdateMerchantRulesUseCase {
  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly repository: MerchantRepository,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
  ) {}

  async execute(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    const patch = { ...rules };

    // Domain-level bounds guard (belt-and-suspenders below DTO validation).
    if (patch.minimumMarginPercent !== undefined && patch.minimumMarginPercent < 5) {
      throw new BadRequestException("minimum_margin_percent_below_floor");
    }
    if (patch.maxDiscountPercent !== undefined && patch.maxDiscountPercent > 50) {
      throw new BadRequestException("max_discount_percent_exceeds_ceiling");
    }

    if (patch.cryptoPayments !== undefined) {
      try {
        patch.cryptoPayments = normalizeMerchantCryptoPayments(patch.cryptoPayments);
      } catch (error) {
        const message = error instanceof Error ? error.message : "crypto_config_invalid";
        throw new BadRequestException(message);
      }
    }
    const updated = await this.repository.updateRules(merchantId, patch);

    // Emit config-updated so the knowledge base re-indexes store config chunks.
    // Fire-and-forget: indexing failure must not block the rules update.
    void this.eventBus.publish({
      eventType: "merchant.config_updated",
      merchantId,
      payload: {
        merchantId,
        paymentMethods: extractPaymentMethods(updated),
        installments: undefined,
        deliveryRegions: undefined,
      },
    });

    return updated;
  }
}

function extractPaymentMethods(rules: MerchantRules): string[] {
  const methods: string[] = ["Cartão de crédito", "PIX", "Boleto"];
  const crypto = rules.cryptoPayments as { enabled?: boolean } | undefined;
  if (crypto?.enabled) methods.push("Crypto (USDC)");
  return methods;
}
