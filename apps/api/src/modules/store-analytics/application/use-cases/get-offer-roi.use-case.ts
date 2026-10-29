import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  ANALYTICS_REPOSITORY_PORT,
  AnalyticsRepositoryPort,
} from "../../infrastructure/repositories/prisma-analytics.repository.js";

export interface OfferRoiResult {
  totalOffersShown: number;
  totalOffersAccepted: number;
  acceptanceRate: number;
  avgDiscountGiven: number;
  revenueFromOffers: number;
  revenueWithoutOffers: number;
  liftPercent: number;
  period: { from: Date; to: Date };
}

@Injectable()
export class GetOfferRoiUseCase {
  private readonly logger = new Logger(GetOfferRoiUseCase.name);

  constructor(@Inject(ANALYTICS_REPOSITORY_PORT) private readonly analyticsRepo: AnalyticsRepositoryPort) {}

  async execute(merchantId: string, from: Date, to: Date): Promise<OfferRoiResult> {
    return this.analyticsRepo.getOfferRoi(merchantId, from, to);
  }
}
