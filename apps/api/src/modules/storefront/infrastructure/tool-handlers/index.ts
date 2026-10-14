import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { SearchMarketplaceProductsStorefrontUseCase } from "../../application/use-cases/search-marketplace-products-storefront.use-case.js";
import type { AddMarketplaceItemToCartStorefrontUseCase } from "../../application/use-cases/add-marketplace-item-to-cart.use-case.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import type { CrossSellPromotionRepository } from "../../../cross-sell/domain/ports/cross-sell-promotion-repository.port.js";
import type { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import type { CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import type { StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import type { SupportHandoffService } from "../../../support/application/support-handoff.service.js";
import type { PrismaClient } from "@prisma/client";
import type { OneBuyClickSessionService } from "../../application/services/one-buy-click-session.service.js";
import type { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";
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
  searchMarketplaceProducts?: SearchMarketplaceProductsStorefrontUseCase;
  addMarketplaceItemToCart?: AddMarketplaceItemToCartStorefrontUseCase;
  listEligibleCrossSells?: ListEligibleCrossSellsUseCase;
  loadCrossSellConfig: (merchantId: string) => Promise<CrossSellConfig>;
  crossSellPromotionRepo?: CrossSellPromotionRepository;
  applyCouponUseCase?: ApplyCouponUseCase;
  couponRepo?: CouponRepository;
  productPromotionRepo?: ProductPromotionRepositoryPort;
  billing?: BillingPlanMeteringService;
  oneBuyClick?: OneBuyClickSessionService;
}

export function composeStoreToolHandlers(deps: AllHandlerDeps, ctx: ToolRequestContext): StoreToolHandlers {
  const productDeps: ProductHandlerDeps = {
    cartRepo: deps.cartRepo,
    loadCrossSellConfig: deps.loadCrossSellConfig,
    listEligibleCrossSells: deps.listEligibleCrossSells,
    productRepo: deps.productRepo,
    stockRepo: deps.stockRepo,
    merchantRepo: deps.merchantRepo,
    prisma: deps.prisma,
    searchMarketplaceProducts: deps.searchMarketplaceProducts,
  };

  const cartDeps: CartHandlerDeps = {
    productRepo: deps.productRepo,
    stockRepo: deps.stockRepo,
    cartRepo: deps.cartRepo,
    prisma: deps.prisma,
    merchantRepo: deps.merchantRepo,
    searchMarketplaceProducts: deps.searchMarketplaceProducts,
    addMarketplaceItemToCart: deps.addMarketplaceItemToCart,
    listEligibleCrossSells: deps.listEligibleCrossSells,
    loadCrossSellConfig: deps.loadCrossSellConfig,
    crossSellPromotionRepo: deps.crossSellPromotionRepo,
    applyCouponUseCase: deps.applyCouponUseCase,
    couponRepo: deps.couponRepo,
    productPromotionRepo: deps.productPromotionRepo,
    billing: deps.billing,
    oneBuyClick: deps.oneBuyClick,
  };

  const reviewDeps: ReviewHandlerDeps = {
    prisma: deps.prisma,
  };

  const wishlistDeps: WishlistHandlerDeps = {
    prisma: deps.prisma,
    productRepo: deps.productRepo,
  };

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
