import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import type { OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY } from "../../domain/ports/own-delivery-config.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";

@Injectable()
export class GetDeliveryConfigUseCase {
  constructor(
    @Inject(OWN_DELIVERY_CONFIG_REPOSITORY) private readonly ownDeliveryRepo: OwnDeliveryConfigRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo: MerchantRepository
  ) {}

  async execute(input: { merchantId: string }) {
    if (!this.merchantRepo.getById) {
      throw new Error("getById not available on this repository implementation");
    }
    const merchant = await this.merchantRepo.getById(input.merchantId);
    if (!merchant) {
      throw new NotFoundException(`Merchant not found: ${input.merchantId}`);
    }

    const ownDelivery = await this.ownDeliveryRepo.getByMerchantId(input.merchantId);

    return {
      melhorEnvioEnabled: merchant.melhorEnvioEnabled ?? true,
      melhorEnvioConnected: !!(merchant.melhorEnvioAccessToken && merchant.melhorEnvioRefreshToken),
      ownDelivery: ownDelivery || {
        enabled: false,
        mode: "flat" as const,
        flatPriceCents: null,
        freeAboveCents: null,
        neighborhoods: null,
        estimatedDays: 3
      }
    };
  }
}
