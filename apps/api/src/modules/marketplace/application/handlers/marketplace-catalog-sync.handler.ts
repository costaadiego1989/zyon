import { Injectable, Inject, Optional, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { PrismaFederatedProductRepository } from "../../infrastructure/repositories/prisma-federated-product.repository.js";
import { FEDERATED_PRODUCT_REPOSITORY } from "../../domain/ports/federated-product-repository.port.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { isMarketplaceVariantPrice, marketplaceVariantInStock } from "../../domain/services/marketplace-variant.js";
import { assertMarketplaceProductOptions } from "../../domain/services/marketplace-product-options.js";
import { extractOptionGroups, resolveSelectedOptions } from "../../../storefront/domain/food-options.js";

export const MARKETPLACE_SYNC_QUEUE = "marketplace-catalog-sync";

export interface ProductSyncJobData {
  eventType: "product.upserted" | "product.deleted";
  merchantId: string;
  eventId?: string;
  schemaVersion?: number;
  payload: Record<string, unknown>;
}

export function marketplaceCatalogSyncJobId(eventId: string): string {
  // BullMQ job IDs must not contain colons. Hashing also keeps IDs bounded when
  // the upstream event format changes.
  return `marketplace-catalog-${createHash("sha256").update(eventId).digest("hex")}`;
}

export function redisConnection(): RedisOptions | null {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export async function syncCanonicalProduct(
  data: ProductSyncJobData,
  productRepo: ProductRepositoryPort,
  federatedRepo: PrismaFederatedProductRepository,
  prisma: Pick<PrismaClient, "productVariant">,
): Promise<void> {
  const productId = data.payload.productId ?? data.payload.id;
  if (typeof productId !== "string" || !productId) {
    throw new Error("marketplace_catalog_sync_product_id_required");
  }

  // Events are invalidations, not the source of truth. Reading the canonical
  // product at handling time makes delete-v3 followed by stale upsert-v2
  // converge to the current catalog state even when the queue reorders jobs.
  const product = await productRepo.findById(data.merchantId, productId);
  // A request-scoped tenant middleware may pin a repository read to its
  // caller. Never copy that caller's product into an event's other merchant.
  if (product && product.merchantId !== data.merchantId) {
    throw new Error("marketplace_catalog_sync_merchant_mismatch");
  }
  if (!product || !product.isActive) {
    await federatedRepo.delete(data.merchantId, productId);
    return;
  }
  const rows = await prisma.productVariant.findMany({ where: { productId, isActive: true,
    product: { merchantId: data.merchantId, isActive: true, deletedAt: null } }, orderBy: { id: "asc" }, take: 51,
    include: { product: true, price: true, stock: true, media: { where: { type: "IMAGE" }, orderBy: { order: "asc" }, take: 1 } } });
  if (rows.some(row => row.productId !== productId || row.product.id !== productId || row.product.merchantId !== data.merchantId)) {
    throw new Error("marketplace_catalog_sync_merchant_mismatch");
  }
  const canonical = rows[0]?.product;
  const variants = rows.filter(v => v.isActive && v.product.isActive && !v.product.deletedAt && isMarketplaceVariantPrice(v.price?.basePriceInCents, v.price?.currency));
  let requiresOptions = false;
  try { assertMarketplaceProductOptions(canonical?.metadata); resolveSelectedOptions(extractOptionGroups(canonical?.metadata), []); } catch { requiresOptions = true; }
  if (!canonical || !variants.length || rows.length > 50 || requiresOptions) {
    await federatedRepo.delete(data.merchantId, productId);
    return;
  }
  const available = variants.filter(v => marketplaceVariantInStock(canonical.type, v.stock));
  const variant = [...(available.length ? available : variants)].sort((a, b) => a.price!.basePriceInCents - b.price!.basePriceInCents || a.id.localeCompare(b.id))[0]!;

  await federatedRepo.upsert({
    sourceMerchantId: data.merchantId,
    sourceProductId: product.id,
    name: canonical.name,
    description: canonical.description ?? undefined,
    category: canonical.categoryId ?? undefined,
    priceCents: variant.price!.basePriceInCents,
    currency: variant.price!.currency,
    stockAvailable: available.length > 0,
    imageUrl: variant.media?.find((m) => m.type === "IMAGE")?.url,
  });
}

/**
 * BullMQ-based sync handler: Catalog domain events → Federated Product Index.
 *
 * Flow:
 * 1. CatalogModule emits product.upserted/deleted via DOMAIN_EVENT_BUS
 * 2. This handler pushes job to BullMQ queue (durable, retryable)
 * 3. Worker processes job: upserts/deletes from federated_products table
 *
 * If Redis unavailable: falls back to in-process sync (same as before).
 * When migrating to microservices: replace DOMAIN_EVENT_BUS → RabbitMQ consumer,
 * BullMQ queue stays internal to Marketplace service.
 */
@Injectable()
export class MarketplaceCatalogSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceCatalogSyncScheduler.name);
  private readonly queue: Queue<ProductSyncJobData> | null;

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(FEDERATED_PRODUCT_REPOSITORY)
    private readonly federatedRepo: PrismaFederatedProductRepository,
    @Inject("ProductRepositoryPort")
    private readonly productRepo: ProductRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() private readonly tenantContext?: TenantContextService,
  ) {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<ProductSyncJobData>(MARKETPLACE_SYNC_QUEUE, { connection })
      : null;
  }

  onModuleInit(): void {
    // Subscribe to domain events → enqueue to BullMQ (or process inline)
    this.eventBus.subscribe(
      "product.upserted",
      (event) => this.enqueue(event),
      "marketplace.catalog-sync.upserted",
    );

    this.eventBus.subscribe(
      "product.deleted",
      (event) => this.enqueue(event),
      "marketplace.catalog-sync.deleted",
    );

    this.logger.log(
      this.queue
        ? "Subscribed to catalog events → BullMQ queue"
        : "Subscribed to catalog events → in-process sync (no Redis)",
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private async enqueue(event: DomainEvent): Promise<void> {
    const currentTenant = this.tenantContext?.get();
    if (currentTenant && currentTenant.merchantId !== event.merchantId) {
      throw new Error("marketplace_catalog_sync_merchant_mismatch");
    }
    const data: ProductSyncJobData = {
      eventType: event.eventType as ProductSyncJobData["eventType"],
      merchantId: event.merchantId,
      eventId: event.eventId,
      schemaVersion: event.schemaVersion,
      payload: event.payload as Record<string, unknown>,
    };

    if (this.queue) {
      // Durable: push to Redis queue with retry
      await this.queue.add("sync", data, {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
        ...(data.eventId ? { jobId: marketplaceCatalogSyncJobId(data.eventId) } : {}),
      });
    } else {
      // Fallback: process inline (no Redis)
      await this.processSync(data);
    }
  }

  /** Direct sync (used as fallback when Redis unavailable) */
  private async processSync(data: ProductSyncJobData): Promise<void> {
    if (data.eventType === "product.upserted") {
      await this.handleUpsert(data);
    } else if (data.eventType === "product.deleted") {
      await this.handleDelete(data);
    }
  }

  private async handleUpsert(data: ProductSyncJobData): Promise<void> {
    await syncCanonicalProduct(data, this.productRepo, this.federatedRepo, this.prisma);
  }

  private async handleDelete(data: ProductSyncJobData): Promise<void> {
    await syncCanonicalProduct(data, this.productRepo, this.federatedRepo, this.prisma);
  }
}

/**
 * BullMQ Worker that drains the marketplace-catalog-sync queue.
 * Runs only when Redis is configured.
 */
@Injectable()
export class MarketplaceCatalogSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceCatalogSyncWorker.name);
  private worker: Worker<ProductSyncJobData> | null = null;

  constructor(
    @Inject(FEDERATED_PRODUCT_REPOSITORY)
    private readonly federatedRepo: PrismaFederatedProductRepository,
    @Inject("ProductRepositoryPort")
    private readonly productRepo: ProductRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    const connection = redisConnection();
    if (!connection) return;

    this.worker = new Worker<ProductSyncJobData>(
      MARKETPLACE_SYNC_QUEUE,
      async (job: Job<ProductSyncJobData>) => {
        const { data } = job;
        if (data.eventType === "product.upserted") {
          await this.handleUpsert(data);
        } else if (data.eventType === "product.deleted") {
          await this.handleDelete(data);
        }
      },
      { connection, concurrency: 5 },
    );

    this.worker.on("failed", (job, err) => {
      this.logger.warn(`Sync job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log("BullMQ worker started for marketplace-catalog-sync");
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async handleUpsert(data: ProductSyncJobData): Promise<void> {
    await syncCanonicalProduct(data, this.productRepo, this.federatedRepo, this.prisma);
  }

  private async handleDelete(data: ProductSyncJobData): Promise<void> {
    await syncCanonicalProduct(data, this.productRepo, this.federatedRepo, this.prisma);
  }
}

