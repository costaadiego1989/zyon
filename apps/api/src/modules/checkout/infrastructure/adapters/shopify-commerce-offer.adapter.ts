import { Injectable, Optional } from "@nestjs/common";
import { applyShopifyOffer } from "@zyon/commerce-adapters";
import type { AuthorizedOffer } from "@zyon/shared-types";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import { HttpClientService } from "../../../../shared/http/http-client.service.js";

@Injectable()
export class ShopifyCommerceOfferAdapter implements CommerceOfferPort {
  constructor(@Optional() private readonly http?: HttpClientService) {}

  async apply(offer: AuthorizedOffer) {
    const result = await applyShopifyOffer(offer, {
      shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
      adminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      apiVersion: process.env.SHOPIFY_API_VERSION,
      fetchFn: this.http?.toFetch(),
    });
    return {
      success: result.success,
      discount_code: result.discountCode,
      apply_url: result.applyUrl,
      reason: result.reason
    };
  }
}
