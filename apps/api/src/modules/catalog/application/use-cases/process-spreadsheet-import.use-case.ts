import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  IMPORT_JOB_REPOSITORY,
  type ImportJobRepositoryPort,
  type ImportJobSnapshot,
  type ImportRowError,
} from "../../domain/ports/import-job-repository.port.js";
import {
  SPREADSHEET_PARSER,
  type SpreadsheetParserPort,
} from "../../domain/ports/spreadsheet-parser.port.js";
import {
  COLUMN_MAPPER,
  type ColumnMapperPort,
} from "../../domain/ports/column-mapper.port.js";
import { normalizeRow } from "../../domain/services/import-row-normalizer.service.js";
import type {
  ProductRepositoryPort,
  CreateProductInput,
} from "../../domain/ports/product-repository.port.js";
import { AddProductUseCase } from "./add-product.use-case.js";

export interface ProcessSpreadsheetImportInput {
  jobId: string;
  merchantId: string;
  buffer: Buffer;
  mimeType: string;
}

/**
 * Strips diacritics from a string for case- and accent-insensitive category
 * matching. "Café Especial" → "cafe especial".
 */
function normalizeCategoryKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

@Injectable()
export class ProcessSpreadsheetImportUseCase {
  private readonly logger = new Logger(ProcessSpreadsheetImportUseCase.name);

  constructor(
    @Inject(IMPORT_JOB_REPOSITORY) private readonly jobRepo: ImportJobRepositoryPort,
    @Inject(SPREADSHEET_PARSER) private readonly parser: SpreadsheetParserPort,
    @Inject(COLUMN_MAPPER) private readonly mapper: ColumnMapperPort,
    private readonly addProduct: AddProductUseCase,
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
  ) {}

  async execute(input: ProcessSpreadsheetImportInput): Promise<void> {
    const { jobId, merchantId, buffer, mimeType } = input;

    // 1. Locate the job — if missing (cross-tenant or already cleaned up), do nothing.
    const job: ImportJobSnapshot | null = await this.jobRepo.getById(jobId, merchantId);
    if (!job) return;

    await this.jobRepo.update(jobId, merchantId, { status: "processing" });

    // 2. Parse the buffer.
    let headers: string[];
    let rows: Array<Record<string, string>>;
    try {
      const raw = await this.parser.parse(buffer, mimeType);
      headers = raw.headers;
      rows = raw.rows;
    } catch (err) {
      await this.jobRepo.update(jobId, merchantId, {
        status: "failed",
        errors: [{ row: 0, reason: "parse_failed" }],
        finishedAt: new Date(),
      });
      this.logger.warn(
        `Import ${jobId} for merchant ${merchantId} failed to parse: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // 3. Detect columns (first 3 rows are enough signal for the LLM + deterministic fallback).
    const { mapping, unitHints } = await this.mapper.mapColumns(headers, rows.slice(0, 3));

    // 4. Load categories once and build a name→id map (accent- and case-insensitive).
    const categories = await this.productRepo.listCategories(merchantId);
    const categoryByKey = new Map<string, string>();
    for (const cat of categories) {
      categoryByKey.set(normalizeCategoryKey(cat.name), cat.id);
    }

    // 5. Per-row normalization + import.
    const errors: ImportRowError[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowIndex = i + 1; // 1-based for error reporting.
      const result = normalizeRow({
        row: rows[i],
        mapping,
        merchantId,
        rowIndex,
        unitHints,
      });

      if (!result.ok) {
        failedCount++;
        errors.push(result.error);
        continue;
      }

      const input: CreateProductInput = { ...result.input };
      const rawCategory = result.input.categoryId;

      // Category resolution: normalizeRow returns the category NAME; resolve to id
      // if the merchant has a matching category. If not, drop it but record a
      // WARNING — the product still imports. The merchant can re-categorize later.
      if (rawCategory !== undefined && rawCategory !== "") {
        const id = categoryByKey.get(normalizeCategoryKey(rawCategory));
        if (id) {
          input.categoryId = id;
        } else {
          delete input.categoryId;
          errors.push({ row: rowIndex, reason: "category_not_found" });
          // category_not_found is a warning: it stays in errors[] but does NOT
          // increment failedCount — the product is still imported below.
        }
      }

      try {
        await this.addProduct.execute(input);
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Idempotent re-import: when the SKU already exists, update the existing
        // variant (price/weight/dimensions/stock/name) instead of failing, so
        // re-uploading the same catalog restates it rather than erroring out.
        if (message.startsWith("sku_already_exists")) {
          const v = input.variants[0];
          const updated = v
            ? await this.productRepo
                .updateVariantBySku(merchantId, v.sku, {
                  productName: input.name,
                  description: input.description,
                  categoryId: input.categoryId,
                  basePriceInCents: v.basePriceInCents,
                  weightGrams: v.weightGrams,
                  lengthCm: v.lengthCm,
                  widthCm: v.widthCm,
                  heightCm: v.heightCm,
                  stockQuantity: v.stockQuantity,
                })
                .catch(() => null)
            : null;
          if (updated) {
            successCount++;
            continue;
          }
        }
        failedCount++;
        errors.push({
          row: rowIndex,
          sku: input.variants[0]?.sku,
          reason: message,
        });
        // Swallow: a single bad row must not abort the whole import.
      }
    }

    // 6. Finalize.
    const totalRows = rows.length;
    await this.jobRepo.update(jobId, merchantId, {
      status: "completed",
      totalRows,
      successRows: successCount,
      failedRows: failedCount,
      columnMapping: mapping,
      errors,
      finishedAt: new Date(),
    });
  }
}
