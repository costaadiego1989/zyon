import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import type { OwnDeliveryNeighborhood, OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY } from "../../domain/ports/own-delivery-config.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";

export interface UpdateDeliveryConfigInput {
  merchantId: string;
  melhorEnvioEnabled?: boolean;
  ownDelivery?: {
    enabled: boolean;
    mode: "flat" | "neighborhood";
    flatPriceCents?: number | null;
    freeAboveCents?: number | null;
    neighborhoods?: OwnDeliveryNeighborhood[] | null;
    estimatedValue?: number;
    estimatedUnit?: "minutes" | "days";
  };
}

@Injectable()
export class UpdateDeliveryConfigUseCase {
  constructor(
    @Inject(OWN_DELIVERY_CONFIG_REPOSITORY) private readonly ownDeliveryRepo: OwnDeliveryConfigRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo: MerchantRepository
  ) {}

  async execute(input: UpdateDeliveryConfigInput) {
    if (!this.merchantRepo.getById) {
      throw new Error("getById not available on this repository implementation");
    }
    const merchant = await this.merchantRepo.getById(input.merchantId);
    if (!merchant) {
      throw new NotFoundException(`Merchant not found: ${input.merchantId}`);
    }

    // Update Melhor Envio enabled flag if provided
    if (input.melhorEnvioEnabled !== undefined && this.merchantRepo.updateMelhorEnvioEnabled) {
      await this.merchantRepo.updateMelhorEnvioEnabled(input.merchantId, input.melhorEnvioEnabled);
    }

    // Update own delivery config if provided
    if (input.ownDelivery) {
      const { mode, flatPriceCents, freeAboveCents, neighborhoods, estimatedValue = 60, estimatedUnit = "minutes" } = input.ownDelivery;

      // Validate based on mode
      if (mode === "flat" && (flatPriceCents === undefined || flatPriceCents === null)) {
        throw new BadRequestException("flatPriceCents is required when mode is 'flat'");
      }

      if (mode === "neighborhood" && (!neighborhoods || neighborhoods.length === 0)) {
        throw new BadRequestException("neighborhoods is required and cannot be empty when mode is 'neighborhood'");
      }

      // Validate estimatedValue is positive integer
      if (typeof estimatedValue !== "number" || estimatedValue <= 0 || !Number.isInteger(estimatedValue)) {
        throw new BadRequestException("estimatedValue must be a positive integer");
      }

      // Validate estimatedUnit
      if (!["minutes", "days"].includes(estimatedUnit)) {
        throw new BadRequestException("estimatedUnit must be 'minutes' or 'days'");
      }

      const existingConfig = await this.ownDeliveryRepo.getByMerchantId(input.merchantId);

      const configToSave = {
        id: existingConfig?.id || `own-delivery-${input.merchantId}`,
        merchantId: input.merchantId,
        enabled: input.ownDelivery.enabled,
        mode,
        flatPriceCents: mode === "flat" ? (flatPriceCents ?? null) : null,
        freeAboveCents: freeAboveCents ?? null,
        neighborhoods: mode === "neighborhood" ? (neighborhoods ?? null) : null,
        estimatedValue,
        estimatedUnit
      } as any;

      await this.ownDeliveryRepo.save(configToSave);
    }

    return {
      success: true
    };
  }
}
