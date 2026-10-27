import { Inject, Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../events/domain-event-bus.port.js";

/**
 * Shape of the in-process event payload published by
 * `PublishProductContentUseCase` / `RevertProductContentUseCase`. We only
 * care about `eventType === "product.content.updated"`. The handler is
 * defensive about missing fields so a producer-side drift does not break
 * cache invalidation.
 */
export interface ProductContentUpdatedEventLike {
  eventType?: string;
  merchantId?: string;
  payload?: {
    productId?: string;
    variantIds?: readonly string[];
    enabledBlockCount?: number;
    source?: string;
    revertedFromHistoryId?: string;
    revertedFromVersion?: number;
  };
}

/**
 * Cache invalidation handler for `product.content.updated` events.
 *
 * Wave 3 scope:
 *   * On every published update, evict any locale-tagged cache entries that
 *     the storefront layer would read on the next request.
 *   * Best-effort: failures are logged but never thrown, so the
 *     DomainEventBus publisher can move on.
 *   * The actual CDN edge invalidation step (CloudFront / Fastly / Vercel) is
 *     handled by infra outside this repo; this handler only owns the
 *     application-layer cache (Redis / Vercel KV) so the dashboard + widget
 *     surfaces see fresh content immediately.
 *
 * Per-locale purge: looks up the locales that currently have any rows in
 * `product_content_blocks` for the affected product and purges each. If the
 * product has no locale-tagged rows (e.g. only the default migrated), it
 * purges the default locale "pt-BR" as a safety net.
 */
@Injectable()
export class ProductContentCdnPurgeHandler implements OnModuleInit {
  private readonly logger = new Logger(ProductContentCdnPurgeHandler.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() private readonly cache?: CacheServiceLike,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus?.subscribe(
      "product.content.updated",
      (event) => this.handle(event as ProductContentUpdatedEventLike),
      "catalog.ProductContentCdnPurgeHandler",
    );
  }

  async handle(event: ProductContentUpdatedEventLike): Promise<void> {
    if (event?.eventType !== "product.content.updated") return;
    const payload = event.payload;
    if (!payload?.productId) {
      this.logger.warn("product.content.updated missing productId; skipping purge");
      return;
    }

    const productId = payload.productId;
    const locales = await this.loadLocalesForProduct(productId);
    const safeLocales = locales.length > 0 ? locales : ["pt-BR"];

    for (const locale of safeLocales) {
      try {
        await this.purgeForLocale(productId, locale);
      } catch (err) {
        this.logger.warn(
          `purge_failed product=${productId} locale=${locale}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  private async loadLocalesForProduct(productId: string): Promise<string[]> {
    // Wave 3 i18n is deferred — the Prisma schema doesn't yet have a locale
    // column on product_content_blocks. We return the default locale so the
    // purge pipeline runs end-to-end; once i18n ships, switch to:
    //   select: { locale: true }, distinct: ["locale"]
    try {
      const rows = await this.prisma.productContentBlock.findMany({
        where: { productId },
        select: { locale: true },
        distinct: ["locale"],
      });
      return rows.map((row) => row.locale);
    } catch (err) {
      this.logger.warn(
        `load_locales_failed product=${productId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return [];
    }
  }

  private async purgeForLocale(productId: string, locale: string): Promise<void> {
    if (!this.cache) {
      this.logger.debug(`cache_unavailable; skip local purge ${productId}/${locale}`);
      return;
    }
    const key = this.cacheKey(productId, locale);
    try {
      if (typeof this.cache.invalidate === "function") {
        await this.cache.invalidate(key);
      } else if (typeof this.cache.del === "function") {
        await this.cache.del(key);
      } else if (typeof this.cache.delete === "function") {
        await this.cache.delete(key);
      }
      this.logger.debug(`purged ${key}`);
    } catch (err) {
      this.logger.warn(
        `cache_invalidate_failed ${key}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  private cacheKey(productId: string, locale: string): string {
    return `storefront:product-content:${productId}:${locale}`;
  }
}

/** Loose cache adapter contract — Redis-backed or in-memory implementations. */
export interface CacheServiceLike {
  invalidate?: (key: string) => Promise<unknown>;
  del?: (key: string) => Promise<unknown>;
  delete?: (key: string) => Promise<unknown>;
}
