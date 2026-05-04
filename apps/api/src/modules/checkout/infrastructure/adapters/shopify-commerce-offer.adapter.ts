import { Injectable } from "@nestjs/common";
import { applyShopifyOffer } from "@aacp/commerce-adapters";
import type { AuthorizedOffer } from "@aacp/shared-types";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";

@Injectable()
export class ShopifyCommerceOfferAdapter implements CommerceOfferPort {
  async apply(offer: AuthorizedOffer) {
    const result = await applyShopifyOffer(offer, {
      shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
      adminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      apiVersion: process.env.SHOPIFY_API_VERSION
    });
    return {
      success: result.success,
      discount_code: result.discountCode,
      apply_url: result.applyUrl,
      reason: result.reason
    };
  }
}
