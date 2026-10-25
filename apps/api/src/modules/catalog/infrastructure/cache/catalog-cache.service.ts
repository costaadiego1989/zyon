/**
 * Redis cache service for catalog data.
 *
 * Cache patterns:
 *   - Product by ID: `product:{merchantId}:{productId}` TTL 5min
 *   - Product search: `search:{merchantId}:{queryHash}` TTL 2min
 *   - Categories: `categories:{merchantId}` TTL 10min
 *
 * Graceful fallback: if Redis unavailable, skip cache (no error thrown)
 */

import { Injectable, Inject, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { ProductEntity } from "../../domain/entities/product.entity.js";
import type { SearchProductsResult } from "../../domain/ports/product-repository.port.js";

const REDIS_CLIENT_TOKEN = "REDIS_CLIENT";

type RedisClient = any; // ioredis v5 ESM compatibility

export interface ProductCacheEntry {
  id: string;
  merchantId: string;
  name: string;
  description?: string;
  categoryId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  variants: unknown[];
  averageRating?: number;
  reviewCount?: number;
}

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);
  private readonly productTtl = 300; // 5 minutes
  private readonly searchTtl = 120; // 2 minutes
  private readonly categoriesTtl = 600; // 10 minutes

  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: RedisClient | null
  ) {}

  /**
   * Get cached product by ID.
   * Returns null if not in cache or Redis unavailable.
   */
  async getCachedProduct(merchantId: string, productId: string): Promise<ProductEntity | null> {
    if (!this.redis) return null;

    try {
      const key = `product:${merchantId}:${productId}`;
      const cached = await this.redis.get(key);
      if (!cached) return null;

      const data: ProductCacheEntry = JSON.parse(cached);
      return new ProductEntity({
        id: data.id,
        merchantId: data.merchantId,
        name: data.name,
        description: data.description,
        categoryId: data.categoryId,
        isActive: data.isActive,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        variants: data.variants as any,
        averageRating: data.averageRating,
        reviewCount: data.reviewCount,
      });
    } catch (error) {
      // Cache miss or parse error — log and return null
      this.logger.debug(`Cache miss or error for product ${productId}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Set product in cache.
   */
  async setCachedProduct(product: ProductEntity): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `product:${product.merchantId}:${product.id}`;
      const data: ProductCacheEntry = {
        id: product.id,
        merchantId: product.merchantId,
        name: product.name,
        description: product.description,
        categoryId: product.categoryId,
        isActive: product.isActive,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
        variants: product.variants,
        averageRating: product.averageRating,
        reviewCount: product.reviewCount,
      };
      await this.redis.setex(key, this.productTtl, JSON.stringify(data));
    } catch (error) {
      this.logger.warn(`Failed to cache product ${product.id}: ${(error as Error).message}`);
    }
  }

  /**
   * Get cached search results.
   */
  async getCachedSearch(merchantId: string, queryHash: string): Promise<SearchProductsResult | null> {
    if (!this.redis) return null;

    try {
      const key = `search:${merchantId}:${queryHash}`;
      const cached = await this.redis.get(key);
      if (!cached) return null;

      return JSON.parse(cached) as SearchProductsResult;
    } catch (error) {
      this.logger.debug(`Cache miss or error for search ${queryHash}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Set search results in cache.
   */
  async setCachedSearch(
    merchantId: string,
    queryHash: string,
    result: SearchProductsResult
  ): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `search:${merchantId}:${queryHash}`;
      await this.redis.setex(key, this.searchTtl, JSON.stringify(result));
    } catch (error) {
      this.logger.warn(`Failed to cache search ${queryHash}: ${(error as Error).message}`);
    }
  }

  /**
   * Compute hash of a query string for cache key.
   */
  hashQuery(query: string): string {
    return createHash("sha256").update(query).digest("hex").substring(0, 16);
  }

  /**
   * Invalidate product from cache.
   */
  async invalidateProduct(merchantId: string, productId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `product:${merchantId}:${productId}`;
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`Failed to invalidate product ${productId}: ${(error as Error).message}`);
    }
  }

  /**
   * Invalidate all cache keys for a merchant (flush pattern).
   */
  async invalidateMerchant(merchantId: string): Promise<void> {
    if (!this.redis) return;

    try {
      // Flush keys matching pattern: product:{merchantId}:*, search:{merchantId}:*, categories:{merchantId}
      const cursor = "0";
      let nextCursor: string;
      let count = 0;

      // Product keys
      const productPattern = `product:${merchantId}:*`;
      nextCursor = cursor;
      do {
        const [newCursor, keys] = await (this.redis as any).scan(
          nextCursor,
          "MATCH",
          productPattern,
          "COUNT",
          100
        );
        if (keys.length > 0) {
          await this.redis.del(...keys);
          count += keys.length;
        }
        nextCursor = newCursor;
      } while (nextCursor !== "0");

      // Search keys
      const searchPattern = `search:${merchantId}:*`;
      nextCursor = cursor;
      do {
        const [newCursor, keys] = await (this.redis as any).scan(
          nextCursor,
          "MATCH",
          searchPattern,
          "COUNT",
          100
        );
        if (keys.length > 0) {
          await this.redis.del(...keys);
          count += keys.length;
        }
        nextCursor = newCursor;
      } while (nextCursor !== "0");

      // Categories
      const categoriesKey = `categories:${merchantId}`;
      await this.redis.del(categoriesKey);

      this.logger.log(`Invalidated ${count} cache entries for merchant ${merchantId}`);
    } catch (error) {
      this.logger.warn(`Failed to invalidate merchant ${merchantId}: ${(error as Error).message}`);
    }
  }
}
