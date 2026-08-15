export interface ProductVariantProps {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  barcode?: string;
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  isActive: boolean;
  basePriceInCents: number;
  costInCents?: number;
  taxPercent: number;
  currency: string;
  stockQuantity: number;
  stockReserved: number;
  media: Array<{ id: string; url: string; type: "IMAGE" | "VIDEO"; alt?: string; order: number }>;
}

export interface ProductProps {
  id: string;
  merchantId: string;
  name: string;
  description?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  categoryId?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  variants: ProductVariantProps[];
  averageRating?: number;
  reviewCount?: number;
}

export class ProductEntity {
  readonly id: string;
  readonly merchantId: string;
  readonly name: string;
  readonly description?: string;
  readonly type: string;
  readonly metadata?: Record<string, unknown>;
  readonly categoryId?: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly variants: ProductVariantProps[];
  readonly averageRating?: number;
  readonly reviewCount?: number;

  constructor(props: ProductProps) {
    this.id = props.id;
    this.merchantId = props.merchantId;
    this.name = props.name;
    this.description = props.description;
    this.type = props.type ?? "physical";
    this.metadata = props.metadata;
    this.categoryId = props.categoryId;
    this.isActive = props.isActive;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.variants = props.variants;
    this.averageRating = props.averageRating;
    this.reviewCount = props.reviewCount;
  }

  get defaultVariant(): ProductVariantProps | undefined {
    return this.variants[0];
  }

  get priceRange(): { min: number; max: number } {
    const prices = this.variants.map((v) => v.basePriceInCents);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }

  get totalStock(): number {
    return this.variants.reduce((sum, v) => sum + v.stockQuantity - v.stockReserved, 0);
  }

  get hasStock(): boolean {
    return this.totalStock > 0;
  }

  get shippingDimensions(): { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number } | null {
    const variant = this.defaultVariant;
    if (!variant?.weightGrams) return null;
    return {
      weightGrams: variant.weightGrams,
      lengthCm: variant.lengthCm ?? 0,
      widthCm: variant.widthCm ?? 0,
      heightCm: variant.heightCm ?? 0,
    };
  }
}
