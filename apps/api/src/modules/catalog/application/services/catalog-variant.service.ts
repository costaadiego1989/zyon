import { BadRequestException, ConflictException, Injectable, Inject, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { lockCatalogMerchant, syncCatalogStockLedger } from "../../../../shared/persistence/catalog-stock-ledger.js";
import { productInputError } from "../../domain/services/product-input-validation.js";

export type VariantChanges = {
  sku?: string;
  attributes?: Record<string, string>;
  basePriceInCents?: number;
  costInCents?: number | null;
  stockQuantity?: number;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

export type VariantReplacement = VariantChanges & { id?: string; sku: string; attributes: Record<string, string>; basePriceInCents: number };
export type ProductEditorChanges = Partial<{ name: string; description: string; type: string; metadata: Record<string, unknown>; categoryId: string; isActive: boolean; seoTitle: string; metaDescription: string; slug: string; ogTitle: string; ogDescription: string; twitterCard: string; keywords: string[] }>;

@Injectable()
export class CatalogVariantService {
  private readonly logger = new Logger(CatalogVariantService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly s3: S3UploadService,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
  ) {}

  /** Replaces the active offer set atomically; retired IDs retain order history. */
  async replace(merchantId: string, productId: string, variants: VariantReplacement[], changes?: ProductEditorChanges) {
    if (!Array.isArray(variants) || variants.length > 100) throw new BadRequestException("invalid_variants");
    const result = await this.prisma.$transaction(async tx => {
      await lockCatalogMerchant(tx, merchantId);
      await tx.$queryRaw`SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.product_id = ${productId} AND p.merchant_id = ${merchantId} ORDER BY v.id FOR UPDATE OF v`;
      const product = await tx.product.findFirst({ where: { id: productId, merchantId, deletedAt: null }, include: { variants: { include: { stock: true } } } });
      if (!product) throw new NotFoundException("product_not_found");
      const error = productInputError({ merchantId, name: changes?.name ?? product.name, type: changes?.type ?? product.type, metadata: (changes?.metadata ?? product.metadata ?? undefined) as Record<string, unknown> | undefined, variants: variants.map(v => ({ ...v, costInCents: v.costInCents ?? undefined, weightGrams: v.weightGrams ?? undefined, lengthCm: v.lengthCm ?? undefined, widthCm: v.widthCm ?? undefined, heightCm: v.heightCm ?? undefined })) });
      if (error) throw new BadRequestException(error);
      const ids = variants.flatMap(v => v.id ? [v.id] : []);
      if (new Set(ids).size !== ids.length || ids.some(id => !product.variants.some(v => v.id === id && v.isActive))) throw new BadRequestException("invalid_variant_id");
      const collisions = await tx.productVariant.findMany({ where: { sku: { in: variants.map(v => v.sku.trim()) }, id: { notIn: ids }, product: { merchantId } }, select: { sku: true } });
      // A SKU cannot move to another ID: stock and reservations are attached to it.
      for (const v of variants) if (product.variants.some(old => old.id !== v.id && old.sku === v.sku.trim())) collisions.push({ sku: v.sku.trim() });
      if (collisions.length) throw new ConflictException(`sku_already_exists:${[...new Set(collisions.map(v => v.sku))].join(",")}`);
      const retired = product.variants.filter(v => v.isActive && !ids.includes(v.id));
      if (retired.some(v => v.stock.some(s => s.reserved > 0))) throw new ConflictException("stock_reserved_variant_cannot_be_removed");
      if (changes?.type && changes.type !== product.type && product.variants.some(v => v.stock.some(s => s.reserved > 0))) throw new ConflictException("stock_reserved_type_cannot_be_changed");
      if (changes) {
        if (changes.categoryId && !await tx.productCategory.findFirst({ where: { id: changes.categoryId, merchantId }, select: { id: true } })) throw new BadRequestException("category_not_found");
        const data: Prisma.ProductUpdateInput = {};
        for (const key of ["name", "description", "type", "isActive", "twitterCard", "keywords"] as const) if (changes[key] !== undefined) (data as Record<string, unknown>)[key] = changes[key];
        for (const key of ["seoTitle", "metaDescription", "slug", "ogTitle", "ogDescription"] as const) if (changes[key] !== undefined) data[key] = changes[key] || null;
        if (changes.metadata !== undefined) data.metadata = changes.metadata as Prisma.InputJsonValue;
        if (changes.categoryId !== undefined) data.category = changes.categoryId ? { connect: { id: changes.categoryId, merchantId } } : { disconnect: true };
        await tx.product.update({ where: { id: productId, merchantId }, data });
      }
      const saved: Array<{ id: string; sku: string; stockQuantity: number }> = [];
      for (const v of variants) {
        const old = product.variants.find(old => old.id === v.id);
        if (old && old.sku !== v.sku.trim()) {
          if (old.stock.some(s => s.reserved > 0)) throw new ConflictException("stock_reserved_sku_cannot_be_changed");
          await tx.inventoryItem.updateMany({ where: { merchantId, sku: old.sku }, data: { sku: v.sku.trim() } });
        }
        const data = { sku: v.sku.trim(), attributes: v.attributes, weightGrams: v.weightGrams ?? null, lengthCm: v.lengthCm ?? null, widthCm: v.widthCm ?? null, heightCm: v.heightCm ?? null };
        let id = v.id;
        if (id) {
          await tx.productVariant.update({ where: { id, productId }, data });
          await tx.productPrice.updateMany({ where: { variantId: id }, data: { basePriceInCents: v.basePriceInCents, costInCents: v.costInCents ?? null } });
        } else {
          id = (await tx.productVariant.create({ data: { ...data, productId, price: { create: { basePriceInCents: v.basePriceInCents, costInCents: v.costInCents ?? null, currency: "BRL" } }, stock: { create: { quantity: v.stockQuantity ?? 0, reserved: 0 } } } })).id;
        }
        try {
          await syncCatalogStockLedger(tx, { merchantId, variantId: id, quantity: v.stockQuantity, source: "catalog_variant" });
        } catch (e) {
          throw new ConflictException(e instanceof Error ? e.message : "stock_update_failed");
        }
        const stock = await tx.productStock.findMany({ where: { variantId: id }, select: { quantity: true } });
        saved.push({ id, sku: v.sku.trim(), stockQuantity: stock.reduce((sum, s) => sum + s.quantity, 0) });
      }
      if (retired.length) await tx.productVariant.updateMany({ where: { id: { in: retired.map(v => v.id) }, productId }, data: { isActive: false } });
      return { variants: saved };
    }, { timeout: 15_000 });
    await this.publish(merchantId, productId);
    return result;
  }

  private async publish(merchantId: string, productId: string) {
    await this.eventBus?.publish({ eventId: randomUUID(), schemaVersion: 1, eventType: "product.upserted", merchantId, payload: { id: productId, source: "variant_update" } }).catch(err => this.logger.warn(`Event publish failed for product ${productId}: ${err instanceof Error ? err.message : String(err)}`));
  }

  async update(merchantId: string, productId: string, variantId: string, changes: VariantChanges) {
    if (changes.sku !== undefined || changes.attributes !== undefined) {
      const product = await this.prisma.product.findFirst({ where: { id: productId, merchantId, deletedAt: null }, include: { variants: { where: { isActive: true }, include: { price: true } } } });
      if (!product || !product.variants.some(v => v.id === variantId)) throw new NotFoundException("variant_not_found");
      return this.replace(merchantId, productId, product.variants.map(v => ({ id: v.id, sku: v.sku, attributes: v.attributes as Record<string, string>, basePriceInCents: v.price?.basePriceInCents ?? 0, costInCents: v.price?.costInCents, weightGrams: v.weightGrams, lengthCm: v.lengthCm, widthCm: v.widthCm, heightCm: v.heightCm, ...(v.id === variantId ? changes : {}) })));
    }
    if (changes.basePriceInCents !== undefined && (!Number.isSafeInteger(changes.basePriceInCents) || changes.basePriceInCents <= 0 || changes.basePriceInCents > 2_147_483_647)) throw new BadRequestException("price_must_be_positive");
    if (changes.costInCents != null && (!Number.isSafeInteger(changes.costInCents) || changes.costInCents < 0 || changes.costInCents > 2_147_483_647)) throw new BadRequestException("invalid_cost");
    if (changes.stockQuantity !== undefined && (!Number.isSafeInteger(changes.stockQuantity) || changes.stockQuantity < 0)) {
      throw new BadRequestException("invalid_stock_quantity");
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCatalogMerchant(tx, merchantId);
      const owner = { id: variantId, productId, product: { merchantId } };
      if (!await tx.productVariant.findFirst({ where: owner, select: { id: true } })) throw new NotFoundException("variant_not_found");
      if (changes.basePriceInCents !== undefined || changes.costInCents !== undefined) {
        await tx.productPrice.updateMany({
          where: { variantId, variant: { productId, product: { merchantId } } },
          data: {
            ...(changes.basePriceInCents !== undefined ? { basePriceInCents: changes.basePriceInCents } : {}),
            ...(changes.costInCents !== undefined ? { costInCents: changes.costInCents } : {}),
          },
        });
      }
      if (changes.weightGrams !== undefined || changes.lengthCm !== undefined || changes.widthCm !== undefined || changes.heightCm !== undefined) {
        await tx.productVariant.update({
          where: owner,
          data: {
            ...(changes.weightGrams !== undefined ? { weightGrams: changes.weightGrams } : {}),
            ...(changes.lengthCm !== undefined ? { lengthCm: changes.lengthCm } : {}),
            ...(changes.widthCm !== undefined ? { widthCm: changes.widthCm } : {}),
            ...(changes.heightCm !== undefined ? { heightCm: changes.heightCm } : {}),
          },
        });
      }
      if (changes.stockQuantity !== undefined) {
        try {
          await syncCatalogStockLedger(tx, { merchantId, variantId, quantity: changes.stockQuantity, source: "catalog_variant" });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "stock_update_failed";
          throw new ConflictException(/^(stock_|invalid_stock_|variant_not_found)/.test(reason) ? reason : "stock_update_failed");
        }
      }
      return { updated: true };
    });
    await this.eventBus?.publish({
      eventId: randomUUID(),
      schemaVersion: 1,
      eventType: "product.upserted",
      merchantId,
      payload: { id: productId, source: "variant_update" },
    }).catch((err) => {
      this.logger.warn(`Event publish failed for product ${productId}: ${err instanceof Error ? err.message : String(err)}`);
    });
    return result;
  }

  async uploadMedia(merchantId: string, body: { variantId: string; image: string }) {
    if (!body.variantId || !body.image) throw new BadRequestException("variantId_and_image_required");
    const owner = { id: body.variantId, product: { merchantId } };
    if (!await this.prisma.productVariant.findFirst({ where: owner, select: { id: true } })) throw new NotFoundException("variant_not_found");
    if (!this.s3.isConfigured()) throw new BadRequestException("s3_not_configured");
    const result = await this.s3.uploadBase64(body.image, `merchants/${merchantId}/products`);
    const media = await this.prisma.productMedia.create({
      data: { variant: { connect: owner }, url: result.url, type: "IMAGE", order: 0 },
    });
    return { id: media.id, url: media.url };
  }

  async deleteMedia(merchantId: string, mediaId: string) {
    const deleted = await this.prisma.productMedia.deleteMany({ where: { id: mediaId, variant: { product: { merchantId } } } });
    if (deleted.count !== 1) throw new NotFoundException("media_not_found");
    return { deleted: true };
  }
}
