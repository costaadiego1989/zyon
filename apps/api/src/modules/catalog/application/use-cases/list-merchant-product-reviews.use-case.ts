import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export type MerchantProductReviewKind = "testimonial" | "video";
export type MerchantProductReviewStatus = "pending" | "approved" | "rejected";

export interface ListMerchantProductReviewsInput {
  merchantId: string;
  kind: MerchantProductReviewKind;
  moderationStatus?: MerchantProductReviewStatus;
  productId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  page?: number;
  pageSize?: number;
}

export interface MerchantProductReviewItem {
  id: string;
  kind: MerchantProductReviewKind;
  productId: string;
  productName: string;
  source: string;
  moderationStatus: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  body?: string;
  rating?: number | null;
  title?: string;
  videoUrl?: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
}

export interface ListMerchantProductReviewsResult {
  items: MerchantProductReviewItem[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Tenant-scoped moderation inbox for buyer-submitted product reviews.
 * Curated merchant copy is intentionally excluded: this queue is only for
 * content submitted by customers that still needs a merchant decision.
 */
@Injectable()
export class ListMerchantProductReviewsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: ListMerchantProductReviewsInput): Promise<ListMerchantProductReviewsResult> {
    const page = normalizePositiveInteger(input.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = normalizePositiveInteger(input.pageSize, 20, 1, 100);
    const skip = (page - 1) * pageSize;
    const createdAt = dateFilter(input.createdFrom, input.createdTo);
    const product = { merchantId: input.merchantId, deletedAt: null };

    if (input.kind === "testimonial") {
      const where = {
        product,
        source: "customer_submission",
        ...(input.moderationStatus ? { moderationStatus: input.moderationStatus } : {}),
        ...(input.productId ? { productId: input.productId } : {}),
        ...(createdAt ? { createdAt } : {}),
      };
      const [rows, total] = await Promise.all([
        this.prisma.productTestimonial.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
          select: {
            id: true,
            productId: true,
            authorName: true,
            authorAvatarUrl: true,
            body: true,
            rating: true,
            source: true,
            moderationStatus: true,
            isPublished: true,
            createdAt: true,
            updatedAt: true,
            product: { select: { name: true } },
          },
        }),
        this.prisma.productTestimonial.count({ where }),
      ]);

      return {
        page,
        pageSize,
        total,
        items: rows.map((row) => ({
          id: row.id,
          kind: "testimonial" as const,
          productId: row.productId,
          productName: row.product.name,
          authorName: row.authorName,
          authorAvatarUrl: row.authorAvatarUrl,
          body: row.body,
          rating: row.rating,
          source: row.source,
          moderationStatus: row.moderationStatus,
          isPublished: row.isPublished,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    }

    const where = {
      product,
      source: "customer",
      ...(input.moderationStatus ? { moderationStatus: input.moderationStatus } : {}),
      ...(input.productId ? { productId: input.productId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.productVideo.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          productId: true,
          title: true,
          videoUrl: true,
          thumbnailUrl: true,
          durationSeconds: true,
          source: true,
          moderationStatus: true,
          isPublished: true,
          createdAt: true,
          updatedAt: true,
          product: { select: { name: true } },
        },
      }),
      this.prisma.productVideo.count({ where }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => ({
        id: row.id,
        kind: "video" as const,
        productId: row.productId,
        productName: row.product.name,
        title: row.title,
        videoUrl: row.videoUrl,
        thumbnailUrl: row.thumbnailUrl,
        durationSeconds: row.durationSeconds,
        source: row.source,
        moderationStatus: row.moderationStatus,
        isPublished: row.isPublished,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || !value || value < min) return fallback;
  return Math.min(value, max);
}

function dateFilter(createdFrom?: Date, createdTo?: Date): { gte?: Date; lte?: Date } | undefined {
  if (!createdFrom && !createdTo) return undefined;
  return {
    ...(createdFrom ? { gte: createdFrom } : {}),
    ...(createdTo ? { lte: createdTo } : {}),
  };
}
