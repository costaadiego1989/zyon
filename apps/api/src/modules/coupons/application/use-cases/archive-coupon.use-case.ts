import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";

@Injectable()
export class ArchiveCouponUseCase {
  constructor(@Inject(COUPON_REPOSITORY) private readonly repo: CouponRepository) {}

  async execute(input: { id: string; merchant_id: string }) {
    const coupon = await this.repo.findById(input.id, input.merchant_id);
    if (!coupon) throw new NotFoundException("coupon_not_found");
    const archived = coupon.archive();
    await this.repo.save(archived);
    return archived.snapshot();
  }
}
