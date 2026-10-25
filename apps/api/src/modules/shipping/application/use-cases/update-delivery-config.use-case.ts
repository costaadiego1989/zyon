import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from "@nestjs/common";
import type { OwnDeliveryNeighborhood, OwnDeliveryRadiusZone, OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { OWN_DELIVERY_CONFIG_REPOSITORY } from "../../domain/ports/own-delivery-config.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

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
    @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo: MerchantRepository,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus
  ) {}

  async execute(input: UpdateDeliveryConfigInput) {
    if (!this.merchantRepo.getById) {
      throw new Error("getById not available on this repository implementation");
    }
    const merchant = await this.merchantRepo.getById(input.merchantId);
    if (!merchant) {
      throw new NotFoundException(`Merchant not found: ${input.merchantId}`);
    }
    validateOptionalBoolean("melhorEnvioEnabled", input.melhorEnvioEnabled);

    // Update Melhor Envio enabled flag if provided
    if (input.melhorEnvioEnabled !== undefined && this.merchantRepo.updateMelhorEnvioEnabled) {
      await this.merchantRepo.updateMelhorEnvioEnabled(input.merchantId, input.melhorEnvioEnabled);
    }

    // Update own delivery config if provided
    if (input.ownDelivery) {
      validateBoolean("ownDelivery.enabled", input.ownDelivery.enabled);
      const existingConfig = await this.ownDeliveryRepo.getByMerchantId(input.merchantId);

      // If only toggling enabled flag (no mode/price changes), skip validation
      const isToggleOnly = input.ownDelivery.mode === undefined
        && input.ownDelivery.flatPriceCents === undefined
        && input.ownDelivery.freeAboveCents === undefined
        && input.ownDelivery.neighborhoods === undefined
        && input.ownDelivery.radiusZones === undefined
        && input.ownDelivery.estimatedValue === undefined
        && input.ownDelivery.estimatedUnit === undefined;

      const mode = input.ownDelivery.mode ?? existingConfig?.mode ?? "flat";
      const flatPriceCents = input.ownDelivery.flatPriceCents !== undefined
        ? input.ownDelivery.flatPriceCents
        : existingConfig?.flatPriceCents ?? null;
      const freeAboveCents = input.ownDelivery.freeAboveCents !== undefined
        ? input.ownDelivery.freeAboveCents
        : existingConfig?.freeAboveCents ?? null;
      const neighborhoods = input.ownDelivery.neighborhoods !== undefined
        ? input.ownDelivery.neighborhoods
        : existingConfig?.neighborhoods ?? null;
      const radiusZones = input.ownDelivery.radiusZones !== undefined
        ? input.ownDelivery.radiusZones
        : existingConfig?.radiusZones ?? null;
      const estimatedValue = input.ownDelivery.estimatedValue ?? existingConfig?.estimatedValue ?? 60;
      const estimatedUnit = input.ownDelivery.estimatedUnit ?? existingConfig?.estimatedUnit ?? "minutes";

      if (!isOwnDeliveryMode(mode)) {
        throw new BadRequestException("mode must be 'flat', 'neighborhood', or 'radius'");
      }
      if (input.ownDelivery.flatPriceCents !== undefined) {
        validateNullableCents("flatPriceCents", input.ownDelivery.flatPriceCents);
      }
      if (input.ownDelivery.freeAboveCents !== undefined) {
        validateNullableCents("freeAboveCents", input.ownDelivery.freeAboveCents);
      }

      let normalizedNeighborhoods: OwnDeliveryNeighborhood[] | null = null;
      let normalizedRadiusZones: OwnDeliveryRadiusZone[] | null = null;

      if (!isToggleOnly) {
        // Validate based on mode
        if (mode === "flat") {
          validateRequiredCents("flatPriceCents", flatPriceCents);
        }

        if (mode === "neighborhood") {
          normalizedNeighborhoods = validateAndNormalizeNeighborhoods(neighborhoods);
        }

        if (mode === "radius") {
          normalizedRadiusZones = validateAndNormalizeRadiusZones(radiusZones);
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
      const normalizedZones = normalizedRadiusZones ?? normalizeRadiusZones(radiusZones);

      const configToSave = {
        id: existingConfig?.id || `own-delivery-${input.merchantId}`,
        merchantId: input.merchantId,
        enabled: input.ownDelivery.enabled,
        mode,
        flatPriceCents: mode === "flat" ? flatPriceCents : null,
        freeAboveCents,
        neighborhoods: mode === "neighborhood" ? (normalizedNeighborhoods ?? neighborhoods) : null,
        radiusZones: mode === "radius" ? normalizedZones : null,
        estimatedValue,
        estimatedUnit
      } as any;

      await this.ownDeliveryRepo.save(configToSave);

      // Reindex knowledge base with delivery coverage so the agent can answer
      // "vocês entregam no meu bairro?". Only neighborhood mode has named regions;
      // radius/flat modes carry none. Best-effort — never blocks the save.
      const deliveryRegions =
        mode === "neighborhood" && neighborhoods?.length
          ? neighborhoods.map((n) => n.name).filter(Boolean)
          : undefined;

      void this.eventBus?.publish({
        eventType: "merchant.config_updated",
        merchantId: input.merchantId,
        payload: {
          merchantId: input.merchantId,
          paymentMethods: undefined,
          installments: undefined,
          deliveryRegions,
        },
      });
    }

    return {
      success: true
    };
  }
}

const MAX_INT32 = 2_147_483_647;

function isOwnDeliveryMode(value: unknown): value is "flat" | "neighborhood" | "radius" {
  return value === "flat" || value === "neighborhood" || value === "radius";
}

function validateNullableCents(name: string, value: unknown): asserts value is number | null {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_INT32) {
    throw new BadRequestException(`${name} must be a non-negative integer up to ${MAX_INT32}, or null`);
  }
}

