import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../domain/ports/merchant-repository.port.js";
import type { MerchantProfile, MerchantRules } from "../domain/merchant.types.js";
import { normalizeMerchantCryptoPayments } from "../domain/services/merchant-crypto.validation.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { type TenantPrincipal, type TenantRole } from "../../../shared/auth/tenant-principal.js";

export interface MerchantProfileWithActor extends MerchantProfile {
  role: TenantRole;
  userId: string;
}

@Injectable()
export class GetMerchantProfileUseCase {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repository: MerchantRepository) {}

  async execute(merchantId: string, principal: TenantPrincipal): Promise<MerchantProfileWithActor> {
    if (principal.kind !== "human") {
      throw new BadRequestException("human_principal_required");
    }
    const profile = await this.repository.getProfile(merchantId);
    if (!profile) throw new NotFoundException("merchant_not_found");
    const slug = profile.storeSettings?.slug?.trim() || slugifyStoreName(profile.name);
    return {
      ...profile,
      slug,
      role: principal.role,
      userId: principal.userId,
    };
  }
}

function slugifyStoreName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
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

export function extractPaymentMethods(rules: MerchantRules): string[] {
  const methods: string[] = ["PIX", "Cartão de crédito", "Cartão de débito"];
  const crypto = rules.cryptoPayments as { enabled?: boolean } | undefined;
  if (crypto?.enabled) methods.push("Crypto (USDC)");
  return methods;
}
