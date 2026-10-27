import { Inject, Injectable, Logger, Optional, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { FEDERATED_PRODUCT_REPOSITORY } from "../../domain/ports/federated-product-repository.port.js";
import { PrismaFederatedProductRepository } from "../repositories/prisma-federated-product.repository.js";
import { syncCanonicalProduct } from "../../application/handlers/marketplace-catalog-sync.handler.js";
import { MarketplaceJobMetricsService } from "../marketplace-job-metrics.service.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

interface ScanResult { products: number; projections: number; failedProducts: number; failedProjections: number; }

/** Bounded scan repairs missed events, old stock and orphan projections. */
@Injectable()
export class SyncMarketplaceIndexJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncMarketplaceIndexJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<ScanResult>;
  private productCursor = "";
  private projectionCursor = "";
  private productUpperBound?: string;
  private projectionUpperBound?: string;
  private productCycleFailures = 0;
  private projectionCycleFailures = 0;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject("ProductRepositoryPort") private readonly products: ProductRepositoryPort,
    @Inject(FEDERATED_PRODUCT_REPOSITORY) private readonly federated: PrismaFederatedProductRepository,
    @Optional() private readonly metrics?: MarketplaceJobMetricsService,
  ) {}

  onModuleInit(): void {
    const tick = () => { void this.runOnce().catch(() => this.logger.error({ event: "marketplace_catalog_backfill_failed" })); };
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
    tick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => {});
  }

  runOnce(): Promise<ScanResult> {
    if (!this.running) {
      this.metrics?.start("catalog");
      this.running = this.scan().then(result => {
        this.metrics?.finish("catalog", result.failedProducts + result.failedProjections ? "partial" : "success");
        return result;
      }, error => {
        this.metrics?.finish("catalog", "failure");
        throw error;
      }).finally(() => { this.running = undefined; });
    }
    return this.running;
  }

  private async scan(): Promise<ScanResult> {
    const batchSize = 100;
    // Freeze each cycle's high watermark. Appending new products/projections
    // must not postpone retries of failed rows or inserts behind the cursor.
    // An empty scope is sampled again next tick, never drained at startup.
    const [productUpperBound, projectionUpperBound] = await Promise.all([
      this.productUpperBound ?? this.prisma.product.findFirst({ select: { id: true }, orderBy: { id: "desc" } }).then(row => row?.id),
      this.projectionUpperBound ?? this.prisma.federatedProduct.findFirst({ select: { id: true }, orderBy: { id: "desc" } }).then(row => row?.id),
    ]);
    const [products, projections] = await Promise.all([
      productUpperBound ? this.prisma.product.findMany({ where: { id: { gt: this.productCursor, lte: productUpperBound } },
        select: { id: true, merchantId: true }, orderBy: { id: "asc" }, take: batchSize }) : [],
      projectionUpperBound ? this.prisma.federatedProduct.findMany({ where: { id: { gt: this.projectionCursor, lte: projectionUpperBound } },
        select: { id: true, sourceMerchantId: true, sourceProductId: true }, orderBy: { id: "asc" }, take: batchSize }) : [],
    ]);
    let failedProducts = 0, failedProjections = 0;
    const failedRows: Array<{ scope: "products" | "projections"; merchantId: string; productId: string }> = [];
    // A poison row must not starve later pages. Every row is revisited on the
    // next bounded scan cycle, including failed rows and newly inserted IDs.
    for (const product of products) {
      try {
        await syncCanonicalProduct({ eventType: "product.upserted", merchantId: product.merchantId,
          payload: { productId: product.id } }, this.products, this.federated, this.prisma);
      } catch {
        failedProducts++;
        if (failedProducts <= 5) failedRows.push({ scope: "products", merchantId: product.merchantId, productId: product.id });
      }
    }
    for (const row of projections) {
      try {
        await syncCanonicalProduct({ eventType: "product.upserted", merchantId: row.sourceMerchantId,
          payload: { productId: row.sourceProductId } }, this.products, this.federated, this.prisma);
      } catch {
        failedProjections++;
        if (failedProjections <= 5) failedRows.push({ scope: "projections", merchantId: row.sourceMerchantId, productId: row.sourceProductId });
      }
    }
    this.productCycleFailures += failedProducts;
    this.projectionCycleFailures += failedProjections;
    this.productCursor = products.length === batchSize && products.at(-1)!.id !== productUpperBound ? products.at(-1)!.id : "";
    this.projectionCursor = projections.length === batchSize && projections.at(-1)!.id !== projectionUpperBound ? projections.at(-1)!.id : "";
    this.productUpperBound = this.productCursor ? productUpperBound : undefined;
    this.projectionUpperBound = this.projectionCursor ? projectionUpperBound : undefined;
    if (!this.productCursor) {
      this.metrics?.catalogCycle("products", this.productCycleFailures);
      this.productCycleFailures = 0;
    }
    if (!this.projectionCursor) {
      this.metrics?.catalogCycle("projections", this.projectionCycleFailures);
      this.projectionCycleFailures = 0;
    }
    const result = { products: products.length, projections: projections.length, failedProducts, failedProjections };
    if (failedProducts + failedProjections) this.logger.warn({ event: "marketplace_catalog_backfill_partial", ...result, failedRows });
    else this.logger.log({ event: "marketplace_catalog_backfill_completed", ...result });
    return result;
  }
}
