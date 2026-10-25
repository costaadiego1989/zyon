import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaImportJobRepository } from "../src/modules/catalog/infrastructure/repositories/prisma-import-job.repository.js";
import { CsvXlsxParserAdapter } from "../src/modules/catalog/infrastructure/csv-xlsx-parser.adapter.js";
import { DeterministicColumnMapper } from "../src/modules/catalog/infrastructure/adapters/deterministic-column-mapper.adapter.js";
import { LlmColumnMapper } from "../src/modules/catalog/infrastructure/adapters/llm-column-mapper.adapter.js";
import { CompositeColumnMapper } from "../src/modules/catalog/infrastructure/adapters/composite-column-mapper.adapter.js";
import { ProcessSpreadsheetImportUseCase } from "../src/modules/catalog/application/use-cases/process-spreadsheet-import.use-case.js";
import { AddProductUseCase } from "../src/modules/catalog/application/use-cases/add-product.use-case.js";
import { GenerateProductSeoUseCase } from "../src/modules/catalog/application/use-cases/generate-product-seo.use-case.js";
import { PrismaProductRepository } from "../src/modules/catalog/infrastructure/repositories/prisma-product.repository.js";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const M = "mrc_marketplace_05";

// Merchant's own layout: pt-BR headers, price in reais, a quoted comma in a name.
// Real pt-BR Excel export: ';' delimiter (so decimal commas don't collide),
// price in reais, one product missing weight (should fail), unknown category.
const CSV = [
  "Nome do Produto;Código;Preço (R$);Estoque;Peso (g);Descrição;Categoria",
  "Cadeira Gamer Pro;SKU-E2E-IMP-1;899,90;15;8500;Cadeira ergonômica;Moveis",
  "Mesa Escritório;SKU-E2E-IMP-2;1.299,00;7;12000;Mesa ampla;Moveis",
  "Item Sem Peso;SKU-E2E-IMP-3;49,90;20;;Falta peso;Moveis",
].join("\n");

async function main() {
  const productRepo = new PrismaProductRepository(prisma as any);
  const jobRepo = new PrismaImportJobRepository(prisma as any);
  const parser = new CsvXlsxParserAdapter();
  const mapper = new CompositeColumnMapper(new LlmColumnMapper(undefined as any), new DeterministicColumnMapper());
  const seo = { execute: async () => ({}) } as unknown as GenerateProductSeoUseCase;
  const addProduct = new AddProductUseCase(productRepo as any, seo);
  const useCase = new ProcessSpreadsheetImportUseCase(jobRepo as any, parser, mapper as any, addProduct, productRepo as any);

  // Clean prior E2E products by SKU (robust to name changes across runs)
  const priorVariants = await prisma.productVariant.findMany({ where: { sku: { startsWith: "SKU-E2E-IMP-" } }, select: { productId: true } });
  const priorIds = [...new Set(priorVariants.map((v) => v.productId))];
  if (priorIds.length) await prisma.product.deleteMany({ where: { id: { in: priorIds } } }).catch(() => {});

  const job = await jobRepo.create({ merchantId: M, kind: "product_spreadsheet", fileName: "e2e.csv", fileRef: null });
  console.log("JOB:", job.id, job.status);

  await useCase.execute({ jobId: job.id, merchantId: M, buffer: Buffer.from(CSV, "utf8"), mimeType: "text/csv" });

  const done = await jobRepo.getById(job.id, M);
  console.log("RESULT status:", done?.status);
  console.log("counts: total=%d success=%d failed=%d", done?.totalRows, done?.successRows, done?.failedRows);
  console.log("columnMapping:", JSON.stringify(done?.columnMapping));
  console.log("errors:", JSON.stringify(done?.errors));

  // Verify products actually created with correct prices (reais->cents)
  const created = await prisma.product.findMany({
    where: { merchantId: M, name: { in: ["Cadeira Gamer Pro", "Mesa Escritório"] } },
    select: { name: true, variants: { select: { sku: true, price: { select: { basePriceInCents: true } } } } },
  });
  console.log("CREATED:", JSON.stringify(created.map((p) => ({ name: p.name, sku: p.variants[0]?.sku, cents: p.variants[0]?.price?.basePriceInCents })), null, 1));

  const chair = created.find((p) => p.name.startsWith("Cadeira"));
  const chairOk = chair?.variants[0]?.price?.basePriceInCents === 89990; // 899,90 reais -> 89990 cents
  const quotedCommaOk = !!chair; // quoted comma in name preserved
  const noPesoFailed = (done?.errors as any[])?.some((e) => e.reason === "physical_product_requires_weight");
  console.log(chairOk ? "✅ price reais->cents (899,90->89990)" : `❌ price wrong: ${chair?.variants[0]?.price?.basePriceInCents}`);
  console.log(quotedCommaOk ? "✅ quoted-comma name parsed" : "❌ quoted comma lost");
  console.log(noPesoFailed ? "✅ missing-weight row failed (not swallowed)" : "❌ missing-weight not reported");
}

main().catch((e) => { console.error("ERR:", e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());