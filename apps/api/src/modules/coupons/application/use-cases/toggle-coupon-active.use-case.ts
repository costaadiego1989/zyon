import { Injectable, Inject } from "@nestjs/common";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";

@Injectable()
export class ToggleCouponActiveUseCase {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly repo: CouponRepository
  ) {}

  async execute(input: { id: string; merchant_id: string; is_active: boolean }): Promise<void> {
    await this.repo.updateActive(input.merchant_id, input.id, input.is_active);
  }
}
