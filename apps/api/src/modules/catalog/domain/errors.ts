/**
 * Domain errors for the catalog module (products, promotions, stock).
 * Thrown by domain/application layers; mapped to HTTP exceptions in the controller.
 */

export class ProductNotFoundError extends Error {
  readonly code = "product_not_found";
  constructor(productId: string) {
    super(`product_not_found:${productId}`);
    this.name = "ProductNotFoundError";
  }
}

export class VariantNotFoundError extends Error {
  readonly code = "variant_not_found";
  constructor(variantId: string) {
    super(`variant_not_found:${variantId}`);
    this.name = "VariantNotFoundError";
  }
}

export class CategoryNotFoundError extends Error {
  readonly code = "category_not_found";
  constructor(categoryId: string) {
    super(`category_not_found:${categoryId}`);
    this.name = "CategoryNotFoundError";
  }
}

export class InsufficientStockError extends Error {
  readonly code = "insufficient_stock";
  readonly available: number;
  readonly requested: number;
  constructor(variantId: string, available: number, requested: number) {
    super(`insufficient_stock:${variantId}:available=${available}:requested=${requested}`);
    this.name = "InsufficientStockError";
    this.available = available;
    this.requested = requested;
  }
}

export class PromotionNotFoundError extends Error {
  readonly code = "promotion_not_found";
  constructor(promoId: string) {
    super(`promotion_not_found:${promoId}`);
    this.name = "PromotionNotFoundError";
  }
}

export class PromotionOverlapError extends Error {
  readonly code = "promotion_overlap";
  constructor(targetId: string, existingPromoId: string) {
    super(`promotion_overlap:target=${targetId}:existing=${existingPromoId}`);
    this.name = "PromotionOverlapError";
  }
}

export class PromotionInvalidDatesError extends Error {
  readonly code = "promotion_invalid_dates";
  constructor(reason: string) {
    super(`promotion_invalid_dates:${reason}`);
    this.name = "PromotionInvalidDatesError";
  }
}

export class PromotionDiscountInvalidError extends Error {
  readonly code = "promotion_discount_invalid";
  constructor(discountType: string, discountValue: number) {
    super(`promotion_discount_invalid:type=${discountType}:value=${discountValue}`);
    this.name = "PromotionDiscountInvalidError";
  }
}

export class CartItemNotFoundError extends Error {
  readonly code = "cart_item_not_found";
  constructor(variantId: string) {
    super(`cart_item_not_found:${variantId}`);
    this.name = "CartItemNotFoundError";
  }
}

export class CartEmptyError extends Error {
  readonly code = "cart_empty";
  constructor() {
    super("cart_empty");
    this.name = "CartEmptyError";
  }
}
