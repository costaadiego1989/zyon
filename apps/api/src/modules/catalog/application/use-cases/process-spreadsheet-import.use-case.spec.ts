import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { ProcessSpreadsheetImportUseCase } from "./process-spreadsheet-import.use-case.js";
import type {
  ImportJobRepositoryPort,
  ImportJobSnapshot,
} from "../../domain/ports/import-job-repository.port.js";
import type { SpreadsheetParserPort, RawSheet } from "../../domain/ports/spreadsheet-parser.port.js";
import type {
  ColumnMapperPort,
  ColumnMapping,
  UnitHints,
} from "../../domain/ports/column-mapper.port.js";
import type {
  ProductRepositoryPort,
  CreateProductInput,
} from "../../domain/ports/product-repository.port.js";
import { AddProductUseCase } from "./add-product.use-case.js";
import type { GenerateProductSeoUseCase } from "./generate-product-seo.use-case.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";

// ----- Fakes -----

function makeJobSnapshot(overrides: Partial<ImportJobSnapshot> = {}): ImportJobSnapshot {
  return {
    id: "job_test_1",
    merchantId: "mrc_1",
    kind: "product_spreadsheet",
    status: "queued",
    fileName: "products.csv",
    totalRows: 0,
    successRows: 0,
    failedRows: 0,
    columnMapping: {},
    errors: [],
    fileRef: null,
    createdAt: new Date("2026-09-02T00:00:00Z"),
    finishedAt: null,
    ...overrides,
  };
}

function makeJobRepoDouble(overrides: Partial<ImportJobRepositoryPort> = {}): ImportJobRepositoryPort & {
  updates: Array<NonNullable<Parameters<ImportJobRepositoryPort["update"]>[2]>>;
} {
  const updates: Array<NonNullable<Parameters<ImportJobRepositoryPort["update"]>[2]>> = [];
  return {
    create: async () => makeJobSnapshot(),
    getById: async () => makeJobSnapshot(),
    update: async (_id, _merchantId, patch) => {
      updates.push(patch);
      return makeJobSnapshot({ id: "job_test_1" });
    },
    ...overrides,
    updates,
  };
}

function makeParserDouble(sheet: RawSheet, throws: Error | null = null): SpreadsheetParserPort {
  return {
    parse: async () => {
      if (throws) throw throws;
      return sheet;
    },
  };
}

function makeMapperDouble(mapping: ColumnMapping, unitHints?: UnitHints): ColumnMapperPort {
  return {
    mapColumns: async () => ({ mapping, unitHints }),
  };
}

function makeProductRepoDouble(opts: {
  categories?: Array<{ id: string; name: string; slug: string; productCount: number }>;
} = {}): ProductRepositoryPort & {
  created: CreateProductInput[];
} {
  const created: CreateProductInput[] = [];
  return {
    create: async (input) => {
      created.push(input);
      return new ProductEntity({
        id: `prd_${created.length}`,
        merchantId: input.merchantId,
        name: input.name,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: input.variants.map((v, i) => ({
          id: `var_${created.length}_${i}`,
          sku: v.sku,
          attributes: v.attributes,
          isActive: true,
          basePriceInCents: v.basePriceInCents,
          taxPercent: 0,
          currency: v.currency ?? "BRL",
          stockQuantity: v.stockQuantity ?? 0,
          stockReserved: 0,
          media: [],
        })),
      });
    },
    findById: async () => null,
    search: async () => ({ products: [], total: 0 }),
    findExistingVariantSkus: async (_mid, skus) => {
      // Return skus already created in this run so re-import of the same sheet
      // throws "already_exists" (matches AddProduct semantics).
      const createdSkus = new Set(created.flatMap((c) => c.variants.map((v) => v.sku)));
      return skus.filter((s) => createdSkus.has(s));
    },
    update: async () => {
      throw new Error("not used");
    },
    softDelete: async () => undefined,
    addVariant: async () => {
      throw new Error("not used");
    },
    listCategories: async () => opts.categories ?? [],
    updateVariantBySku: async () => null,
    created,
  };
}

function makeAddProductUseCase(productRepo: ReturnType<typeof makeProductRepoDouble>, seo?: Partial<GenerateProductSeoUseCase>): AddProductUseCase {
  const seoUseCase = {
    execute: async () => ({
      seoTitle: null,
      metaDescription: null,
      slug: null,
      ogTitle: null,
      ogDescription: null,
      keywords: [],
    }),
    ...(seo ?? {}),
  } as unknown as GenerateProductSeoUseCase;
  return new AddProductUseCase(productRepo, seoUseCase);
}