function validateRequiredCents(name: string, value: unknown): asserts value is number {
  if (value === null || value === undefined) {
    throw new BadRequestException(`${name} is required when mode is 'flat'`);
  }
  validateNullableCents(name, value);
}

function validateOptionalBoolean(name: string, value: unknown): asserts value is boolean | undefined {
  if (value !== undefined) validateBoolean(name, value);
}

function validateBoolean(name: string, value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") throw new BadRequestException(`${name} must be a boolean`);
}

function validateAndNormalizeNeighborhoods(value: unknown): OwnDeliveryNeighborhood[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("neighborhoods is required and cannot be empty when mode is 'neighborhood'");
  }

  const seenNames = new Set<string>();
  return value.map((neighborhood, index) => {
    if (!neighborhood || typeof neighborhood !== "object") {
      throw new BadRequestException(`neighborhoods[${index}] must be an object`);
    }

    const { name, priceCents } = neighborhood as Partial<OwnDeliveryNeighborhood>;
    if (typeof name !== "string" || !name.trim()) {
      throw new BadRequestException(`neighborhoods[${index}].name must be a non-empty string`);
    }
    validateNullableCents(`neighborhoods[${index}].priceCents`, priceCents);
    if (priceCents === null) {
      throw new BadRequestException(`neighborhoods[${index}].priceCents must be a non-negative integer`);
    }

    const normalizedName = name.trim();
    const nameKey = normalizedName.toLocaleLowerCase("pt-BR");
    if (seenNames.has(nameKey)) {
      throw new BadRequestException(`neighborhoods[${index}].name must not duplicate another neighborhood`);
    }
    seenNames.add(nameKey);

    return { name: normalizedName, priceCents };
  });
}

function normalizeRadiusZones(zones: OwnDeliveryRadiusZone[] | null): OwnDeliveryRadiusZone[] | null {
  return zones
    ? [...zones].sort((a, b) => {
        if (a.maxKm === null) return 1;
        if (b.maxKm === null) return -1;
        return a.maxKm - b.maxKm;
      })
    : null;
}

function validateAndNormalizeRadiusZones(value: unknown): OwnDeliveryRadiusZone[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("radiusZones is required and cannot be empty when mode is 'radius'");
  }

  let hasOpenEndedTier = false;
  const maxKmValues = new Set<number>();
  const zones = value.map((zone, index) => {
    if (!zone || typeof zone !== "object") {
      throw new BadRequestException(`radiusZones[${index}] must be an object`);
    }
    const { maxKm, priceCents } = zone as Partial<OwnDeliveryRadiusZone>;
    if (maxKm === null) {
      if (hasOpenEndedTier) throw new BadRequestException("radiusZones may contain only one open-ended tier");
      hasOpenEndedTier = true;
    } else if (typeof maxKm !== "number" || !Number.isFinite(maxKm) || maxKm <= 0) {
      throw new BadRequestException("radiusZones.maxKm must be a positive finite number or null (open-ended tier)");
    } else if (maxKmValues.has(maxKm)) {
      throw new BadRequestException("radiusZones.maxKm values must be unique");
    } else {
      maxKmValues.add(maxKm);
    }
    validateNullableCents(`radiusZones[${index}].priceCents`, priceCents);
    if (priceCents === null) throw new BadRequestException(`radiusZones[${index}].priceCents must be a non-negative integer`);
    return { maxKm, priceCents };
  });

  return normalizeRadiusZones(zones)!;
}
