import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
import { CreateCategoryUseCase } from "./create-category.use-case.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

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
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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
    @Optional() private readonly createCategory?: CreateCategoryUseCase,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
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
          try {
            input.categoryId = await this.resolveCategoryId(merchantId, rawCategory, categoryByKey);
            if (!input.categoryId) {
              delete input.categoryId;
              errors.push({ row: rowIndex, reason: "category_not_found" });
            }
          } catch (err) {
            failedCount++;
            errors.push({
              row: rowIndex,
              sku: input.variants[0]?.sku,
              reason: `category_create_failed:${err instanceof Error ? err.message : String(err)}`,
            });
            continue;
          }
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
            await this.publishProductUpserted(merchantId, updated.productId, input).catch((publishErr) => {
              this.logger.warn(`Import ${jobId} product.upserted failed for ${updated.productId}: ${publishErr instanceof Error ? publishErr.message : String(publishErr)}`);
            });
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

  private async publishProductUpserted(merchantId: string, productId: string, input: CreateProductInput): Promise<void> {
    const first = input.variants[0];
    await this.eventBus?.publish({
      eventId: randomUUID(),
      schemaVersion: 1,
      eventType: "product.upserted",
      merchantId,
      payload: {
        id: productId,
        name: input.name,
        description: input.description,
        category: input.categoryId,
        priceCents: first?.basePriceInCents ?? 0,
        currency: first?.currency ?? "BRL",
        stockAvailable: (first?.stockQuantity ?? 0) > 0,
        isActive: true,
        source: "spreadsheet_reimport",
      },
    });
  }

  private async resolveCategoryId(
    merchantId: string,
    categoryName: string,
    categoryByKey: Map<string, string>,
  ): Promise<string | undefined> {
    const key = normalizeCategoryKey(categoryName);
    const existing = categoryByKey.get(key);
    if (existing) return existing;
    // Unit consumers compiled against the older import contract may not bind
    // the category creator. Production binds it through CatalogModule.
    if (!this.createCategory) return undefined;

    try {
      const created = await this.createCategory.execute(merchantId, { name: categoryName.trim() });
      categoryByKey.set(key, created.id);
      return created.id;
    } catch (err) {
      const categories = await this.productRepo.listCategories(merchantId);
      const concurrent = categories.find((category) => normalizeCategoryKey(category.name) === key);
      if (concurrent) {
        categoryByKey.set(key, concurrent.id);
        return concurrent.id;
      }
      throw err;
    }
  }
}