// Standard mapping: header names match exactly the columns we set in raw sheet.
const baseMapping: ColumnMapping = {
  Nome: "name",
  SKU: "sku",
  Preço: "price",
  Peso: "weight_grams",
  Categoria: "category",
};

const baseSheet: RawSheet = {
  headers: ["Nome", "SKU", "Preço", "Peso", "Categoria"],
  rows: [
    { Nome: "Camiseta A", SKU: "SKU-A", Preço: "99,90", Peso: "300", Categoria: "Camisetas" },
    { Nome: "Camiseta B", SKU: "SKU-B", Preço: "129.00", Peso: "350", Categoria: "Camisetas" },
  ],
};

const baseInput = {
  jobId: "job_test_1",
  merchantId: "mrc_1",
  buffer: Buffer.from("ignored — faked"),
  mimeType: "text/csv",
};

describe("ProcessSpreadsheetImportUseCase", () => {
  it("happy path: 2 valid rows → 2 addProduct calls, completed with successRows 2, failedRows 0, columnMapping persisted", async () => {
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(baseSheet);
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble({
      categories: [{ id: "cat_tees", name: "Camisetas", slug: "camisetas", productCount: 0 }],
    });
    const addProduct = makeAddProductUseCase(productRepo);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct, productRepo);
    await useCase.execute(baseInput);

    assert.equal(productRepo.created.length, 2, "addProduct should be called twice");
    assert.equal(productRepo.created[0].variants[0].sku, "SKU-A");
    assert.equal(productRepo.created[0].categoryId, "cat_tees");
    assert.equal(productRepo.created[1].variants[0].sku, "SKU-B");

    // Final update persists status, mapping, counts.
    const lastUpdate = jobRepo.updates[jobRepo.updates.length - 1];
    assert.equal(lastUpdate.status, "completed");
    assert.equal(lastUpdate.totalRows, 2);
    assert.equal(lastUpdate.successRows, 2);
    assert.equal(lastUpdate.failedRows, 0);
    assert.deepEqual(lastUpdate.columnMapping, baseMapping);
    assert.deepEqual(lastUpdate.errors!, []);
    assert.ok(lastUpdate.finishedAt instanceof Date);
  });

  it("idempotent re-import: an existing SKU is UPDATED (not failed) — successRows 2, failedRows 0", async () => {
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(baseSheet);
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble({
      categories: [{ id: "cat_tees", name: "Camisetas", slug: "camisetas", productCount: 0 }],
    });
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };

    const updatedSkus: string[] = [];
    // SKU-B pre-exists AND can be updated → idempotent path: row 2 updates instead of failing.
    const existingSkuRepo: ProductRepositoryPort & { created: CreateProductInput[] } = {
      ...productRepo,
      findExistingVariantSkus: async (_mid, skus) => (skus.includes("SKU-B") ? ["SKU-B"] : []),
      updateVariantBySku: async (_mid, sku) => {
        if (sku === "SKU-B") {
          updatedSkus.push(sku);
          return { productId: "prod_existing_b" };
        }
        return null;
      },
    };
    const addProduct2 = new AddProductUseCase(existingSkuRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct2, existingSkuRepo);
    await useCase.execute(baseInput);

    // Row 1 created, row 2 (existing SKU) updated → both count as success, zero failures.
    assert.equal(existingSkuRepo.created.length, 1, "only the new SKU should be created");
    assert.equal(existingSkuRepo.created[0].variants[0].sku, "SKU-A");
    assert.deepEqual(updatedSkus, ["SKU-B"], "existing SKU-B should be updated");

    const lastUpdate = jobRepo.updates[jobRepo.updates.length - 1];
    assert.equal(lastUpdate.status, "completed");
    assert.equal(lastUpdate.totalRows, 2);
    assert.equal(lastUpdate.successRows, 2);
    assert.equal(lastUpdate.failedRows, 0);
    assert.deepEqual(lastUpdate.errors!, []);
  });

  it("existing SKU that cannot be updated (updateVariantBySku → null) is counted as failed", async () => {
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(baseSheet);
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble({
      categories: [{ id: "cat_tees", name: "Camisetas", slug: "camisetas", productCount: 0 }],
    });
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };

    const existingSkuRepo: ProductRepositoryPort & { created: CreateProductInput[] } = {
      ...productRepo,
      findExistingVariantSkus: async (_mid, skus) => (skus.includes("SKU-B") ? ["SKU-B"] : []),
      updateVariantBySku: async () => null, // update finds nothing → genuine failure
    };
    const addProduct2 = new AddProductUseCase(existingSkuRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct2, existingSkuRepo);
    await useCase.execute(baseInput);

    assert.equal(existingSkuRepo.created.length, 1);
    const lastUpdate = jobRepo.updates[jobRepo.updates.length - 1];
    assert.equal(lastUpdate.successRows, 1);
    assert.equal(lastUpdate.failedRows, 1);
    assert.equal(lastUpdate.errors![0].sku, "SKU-B");
    assert.ok(/sku_already_exists/i.test(lastUpdate.errors![0].reason));
  });

  it("normalize failure (missing name) is counted as failed, others still import", async () => {
    const sheet: RawSheet = {
      headers: baseSheet.headers,
      rows: [
        { Nome: "Has Name", SKU: "SKU-X", Preço: "10.00", Peso: "100", Categoria: "X" },
        { Nome: "", SKU: "SKU-Y", Preço: "20.00", Peso: "200", Categoria: "Y" },
        { Nome: "Another", SKU: "SKU-Z", Preço: "30.00", Peso: "300", Categoria: "Z" },
      ],
    };
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(sheet);
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble({
      categories: [
        { id: "cat_x", name: "X", slug: "x", productCount: 0 },
        { id: "cat_y", name: "Y", slug: "y", productCount: 0 },
        { id: "cat_z", name: "Z", slug: "z", productCount: 0 },
      ],
    });
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };
    const addProduct = new AddProductUseCase(productRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct, productRepo);
    await useCase.execute(baseInput);

    assert.equal(productRepo.created.length, 2, "two rows should import");
    assert.equal(productRepo.created[0].variants[0].sku, "SKU-X");
    assert.equal(productRepo.created[1].variants[0].sku, "SKU-Z");

    const lastUpdate = jobRepo.updates[jobRepo.updates.length - 1];
    assert.equal(lastUpdate.totalRows, 3);
    assert.equal(lastUpdate.successRows, 2);
    assert.equal(lastUpdate.failedRows, 1);
    assert.equal(lastUpdate.errors!.length, 1);
    assert.equal(lastUpdate.errors![0].row, 2);
    assert.equal(lastUpdate.errors![0].reason, "missing_name");
  });

  it("category resolution: known name → id; unknown name → product still imported + warning recorded (success not failure)", async () => {
    const sheet: RawSheet = {
      headers: baseSheet.headers,
      rows: [
        { Nome: "P1", SKU: "SKU-1", Preço: "10.00", Peso: "100", Categoria: "Camisetas" },
        { Nome: "P2", SKU: "SKU-2", Preço: "20.00", Peso: "200", Categoria: "CategoriaInexistente" },
      ],
    };
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(sheet);
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble({
      categories: [{ id: "cat_tees", name: "Camisetas", slug: "camisetas", productCount: 0 }],
    });
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };
    const addProduct = new AddProductUseCase(productRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct, productRepo);
    await useCase.execute(baseInput);

    assert.equal(productRepo.created.length, 2, "both products import");
    assert.equal(productRepo.created[0].categoryId, "cat_tees", "known category resolves to id");
    assert.equal(productRepo.created[1].categoryId, undefined, "unknown category → undefined");

    const lastUpdate = jobRepo.updates[jobRepo.updates.length - 1];
    assert.equal(lastUpdate.status, "completed");
    assert.equal(lastUpdate.totalRows, 2);
    assert.equal(lastUpdate.successRows, 2, "category warning is not a failure");
    assert.equal(lastUpdate.failedRows, 0, "category warning is not a failure");
    assert.equal(lastUpdate.errors!.length, 1);
    assert.equal(lastUpdate.errors![0].row, 2);
    assert.equal(lastUpdate.errors![0].reason, "category_not_found");
  });

  it("category name match is accent- and case-insensitive", async () => {
    const sheet: RawSheet = {
      headers: baseSheet.headers,
      rows: [
        { Nome: "P1", SKU: "SKU-1", Preço: "10.00", Peso: "100", Categoria: "café especial" },
      ],
    };
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(sheet);
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble({
      categories: [{ id: "cat_coffee", name: "Café Especial", slug: "cafe-especial", productCount: 0 }],
    });
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };
    const addProduct = new AddProductUseCase(productRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct, productRepo);
    await useCase.execute(baseInput);

    assert.equal(productRepo.created.length, 1);
    assert.equal(productRepo.created[0].categoryId, "cat_coffee");
    const lastUpdate = jobRepo.updates[jobRepo.updates.length - 1];
    assert.equal(lastUpdate.errors!.length, 0);
  });

  it("parse throws → job marked failed, no addProduct calls, completed NOT called", async () => {
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble({ headers: [], rows: [] }, new Error("bad sheet"));
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble();
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };
    const addProduct = new AddProductUseCase(productRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct, productRepo);
    await useCase.execute(baseInput);

    assert.equal(productRepo.created.length, 0);
    const lastUpdate = jobRepo.updates[jobRepo.updates.length - 1];
    assert.equal(lastUpdate.status, "failed");
    assert.equal(lastUpdate.errors!.length, 1);
    assert.equal(lastUpdate.errors![0].row, 0);
    assert.equal(lastUpdate.errors![0].reason, "parse_failed");
    assert.ok(lastUpdate.finishedAt instanceof Date);
  });

  it("job not found → no-op (does not call update)", async () => {
    const jobRepo = makeJobRepoDouble({
      getById: async () => null,
    });
    const parser = makeParserDouble(baseSheet);
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble();
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };
    const addProduct = new AddProductUseCase(productRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct, productRepo);
    await useCase.execute(baseInput);

    assert.equal(productRepo.created.length, 0);
    assert.equal(jobRepo.updates.length, 0);
  });

  it("uses the mapping returned by the mapper (and its unitHints)", async () => {
    // Mapping puts price in cents (not reais) and weight in kg — the impl
    // must pass unitHints straight into normalizeRow.
    const mapping: ColumnMapping = {
      Nome: "name",
      SKU: "sku",
      Preço: "price",
      Peso: "weight_grams",
    };
    const sheet: RawSheet = {
      headers: ["Nome", "SKU", "Preço", "Peso"],
      rows: [{ Nome: "P1", SKU: "SKU-1", Preço: "1000", Peso: "0.5" }], // 1000 cents, 0.5 kg
    };
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(sheet);
    const mapper = makeMapperDouble(mapping, { priceInReais: false, weightInKg: true });
    const productRepo = makeProductRepoDouble();
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };
    const addProduct = new AddProductUseCase(productRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct, productRepo);
    await useCase.execute(baseInput);

    assert.equal(productRepo.created.length, 1);
    const variant = productRepo.created[0].variants[0];
    assert.equal(variant.basePriceInCents, 1000, "priceInReais=false → keep as cents");
    assert.equal(variant.weightGrams, 500, "weightInKg=true → 0.5 kg → 500g");
  });

  it("status transitions: queued → processing → completed", async () => {
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(baseSheet);
    const mapper = makeMapperDouble(baseMapping);
    const productRepo = makeProductRepoDouble({
      categories: [{ id: "cat_tees", name: "Camisetas", slug: "camisetas", productCount: 0 }],
    });
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };
    const addProduct = new AddProductUseCase(productRepo, seoStub as unknown as GenerateProductSeoUseCase);

    const useCase = new ProcessSpreadsheetImportUseCase(jobRepo, parser, mapper, addProduct, productRepo);
    await useCase.execute(baseInput);

    const statuses = jobRepo.updates.map((u) => u.status);
    assert.equal(statuses[0], "processing");
    assert.equal(statuses[statuses.length - 1], "completed");
  });

  it("ConflictException from addProduct is captured (not thrown)", async () => {
    // No category column → the only error should be the conflict (not a category warning).
    const mapping: ColumnMapping = { Nome: "name", SKU: "sku", Preço: "price", Peso: "weight_grams" };
    const sheet: RawSheet = {
      headers: ["Nome", "SKU", "Preço", "Peso"],
      rows: [{ Nome: "P1", SKU: "SKU-A", Preço: "10.00", Peso: "100" }],
    };
    const jobRepo = makeJobRepoDouble();
    const parser = makeParserDouble(sheet);
    const mapper = makeMapperDouble(mapping);
    const productRepo = makeProductRepoDouble();
    const seoStub = { execute: async () => ({ seoTitle: null, metaDescription: null, slug: null, ogTitle: null, ogDescription: null, keywords: [] }) };
    const realAdd = new AddProductUseCase(productRepo, seoStub as unknown as GenerateProductSeoUseCase);
    const failingAdd = {
      execute: async (_input: CreateProductInput) => {
        throw new ConflictException("sku_already_exists:SKU-A");
      },
    };

    const useCase = new ProcessSpreadsheetImportUseCase(
      jobRepo,
      parser,
      mapper,
      failingAdd as unknown as AddProductUseCase,
      productRepo,
    );
    // must not throw
    await useCase.execute(baseInput);

    assert.equal(productRepo.created.length, 0);
    const lastUpdate = jobRepo.updates[jobRepo.updates.length - 1];
    assert.equal(lastUpdate.status, "completed");
    assert.equal(lastUpdate.successRows, 0);
    assert.equal(lastUpdate.failedRows, 1);
    assert.equal(lastUpdate.errors![0].row, 1);
    assert.equal(lastUpdate.errors![0].sku, "SKU-A");
    assert.ok(/sku_already_exists/.test(lastUpdate.errors![0].reason));

    void realAdd;
  });
});
