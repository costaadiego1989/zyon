import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { OWN_DELIVERY_CONFIG_REPOSITORY, type OwnDeliveryConfigRepository } from "../../domain/ports/own-delivery-config.port.js";
import { geocodeBrazilianCep, haversineDistance, getPriceForDistance } from "../../domain/services/distance-calculator.service.js";

export interface QuoteRadiusDeliveryInput {
  merchantId: string;
  destinationCep: string;
  // Seller/origin CEP (from config)
  originCep: string;
}

export interface QuoteRadiusDeliveryOutput {
  distanceKm: number;
  priceCents: number | null; // null if distance exceeds all zones
  zone?: {
    maxKm: number | null;
    label: string;
  };
}

@Injectable()
export class QuoteRadiusDeliveryUseCase {
  constructor(
    @Inject(OWN_DELIVERY_CONFIG_REPOSITORY) private readonly ownDeliveryRepo: OwnDeliveryConfigRepository
  ) {}

  async execute(input: QuoteRadiusDeliveryInput): Promise<QuoteRadiusDeliveryOutput> {
    const config = await this.ownDeliveryRepo.getByMerchantId(input.merchantId);

    if (!config || !config.enabled || config.mode !== "radius" || !config.radiusZones?.length) {
      throw new BadRequestException("Radius delivery not configured for merchant");
    }

    // Geocode origin and destination
    const originCoords = await geocodeBrazilianCep(input.originCep);
    if (!originCoords) {
      throw new BadRequestException(`Invalid origin CEP: ${input.originCep}`);
    }

    const destCoords = await geocodeBrazilianCep(input.destinationCep);
    if (!destCoords) {
      throw new BadRequestException(`Invalid destination CEP: ${input.destinationCep}`);
    }

    // Calculate distance
    const distanceKm = haversineDistance(
      originCoords.lat,
      originCoords.lng,
      destCoords.lat,
      destCoords.lng
    );

    // Look up price
    const priceCents = getPriceForDistance(distanceKm, config.radiusZones);

    // Find which zone matched (for response context)
    let zone: { maxKm: number | null; label: string } | undefined;
    if (priceCents !== null) {
      const matchedZone = config.radiusZones.find(
        (z) => z.maxKm === null || distanceKm <= z.maxKm
      );
      if (matchedZone) {
        const labels: Record<number | "null", string> = {
          1: "Até 1 km",
          3: "Até 3 km",
          5: "Até 5 km",
          7: "Até 7 km",
          9: "Até 9 km",
          null: "10+ km",
        };
        zone = {
          maxKm: matchedZone.maxKm,
          label: labels[matchedZone.maxKm ?? "null"] ?? `Até ${matchedZone.maxKm} km`,
        };
      }
    }

    return {
      distanceKm: Math.round(distanceKm * 100) / 100, // 2 decimals
      priceCents,
      zone,
    };
  }
}
