import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { AddMarketplaceItemToCartStorefrontUseCase } from "../../application/use-cases/add-marketplace-item-to-cart.use-case.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import type { CrossSellPromotionRepository } from "../../../cross-sell/domain/ports/cross-sell-promotion-repository.port.js";
import type { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import type { CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import type { StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import type { SupportHandoffService } from "../../../support/application/support-handoff.service.js";
import type { PrismaClient } from "@prisma/client";
import { createProductHandlers, type ProductHandlerDeps } from "./product.handlers.js";
import { createCartHandlers, type CartHandlerDeps } from "./cart.handlers.js";
import type { CrossSellConfig } from "./cart-cross-sell.helper.js";
import { createReviewHandlers, type ReviewHandlerDeps } from "./review.handlers.js";
import { createWishlistHandlers, type WishlistHandlerDeps } from "./wishlist.handlers.js";
import { createOrderHandlers, type OrderHandlerDeps } from "./order.handlers.js";
import { createSupportHandlers, type SupportHandlerDeps } from "./support.handlers.js";

export interface AllHandlerDeps {
  productRepo: ProductRepositoryPort;
  stockRepo: StockRepositoryPort;
  cartRepo: StorefrontCartPort;
  prisma: PrismaClient;
  merchantRepo: MerchantRepository;
  supportHandoff: SupportHandoffService;
  searchFederatedProducts?: SearchFederatedProductsUseCase;
  addMarketplaceItemToCart?: AddMarketplaceItemToCartStorefrontUseCase;
  listEligibleCrossSells?: ListEligibleCrossSellsUseCase;
  loadCrossSellConfig: (merchantId: string) => Promise<CrossSellConfig>;
  crossSellPromotionRepo?: CrossSellPromotionRepository;
  applyCouponUseCase?: ApplyCouponUseCase;
  couponRepo?: CouponRepository;
}

export function composeStoreToolHandlers(deps: AllHandlerDeps, ctx: ToolRequestContext): StoreToolHandlers {
  const productDeps: ProductHandlerDeps = {
    productRepo: deps.productRepo,
    stockRepo: deps.stockRepo,
    merchantRepo: deps.merchantRepo,
    prisma: deps.prisma,
    searchFederatedProducts: deps.searchFederatedProducts,
  };

  const cartDeps: CartHandlerDeps = {
    productRepo: deps.productRepo,
    stockRepo: deps.stockRepo,
    cartRepo: deps.cartRepo,
    prisma: deps.prisma,
    merchantRepo: deps.merchantRepo,
    searchFederatedProducts: deps.searchFederatedProducts,
    addMarketplaceItemToCart: deps.addMarketplaceItemToCart,
    listEligibleCrossSells: deps.listEligibleCrossSells,
    loadCrossSellConfig: deps.loadCrossSellConfig,
    crossSellPromotionRepo: deps.crossSellPromotionRepo,
    applyCouponUseCase: deps.applyCouponUseCase,
    couponRepo: deps.couponRepo,
  };

  const reviewDeps: ReviewHandlerDeps = {
    prisma: deps.prisma,
  };

  const wishlistDeps: WishlistHandlerDeps = {};

  const orderDeps: OrderHandlerDeps = {
    prisma: deps.prisma,
  };

  const supportDeps: SupportHandlerDeps = {
    supportHandoff: deps.supportHandoff,
    prisma: deps.prisma,
  };

  return {
    ...createProductHandlers(productDeps, ctx),
    ...createCartHandlers(cartDeps, ctx),
    ...createReviewHandlers(reviewDeps, ctx),
    ...createWishlistHandlers(wishlistDeps, ctx),
    ...createOrderHandlers(orderDeps, ctx),
    ...createSupportHandlers(supportDeps, ctx),
  };
}
