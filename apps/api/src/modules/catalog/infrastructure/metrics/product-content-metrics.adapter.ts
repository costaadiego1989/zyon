import { Injectable, Logger } from "@nestjs/common";
import {
  PRODUCT_CONTENT_METRICS,
  type ProductContentMetricsPort,
} from "../../application/services/product-content-metrics.service.js";

/**
 * Default in-process metrics adapter.
 *
 * When the project ships a real metrics backend (Prometheus/StatsD/etc.), swap
 * this implementation by providing a different binding for `PRODUCT_CONTENT_METRICS`.
 *
 * Current behavior: structured log line per increment. Cheap (single console
 * call), respects tenant boundary by always emitting `merchantId` in the tag
 * payload, and bounded cardinality thanks to the bucketization in
 * `ProductContentMetricsService.recordContentUpdated`.
 */
@Injectable()
export class ProductContentMetricsAdapter implements ProductContentMetricsPort {
  private readonly logger = new Logger("ProductContentMetrics");

  increment(name: string, tags?: Record<string, string>): void {
    const tagStr = tags ? this.serialize(tags) : "{}";
    this.logger.log(`metric name=${name} tags=${tagStr}`);
  }

  private serialize(tags: Record<string, string>): string {
    // Stable key order for log readability + easier grep-ability.
    const keys = Object.keys(tags).sort();
    return "{" + keys.map((k) => `${k}=${JSON.stringify(tags[k] ?? "")}`).join(",") + "}";
  }
}

export const PRODUCT_CONTENT_METRICS_ADAPTER = {
  provide: PRODUCT_CONTENT_METRICS,
  useClass: ProductContentMetricsAdapter,
};
