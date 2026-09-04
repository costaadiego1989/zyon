import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { PrismaFederatedProductRepository } from "../../infrastructure/repositories/prisma-federated-product.repository.js";
import { FEDERATED_PRODUCT_REPOSITORY } from "../../domain/ports/federated-product-repository.port.js";

export const MARKETPLACE_SYNC_QUEUE = "marketplace-catalog-sync";

interface ProductSyncJobData {
  eventType: "product.upserted" | "product.deleted";
  merchantId: string;
  payload: Record<string, unknown>;
}

function redisConnection(): RedisOptions | null {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
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
    const data: ProductSyncJobData = {
      eventType: event.eventType as ProductSyncJobData["eventType"],
      merchantId: event.merchantId,
      payload: event.payload as Record<string, unknown>,
    };

    if (this.queue) {
      // Durable: push to Redis queue with retry
      await this.queue.add("sync", data, {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
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
    const product = data.payload as {
      id: string;
      name: string;
      description?: string;
      category?: string;
      priceCents: number;
      currency?: string;
      stockAvailable?: boolean;
      imageUrl?: string;
      isActive?: boolean;
    };

    if (product.isActive === false) {
      await this.federatedRepo.delete(data.merchantId, product.id);
      return;
    }

    await this.federatedRepo.upsert({
      sourceMerchantId: data.merchantId,
      sourceProductId: product.id,
      name: product.name,
      description: product.description ?? undefined,
      category: product.category ?? undefined,
      priceCents: product.priceCents,
      currency: product.currency ?? "BRL",
      stockAvailable: product.stockAvailable ?? true,
      imageUrl: product.imageUrl ?? undefined,
    });
  }

  private async handleDelete(data: ProductSyncJobData): Promise<void> {
    const { productId } = data.payload as { productId: string };
    await this.federatedRepo.delete(data.merchantId, productId);
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
    const product = data.payload as {
      id: string;
      name: string;
      description?: string;
      category?: string;
      priceCents: number;
      currency?: string;
      stockAvailable?: boolean;
      imageUrl?: string;
      isActive?: boolean;
    };

    if (product.isActive === false) {
      await this.federatedRepo.delete(data.merchantId, product.id);
      return;
    }

    await this.federatedRepo.upsert({
      sourceMerchantId: data.merchantId,
      sourceProductId: product.id,
      name: product.name,
      description: product.description ?? undefined,
      category: product.category ?? undefined,
      priceCents: product.priceCents,
      currency: product.currency ?? "BRL",
      stockAvailable: product.stockAvailable ?? true,
      imageUrl: product.imageUrl ?? undefined,
    });
  }

  private async handleDelete(data: ProductSyncJobData): Promise<void> {
    const { productId } = data.payload as { productId: string };
    await this.federatedRepo.delete(data.merchantId, productId);
  }
}

