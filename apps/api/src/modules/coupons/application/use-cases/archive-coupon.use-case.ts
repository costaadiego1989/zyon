import { Injectable, Inject, NotFoundException, ConflictException, Logger } from "@nestjs/common";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { COUPON_REDEMPTION_REPOSITORY, type CouponRedemptionRepository } from "../../domain/ports/coupon-redemption-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

const logger = new Logger("ArchiveCouponUseCase");

@Injectable()
export class ArchiveCouponUseCase {
  private readonly logger = new Logger(ArchiveCouponUseCase.name);

  constructor(
    @Inject(COUPON_REPOSITORY) private readonly repo: CouponRepository,
    @Inject(COUPON_REDEMPTION_REPOSITORY) private readonly redemptions: CouponRedemptionRepository
  ) {}

  async execute(input: { id: string; merchant_id: string }) {
    const coupon = await this.repo.findById(input.id, input.merchant_id);
    if (!coupon) throw new NotFoundException("coupon_not_found");

    const archived = coupon.archive();
    await this.repo.save(archived);
    return archived.snapshot();
  }
}
