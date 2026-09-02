export const PRODUCT_PROMOTION_REPOSITORY = Symbol("ProductPromotionRepositoryPort");

export interface CreateProductPromotionInput {
  merchantId: string;
  productId?: string;
  variantId?: string;
  categoryId?: string;
  couponId?: string;
  discountType?: string;
  discountValue?: number;
  promoPriceInCents?: number;
  isActive?: boolean;
  startsAt: Date;
  endsAt: Date;
}

export interface UpdateProductPromotionInput {
  productId?: string;
  variantId?: string;
  categoryId?: string;
  couponId?: string;
  discountType?: string;
  discountValue?: number;
  promoPriceInCents?: number;
  isActive?: boolean;
  startsAt?: Date;
  endsAt?: Date;
}

export interface ProductPromotionEntity {
  id: string;
  merchantId: string;
  productId?: string | null;
  variantId?: string | null;
  categoryId?: string | null;
  couponId?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  promoPriceInCents?: number | null;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductPromotionRepositoryPort {
  create(input: CreateProductPromotionInput): Promise<ProductPromotionEntity>;
  update(id: string, merchantId: string, input: UpdateProductPromotionInput): Promise<ProductPromotionEntity>;
  getById(id: string, merchantId: string): Promise<ProductPromotionEntity | null>;
  delete(id: string, merchantId: string): Promise<void>;
  findByProduct(merchantId: string, productId: string): Promise<ProductPromotionEntity[]>;
  findByVariant(merchantId: string, variantId: string): Promise<ProductPromotionEntity[]>;
  findActiveByProduct(merchantId: string, productId: string, now?: Date): Promise<ProductPromotionEntity[]>;
}
