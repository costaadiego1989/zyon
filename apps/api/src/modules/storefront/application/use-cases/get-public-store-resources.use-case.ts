import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { COUPON_REPOSITORY, type CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../../stories/domain/ports/story-repository.port.js";

@Injectable()
export class GetPublicStoreResourcesUseCase {
  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Inject(STORY_REPOSITORY) private readonly stories: StoryRepositoryPort,
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
  ) {}

  async listIndex(): Promise<{ stores: Array<{ slug: string; updatedAt: string }> }> {
    return { stores: await this.merchants.listPublicStores?.() ?? [] };
  }

  async storiesForSlug(slug: string): Promise<{ categories: any[] }> {
    const merchant = await this.findStore(slug);
    return { categories: merchant ? await this.stories.listPublicStories(merchant.id) : [] };
  }

  async logoForSlug(slug: string): Promise<string> {
    const merchant = await this.findStore(slug);
    const logoUrl = merchant?.theme?.logoUrl;
    if (!merchant) throw new NotFoundException("store_not_found");
    if (!logoUrl) throw new NotFoundException("logo_not_found");
    return logoUrl;
  }

  async couponsForSlug(slug: string) {
    const merchant = await this.findStore(slug);
    if (!merchant) throw new NotFoundException("store_not_found");
    const now = new Date();
    const items = (await this.coupons.findAllByMerchant(merchant.id))
      .map((coupon) => coupon.snapshot())
      .filter((coupon) => coupon.status === "active" && new Date(coupon.starts_at) <= now && (!coupon.ends_at || new Date(coupon.ends_at) > now))
      .map((coupon) => ({
        id: coupon.id,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        min_cart_total: coupon.min_cart_total,
        max_usages: coupon.max_usages,
        usages_count: coupon.usages_count,
      }));
    return { items };
  }

  private findStore(identifier: string) {
    const normalized = identifier.trim().toLowerCase();
    return normalized.includes(".")
      ? this.merchants.findByCustomDomain?.(normalized)
      : this.merchants.findBySlug?.(normalized);
  }
}
