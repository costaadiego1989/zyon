import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { Readable } from "node:stream";
import {
  type ProductRepositoryPort,
  SearchProductsResult,
} from "../../catalog/domain/ports/product-repository.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../merchant/domain/ports/merchant-repository.port.js";
import { ProductFeedMapper, type MerchantFeedRow } from "./product-feed.mapper.js";
import { ProductFeedCsvExporter, ProductFeedJsonExporter } from "./product-feed.exporter.js";

export type FeedFormat = "csv" | "json";

export interface ProductFeedServiceOptions {
  merchantId: string;
  format: FeedFormat;
  limit?: number;
  cursor?: string;
  publicBaseUrl?: string;
  maxPages?: number;
}

export interface ProductFeedResponse {
  stream: Readable;
  contentType: string;
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    rowsTotal: number;
  };
}

/**
 * Default and maximum page sizes. We deliberately cap per-page regardless of the
 * caller's request — export endpoints should not let an anonymous consumer pull
 * the full catalog in a single roundtrip.
 */
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const DEFAULT_MAX_PAGES = 50;

/**
 * Streams the Google Merchant Feed for a single merchant.
 *
 * Tenant scoping is enforced upstream: the caller passes the merchantId. This
 * service never falls back to "all merchants" or to a default — discovery of
 * which merchant to export from lives in the controller (it honors a query
 * param, an `X-Merchant-Id` header, and finally the configured default).
 *
 * Auth: none — the controller marks the route `@PublicRoute()`. AI platforms
 * fetch product feeds anonymously after discovering them via `/.well-known/ucp`.
 */
@Injectable()
export class ProductFeedService {
  private readonly logger = new Logger(ProductFeedService.name);

  constructor(
    @Inject("ProductRepositoryPort") private readonly products: ProductRepositoryPort,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
  ) {}

  /**
   * Look up a merchant's display name for the `brand` column.
   * Returns null when the merchant is not found — caller falls back to id.
   */
  async resolveBrandName(merchantId: string): Promise<string | null> {
    try {
      const profile = await this.merchants.getProfile(merchantId);
      return profile?.name ?? null;
    } catch (err) {
      this.logger.warn(
        `merchant lookup failed for ${merchantId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Stream CSV/JSON for the merchant. Pulls pages lazily until:
   *   - the repository returns no `nextCursor`, or
   *   - `maxPages` is reached (defensive cap against runaway catalogs)
   */
  async stream(options: ProductFeedServiceOptions): Promise<ProductFeedResponse> {
    if (!options.merchantId) {
      throw new NotFoundException({ message: "merchant_not_found" });
    }

    const format: FeedFormat = options.format === "json" ? "json" : "csv";
    const requestedLimit = Math.min(
      Math.max(1, options.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);

    const brandName = await this.resolveBrandName(options.merchantId);

    const rows: MerchantFeedRow[] = [];
    let nextCursor: string | undefined = options.cursor;
    let pagesRead = 0;
    let lastTotal = 0;
    let lastNextCursor: string | undefined;

    while (pagesRead < maxPages) {
      const page: SearchProductsResult = await this.products.search({
        merchantId: options.merchantId,
        limit: requestedLimit,
        cursor: nextCursor,
      });

      lastTotal = page.total;

      for (const product of page.products) {
        const row = ProductFeedMapper.toFeedRow({
          product: product as unknown as Parameters<typeof ProductFeedMapper.toFeedRow>[0]["product"],
          merchantId: options.merchantId,
          brandName: brandName ?? undefined,
          publicBaseUrl: options.publicBaseUrl,
        });
        if (row) rows.push(row);
      }

      lastNextCursor = page.nextCursor;
      if (!page.nextCursor) break;
      nextCursor = page.nextCursor;
      pagesRead += 1;
    }

    const stream =
      format === "json"
        ? ProductFeedJsonExporter.toStream(rows)
        : ProductFeedCsvExporter.toStream(rows);

    return {
      stream,
      contentType:
        format === "json"
          ? "application/x-ndjson; charset=utf-8"
          : "text/csv; charset=utf-8",
      pagination: {
        nextCursor: lastNextCursor ?? null,
        hasMore: !!lastNextCursor,
        rowsTotal: lastTotal,
      },
    };
  }
}

export const PRODUCT_FEED_LIMITS = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_MAX_PAGES,
} as const;
