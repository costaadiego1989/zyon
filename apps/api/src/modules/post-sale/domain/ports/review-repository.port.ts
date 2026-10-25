export const REVIEW_REPOSITORY = Symbol("REVIEW_REPOSITORY");

export interface ProductReview {
  id: string;
  merchantId: string | null;
  productId: string;
  buyerId: string;
  orderId: string | null;
  rating: number; // 1-5
  text: string | null;
  verified: boolean;
  moderationStatus: "pending" | "approved" | "rejected";
  createdAt: Date;
}

export interface CreateReviewInput {
  merchantId: string;
  productId: string;
  buyerId: string;
  orderId?: string;
  rating: number;
  text?: string;
  verified?: boolean;
}

export interface ListReviewsFilter {
  merchantId: string;
  productId?: string;
  moderationStatus?: "pending" | "approved" | "rejected";
  page?: number;
  pageSize?: number;
}

export interface ReviewRepositoryPort {
  create(input: CreateReviewInput): Promise<ProductReview>;
  findById(merchantId: string, id: string): Promise<ProductReview | null>;
  list(filter: ListReviewsFilter): Promise<{ items: ProductReview[]; total: number }>;
  update(
    id: string,
    data: {
      moderationStatus?: "pending" | "approved" | "rejected";
      verified?: boolean;
    }
  ): Promise<ProductReview>;
  countByProduct(merchantId: string, productId: string): Promise<number>;
  averageRatingByProduct(merchantId: string, productId: string): Promise<number | null>;
}
