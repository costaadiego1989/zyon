import type { PrismaClient } from "@prisma/client";
import type { ProductVideoRepositoryPort } from "../../domain/ports/product-video-repository.port.js";
import {
  ProductVideoEntity,
  DEFAULT_PRODUCT_CONTENT_LOCALE,
} from "../../domain/entities/product-video.entity.js";

export class PrismaProductVideoRepository implements ProductVideoRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findApprovedByProduct(input: {
    productId: string;
    limit?: number;
    locale?: string;
  }): Promise<ProductVideoEntity[]> {
    const rows = await this.prisma.productVideo.findMany({
      where: {
        productId: input.productId,
        isPublished: true,
        moderationStatus: "approved",
        locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
    return rows.map((row) => this.toEntity(row));
  }

  async listAllForMerchant(input: {
    merchantId: string;
    productId: string;
    moderationStatus?: "pending" | "approved" | "rejected";
    locale?: string;
  }): Promise<ProductVideoEntity[]> {
    const rows = await this.prisma.productVideo.findMany({
      where: {
        productId: input.productId,
        product: { merchantId: input.merchantId },
        ...(input.moderationStatus
          ? { moderationStatus: input.moderationStatus }
          : {}),
        locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async create(input: any, _actor: any): Promise<ProductVideoEntity> {
    const row = await this.prisma.productVideo.create({
      data: {
        productId: input.productId,
        title: input.title,
        videoUrl: input.videoUrl,
        thumbnailUrl: input.thumbnailUrl ?? null,
        durationSeconds: input.durationSeconds ?? null,
        source: input.source ?? "merchant",
        buyerId: input.buyerId ?? null,
        moderationStatus: input.moderationStatus ?? "pending",
        isPublished: input.isPublished ?? false,
        locale: input.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      },
    });
    return this.toEntity(row);
  }

  async update(input: {
    merchantId: string;
    id: string;
    patch: {
      title?: string;
      videoUrl?: string;
      thumbnailUrl?: string | null;
      durationSeconds?: number | null;
      isPublished?: boolean;
      moderationStatus?: "pending" | "approved" | "rejected";
      locale?: string;
    };
  }): Promise<ProductVideoEntity> {
    const row = await this.prisma.productVideo.update({
      where: {
        id: input.id,
        product: { merchantId: input.merchantId },
      },
      data: {
        title: input.patch.title,
        videoUrl: input.patch.videoUrl,
        thumbnailUrl: input.patch.thumbnailUrl,
        durationSeconds: input.patch.durationSeconds,
        isPublished: input.patch.isPublished,
        moderationStatus: input.patch.moderationStatus,
        locale: input.patch.locale,
      },
    });
    return this.toEntity(row);
  }

  async delete(input: { merchantId: string; id: string }): Promise<void> {
    await this.prisma.productVideo.deleteMany({
      where: { id: input.id, product: { merchantId: input.merchantId } },
    });
  }

  async approve(input: {
    merchantId: string;
    id: string;
  }): Promise<ProductVideoEntity> {
    const row = await this.prisma.productVideo.update({
      where: { id: input.id, product: { merchantId: input.merchantId } },
      data: { moderationStatus: "approved" },
    });
    return this.toEntity(row);
  }

  async reject(input: {
    merchantId: string;
    id: string;
  }): Promise<ProductVideoEntity> {
    const row = await this.prisma.productVideo.update({
      where: { id: input.id, product: { merchantId: input.merchantId } },
      data: { moderationStatus: "rejected" },
    });
    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    productId: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    source: string;
    buyerId: string | null;
    moderationStatus: string;
    isPublished: boolean;
    locale?: string;
    createdAt: Date;
    updatedAt: Date;
  }): ProductVideoEntity {
    return ProductVideoEntity.rehydrate({
      id: row.id,
      productId: row.productId,
      title: row.title,
      videoUrl: row.videoUrl,
      thumbnailUrl: row.thumbnailUrl,
      durationSeconds: row.durationSeconds,
      source: row.source as "merchant" | "customer",
      buyerId: row.buyerId,
      orderId: null,
      moderationStatus: row.moderationStatus as "pending" | "approved" | "rejected",
      isPublished: row.isPublished,
      locale: row.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
