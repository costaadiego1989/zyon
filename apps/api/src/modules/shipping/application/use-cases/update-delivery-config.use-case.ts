import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import type { OwnDeliveryNeighborhood, OwnDeliveryRadiusZone, OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY } from "../../domain/ports/own-delivery-config.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";

export interface UpdateDeliveryConfigInput {
  merchantId: string;
  melhorEnvioEnabled?: boolean;
  ownDelivery?: {
    enabled: boolean;
    mode?: "flat" | "neighborhood" | "radius";
    flatPriceCents?: number | null;
    freeAboveCents?: number | null;
    neighborhoods?: OwnDeliveryNeighborhood[] | null;
    radiusZones?: OwnDeliveryRadiusZone[] | null;
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
      const existingConfig = await this.ownDeliveryRepo.getByMerchantId(input.merchantId);

      // If only toggling enabled flag (no mode/price changes), skip validation
      const isToggleOnly = input.ownDelivery.mode === undefined && input.ownDelivery.flatPriceCents === undefined && input.ownDelivery.neighborhoods === undefined && input.ownDelivery.radiusZones === undefined;

      const mode = input.ownDelivery.mode ?? existingConfig?.mode ?? "flat";
      const flatPriceCents = input.ownDelivery.flatPriceCents ?? existingConfig?.flatPriceCents ?? null;
      const freeAboveCents = input.ownDelivery.freeAboveCents ?? existingConfig?.freeAboveCents ?? null;
      const neighborhoods = input.ownDelivery.neighborhoods ?? existingConfig?.neighborhoods ?? null;
      const radiusZones = input.ownDelivery.radiusZones ?? existingConfig?.radiusZones ?? null;
      const estimatedValue = input.ownDelivery.estimatedValue ?? existingConfig?.estimatedValue ?? 60;
      const estimatedUnit = input.ownDelivery.estimatedUnit ?? existingConfig?.estimatedUnit ?? "minutes";

      if (!isToggleOnly) {
        // Validate based on mode
        if (mode === "flat" && (flatPriceCents === undefined || flatPriceCents === null)) {
          throw new BadRequestException("flatPriceCents is required when mode is 'flat'");
        }

        if (mode === "neighborhood" && (!neighborhoods || neighborhoods.length === 0)) {
          throw new BadRequestException("neighborhoods is required and cannot be empty when mode is 'neighborhood'");
        }

        if (mode === "radius") {
          if (!radiusZones || radiusZones.length === 0) {
            throw new BadRequestException("radiusZones is required and cannot be empty when mode is 'radius'");
          }
          for (const zone of radiusZones) {
            if (zone.maxKm !== null && (typeof zone.maxKm !== "number" || zone.maxKm <= 0)) {
              throw new BadRequestException("radiusZones.maxKm must be a positive number or null (open-ended tier)");
            }
            if (typeof zone.priceCents !== "number" || zone.priceCents < 0 || !Number.isInteger(zone.priceCents)) {
              throw new BadRequestException("radiusZones.priceCents must be a non-negative integer");
            }
          }
        }

        // Validate estimatedValue is positive integer
        if (typeof estimatedValue !== "number" || estimatedValue <= 0 || !Number.isInteger(estimatedValue)) {
          throw new BadRequestException("estimatedValue must be a positive integer");
        }

        // Validate estimatedUnit
        if (!["minutes", "days"].includes(estimatedUnit)) {
          throw new BadRequestException("estimatedUnit must be 'minutes' or 'days'");
        }
      }

      // Normalize radius zones: sort ascending, null (open-ended) last
      const normalizedZones = radiusZones
        ? [...radiusZones].sort((a, b) => {
            if (a.maxKm === null) return 1;
            if (b.maxKm === null) return -1;
            return a.maxKm - b.maxKm;
          })
        : null;

      const configToSave = {
        id: existingConfig?.id || `own-delivery-${input.merchantId}`,
        merchantId: input.merchantId,
        enabled: input.ownDelivery.enabled,
        mode,
        flatPriceCents: mode === "flat" ? (flatPriceCents ?? null) : null,
        freeAboveCents: freeAboveCents ?? null,
        neighborhoods: mode === "neighborhood" ? (neighborhoods ?? null) : null,
        radiusZones: mode === "radius" ? normalizedZones : null,
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
