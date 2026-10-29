import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  ProductContentRepositoryPort,
  ProductContentHistoryDetail,
  ProductContentHistorySummary,
} from "../../domain/ports/product-content-repository.port.js";
import {
  ProductContentBlockEntity,
  type ProductContentBlockType,
  type ProductContentBlockProps,
  normalizeProductContentLocale,
  DEFAULT_PRODUCT_CONTENT_LOCALE,
} from "../../domain/entities/product-content-block.entity.js";

/**
 * Wave 3 history contract: every `replaceAll` snapshots the prior live state
 * into `product_content_history` so the dashboard side-panel can list and the
 * revert use-case can restore. The snapshot is a JSON-encoded
 * `{ blocks: ProductContentBlockProps[] }` so the column stays opaque to
 * SQL but trivially consumable from the use-case layer.
 */
export class PrismaProductContentRepository implements ProductContentRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findByProduct(input: {
    merchantId: string;
    productId: string;
    locale?: string;
  }): Promise<ProductContentBlockEntity[]> {
    const locale = input.locale
      ? normalizeProductContentLocale(input.locale)
      : undefined;
    const rows = await this.prisma.productContentBlock.findMany({
      where: {
        productId: input.productId,
        product: { merchantId: input.merchantId },
        ...(locale ? { locale } : {}),
      },
      orderBy: { order: "asc" },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async upsert(
    input: { block: ProductContentBlockEntity },
    actor: { id: string; merchantId: string },
  ): Promise<ProductContentBlockEntity> {
    const block = input.block;
    const merchantId = actor.merchantId;
    await this.assertProduct(merchantId, block.productId);
    const row = await this.prisma.productContentBlock.upsert({
      where: { id: block.id },
      create: {
        id: block.id,
        productId: block.productId,
        type: block.type,
        props: block.props as object,
        order: block.order,
        isEnabled: block.isEnabled,
        locale: block.locale,
      },
      update: {
        type: block.type,
        props: block.props as object,
        order: block.order,
        isEnabled: block.isEnabled,
        locale: block.locale,
      },
    });
    return this.toEntity(row);
  }

  async delete(input: {
    merchantId: string;
    productId: string;
    id: string;
  }): Promise<void> {
    await this.assertProduct(input.merchantId, input.productId);
    await this.prisma.productContentBlock.deleteMany({
      where: {
        id: input.id,
        productId: input.productId,
        product: { merchantId: input.merchantId },
      },
    });
  }

  async replaceAll(input: {
    merchantId: string;
    productId: string;
    blocks: readonly ProductContentBlockProps[];
    locale?: string;
    savedBy?: string;
  }): Promise<ProductContentBlockEntity[]> {
    await this.assertProduct(input.merchantId, input.productId);
    return this.prisma.$transaction(async (tx) => {
      const locale = input.locale
        ? normalizeProductContentLocale(input.locale)
        : DEFAULT_PRODUCT_CONTENT_LOCALE;

      // Snapshot the prior live state (per-locale) so a future revert can
      // restore it. We snapshot the canonical prop shape (locale included)
      // and the same locale the new write targets, so the history view is
      // per-(product, locale) and reversible per-locale.
      const priorRows = await tx.productContentBlock.findMany({
        where: {
          productId: input.productId,
          product: { merchantId: input.merchantId },
          locale,
        },
        orderBy: { order: "asc" },
      });

      if (priorRows.length > 0 || input.blocks.length > 0) {
        // Only write a snapshot row when there is something to remember OR
        // when the call is a non-empty replace — a "wipe" still records a
        // history entry so the dashboard can show "v3 cleared all blocks".
        const snapshotBlocks: ProductContentBlockProps[] = priorRows.map(
          (r) => ({
            id: r.id,
            productId: r.productId,
            type: r.type as ProductContentBlockType,
            props: (r.props as Record<string, unknown>) ?? {},
            order: r.order,
            isEnabled: r.isEnabled,
            locale: r.locale,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }),
        );
        const nextVersion = await tx.productContentHistory.aggregate({
          where: { productId: input.productId, locale },
          _max: { version: true },
        });
        const version = (nextVersion._max.version ?? 0) + 1;
        await tx.productContentHistory.create({
          data: {
            id: randomUUID(),
            productId: input.productId,
            locale,
            snapshot: { blocks: snapshotBlocks } as object,
            version,
            savedBy: input.savedBy ?? "system",
            restoredFromVersion: null,
          },
        });
      }

      await tx.productContentBlock.deleteMany({
        where: {
          productId: input.productId,
          product: { merchantId: input.merchantId },
          locale,
        },
      });
      if (input.blocks.length === 0) return [];
      const rows = await Promise.all(
        input.blocks.map((b, idx) =>
          tx.productContentBlock.create({
            data: {
              id: b.id,
              productId: input.productId,
              type: b.type,
              props: b.props as object,
              order: idx,
              isEnabled: b.isEnabled,
              locale: normalizeProductContentLocale(b.locale ?? locale),
            },
          }),
        ),
      );
      return rows.map((r) => this.toEntity(r));
    });
  }

  async latestHistoryVersion(input: {
    merchantId: string;
    productId: string;
    locale?: string;
  }): Promise<ProductContentHistorySummary | null> {
    const locale = input.locale
      ? normalizeProductContentLocale(input.locale)
      : undefined;
    const row = await this.prisma.productContentHistory.findFirst({
      where: {
        productId: input.productId,
        product: { merchantId: input.merchantId },
        ...(locale ? { locale } : {}),
      },
      orderBy: { version: "desc" },
    });
    return row ? this.toSummary(row) : null;
  }

  async listHistoryVersions(input: {
    merchantId: string;
    productId: string;
    locale?: string;
    limit?: number;
  }): Promise<ProductContentHistorySummary[]> {
    const locale = input.locale
      ? normalizeProductContentLocale(input.locale)
      : undefined;
    const rows = await this.prisma.productContentHistory.findMany({
      where: {
        productId: input.productId,
        product: { merchantId: input.merchantId },
        ...(locale ? { locale } : {}),
      },
      orderBy: { version: "desc" },
      take: input.limit ?? 50,
    });
    return rows.map((row) => this.toSummary(row));
  }

  async findHistoryById(input: {
    merchantId: string;
    productId: string;
    historyId: string;
  }): Promise<ProductContentHistoryDetail | null> {
    const row = await this.prisma.productContentHistory.findFirst({
      where: {
        id: input.historyId,
        productId: input.productId,
        product: { merchantId: input.merchantId },
      },
    });
    if (!row) return null;
    const snap = row.snapshot as unknown as {
      blocks?: ProductContentBlockProps[];
    };
    return {
      id: row.id,
      productId: row.productId,
      merchantId: input.merchantId,
      locale: row.locale,
      version: row.version,
      savedBy: row.savedBy,
      restoredFromVersion: row.restoredFromVersion,
      savedAt: row.savedAt,
      snapshot: { blocks: snap?.blocks ?? [] },
    };
  }

  private async assertProduct(merchantId: string, productId: string): Promise<void> {
    const ok = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true },
    });
    if (!ok) {
      throw new Error(`product_content_repo_product_not_found:${productId}`);
    }
  }

  private toEntity(row: {
    id: string;
    productId: string;
    type: string;
    props: unknown;
    order: number;
    isEnabled: boolean;
    locale?: string;
    createdAt: Date;
    updatedAt: Date;
  }): ProductContentBlockEntity {
    return ProductContentBlockEntity.rehydrate({
      id: row.id,
      productId: row.productId,
      type: row.type as ProductContentBlockType,
      props: (row.props as Record<string, unknown>) ?? {},
      order: row.order,
      isEnabled: row.isEnabled,
      locale: row.locale ?? DEFAULT_PRODUCT_CONTENT_LOCALE,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  private toSummary(row: {
    id: string;
    productId: string;
    locale: string;
    version: number;
    savedBy: string;
    restoredFromVersion: number | null;
    savedAt: Date;
  }): ProductContentHistorySummary {
    // merchantId is resolved upstream by the where clause; we echo it back
    // so the consumer doesn't need a second lookup to scope-render the row.
    return {
      id: row.id,
      productId: row.productId,
      merchantId: "",
      locale: row.locale,
      version: row.version,
      savedBy: row.savedBy,
      restoredFromVersion: row.restoredFromVersion,
      savedAt: row.savedAt,
    };
  }
}
