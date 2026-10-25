import { Readable } from "node:stream";
import type { MerchantFeedRow } from "./product-feed.mapper.js";
import { ProductFeedMapper } from "./product-feed.mapper.js";

/**
 * Serialize rows to RFC-4180 CSV with stable header order.
 *
 * No external CSV lib — keeps the dep graph small and the output
 * deterministic. Quotes any field containing `,`, `"`, CR, or LF; escapes
 * embedded double-quotes by doubling them.
 *
 * Output is a Node Readable that emits `text/csv; charset=utf-8` content.
 */
export class ProductFeedCsvExporter {
  static readonly HEADER_LINE =
    ProductFeedMapper.FIELDS.join(",") + "\n";

  static escapeField(value: string): string {
    if (value.length === 0) return "";
    const needsQuotes = /[",\r\n]/.test(value);
    if (!needsQuotes) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }

  static rowToCsv(row: MerchantFeedRow): string {
    const fields = ProductFeedMapper.FIELDS.map((field) =>
      ProductFeedCsvExporter.escapeField(row[field] ?? ""),
    );
    return fields.join(",") + "\n";
  }

  /**
   * Build a Readable that emits the header followed by one CSV line per row.
   * Yields at most `chunkSize` rows per push so very large feeds stay under
   * the stream high-water mark.
   */
  static toStream(rows: MerchantFeedRow[], chunkSize = 500): Readable {
    const safeChunkSize = Math.max(1, chunkSize);
    let index = 0;
    let headerSent = false;

    return new Readable({
      read() {
        if (!headerSent) {
          this.push(ProductFeedCsvExporter.HEADER_LINE);
          headerSent = true;
          return;
        }
        if (index >= rows.length) {
          this.push(null);
          return;
        }
        const slice = rows.slice(index, index + safeChunkSize);
        index += slice.length;
        let buffer = "";
        for (const row of slice) {
          buffer += ProductFeedCsvExporter.rowToCsv(row);
        }
        this.push(buffer);
        if (index >= rows.length) {
          this.push(null);
        }
      },
    });
  }
}

/**
 * Serialize rows as newline-delimited JSON (`.ndjson`).
 * Each line is a single row object — easy to stream and parse.
 */
export class ProductFeedJsonExporter {
  static toStream(rows: MerchantFeedRow[], chunkSize = 500): Readable {
    const safeChunkSize = Math.max(1, chunkSize);
    let index = 0;

    return new Readable({
      read() {
        if (index >= rows.length) {
          this.push(null);
          return;
        }
        const slice = rows.slice(index, index + safeChunkSize);
        index += slice.length;
        let buffer = "";
        for (const row of slice) {
          buffer += JSON.stringify(row) + "\n";
        }
        this.push(buffer);
        if (index >= rows.length) {
          this.push(null);
        }
      },
    });
  }
}
