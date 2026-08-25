import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import {
  REVIEW_REPOSITORY,
  type ReviewRepositoryPort,
  type ProductReview,
  type CreateReviewInput,
  type ListReviewsFilter,
} from "../../domain/ports/review-repository.port.js";

@Injectable()
export class PrismaReviewRepository implements ReviewRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateReviewInput): Promise<ProductReview> {
    const review = await this.prisma.productReview.create({
      data: {
        merchantId: input.merchantId,
        productId: input.productId,
        buyerId: input.buyerId,
        orderId: input.orderId || null,
        rating: input.rating,
        text: input.text || null,
        verified: input.verified ?? true,
        moderationStatus: "pending",
        approved: false,
      },
    });

    return this.mapToDomain(review);
  }

  async findById(merchantId: string, id: string): Promise<ProductReview | null> {
    const review = await this.prisma.productReview.findFirst({
      where: { id, merchantId },
    });

    return review ? this.mapToDomain(review) : null;
  }

  async list(filter: ListReviewsFilter): Promise<{ items: ProductReview[]; total: number }> {
    const skip = ((filter.page ?? 1) - 1) * (filter.pageSize ?? 20);
    const take = filter.pageSize ?? 20;

    const whereClause: Record<string, any> = { merchantId: filter.merchantId };
    if (filter.productId) whereClause.productId = filter.productId;
    if (filter.moderationStatus) whereClause.moderationStatus = filter.moderationStatus;

    const [reviews, total] = await Promise.all([
      this.prisma.productReview.findMany({
        where: whereClause,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.productReview.count({ where: whereClause }),
    ]);

    return {
      items: reviews.map((r) => this.mapToDomain(r)),
      total,
    };
  }

  async update(
    id: string,
    data: {
      moderationStatus?: "pending" | "approved" | "rejected";
      verified?: boolean;
    }
  ): Promise<ProductReview> {
    const review = await this.prisma.productReview.update({
      where: { id },
      data: {
        moderationStatus: data.moderationStatus,
        verified: data.verified,
        // Keep legacy `approved` flag in sync with moderation status
        ...(data.moderationStatus && { approved: data.moderationStatus === "approved" }),
      },
    });

    return this.mapToDomain(review);
  }

  async countByProduct(merchantId: string, productId: string): Promise<number> {
    return this.prisma.productReview.count({
      where: {
        merchantId,
        ...(productId ? { productId } : {}),
        moderationStatus: "approved",
      },
    });
  }

  async averageRatingByProduct(merchantId: string, productId: string): Promise<number | null> {
    const result = await this.prisma.productReview.aggregate({
      where: {
        merchantId,
        productId,
        moderationStatus: "approved",
      },
      _avg: { rating: true },
    });

    return result._avg.rating ?? null;
  }

  private mapToDomain(raw: any): ProductReview {
    return {
      id: raw.id,
      merchantId: raw.merchantId,
      productId: raw.productId,
      buyerId: raw.buyerId,
      orderId: raw.orderId,
      rating: raw.rating,
      text: raw.text,
      verified: raw.verified,
      moderationStatus: raw.moderationStatus,
      createdAt: raw.createdAt,
    };
  }
}
