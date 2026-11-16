import "reflect-metadata";
import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { ProductContentController } from "./product-content.controller.js";
import { StorefrontProductContentController } from "../../../storefront/presentation/http/storefront-product-content.controller.js";
import { GetProductContentUseCase } from "../../application/use-cases/get-product-content.use-case.js";
import { PrismaProductContentRepository } from "../../infrastructure/repositories/prisma-product-content.repository.js";
import { PrismaProductFaqRepository } from "../../infrastructure/repositories/prisma-product-faq.repository.js";
import { PrismaProductTestimonialRepository } from "../../infrastructure/repositories/prisma-product-testimonial.repository.js";
import { PrismaProductVideoRepository } from "../../infrastructure/repositories/prisma-product-video.repository.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => { await db.$disconnect(); });
async function fixture(t: TestContext) {
  const merchantId = "qa_athom_visibility_" + randomUUID(), slug = "qa-visibility-" + randomUUID();
  await db.merchant.create({ data: { id: merchantId, name: "Visibility QA", storeSlug: slug } });
  t.after(async () => { assert.ok(merchantId.startsWith("qa_athom_visibility_"));
    await db.product.deleteMany({ where: { merchantId } }); await db.merchant.delete({ where: { id: merchantId } }); });
  const product = await db.product.create({ data: { merchantId, name: "Content QA", type: "digital",
    faqs: { create: { question: "Public question?", answer: "Public answer", isPublished: true } },
    contentBlocks: { create: { type: "paragraph", props: { text: "Published block" }, isEnabled: true } },
    testimonials: { create: [
      { authorName: "Approved", body: "Published testimonial", isPublished: true, moderationStatus: "approved" },
      { authorName: "Pending", body: "Never public", isPublished: true, moderationStatus: "pending" },
    ] }, videos: { create: { title: "Public video", videoUrl: "https://www.youtube.com/watch?v=example", isPublished: true, moderationStatus: "approved" } },
  } });
  const repos = [new PrismaProductContentRepository(db), new PrismaProductFaqRepository(db), new PrismaProductTestimonialRepository(db), new PrismaProductVideoRepository(db)] as const;
  const admin = new ProductContentController(db, {} as never, {} as never, {} as never, ...repos);
  const storefront = new StorefrontProductContentController(db, new GetProductContentUseCase(...repos),
    { getEffectivePlan: async () => "growth" } as never, { suggest: async () => undefined } as never);
  return { merchantId, product, admin, publicRead: () => storefront.getContent(slug, product.id, "pt-BR") };
}

test("content visibility persists independently and public projection honors both flags without deleting content", async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.admin.getContent(f.merchantId, f.product.id)).visibility, { enabled: true, testimonialsVisible: false });
  let content = await f.publicRead();
  assert.equal(content.faqs.length, 1); assert.equal(content.blocks.length, 1); assert.equal(content.videos.length, 1); assert.deepEqual(content.testimonials, []);
  await f.admin.updateVisibility(f.merchantId, f.product.id, { testimonialsVisible: true });
  content = await f.publicRead();
  assert.deepEqual(content.testimonials.map(item => item.authorName), ["Approved"]);
  const purchase = content.purchase;
  await f.admin.updateVisibility(f.merchantId, f.product.id, { enabled: false });
  content = await f.publicRead();
  assert.deepEqual([content.blocks, content.faqs, content.videos, content.testimonials], [[], [], [], []]);
  assert.deepEqual(content.purchase, purchase);
  assert.deepEqual((await f.admin.getContent(f.merchantId, f.product.id)).visibility, { enabled: false, testimonialsVisible: true });
  await f.admin.updateVisibility(f.merchantId, f.product.id, { enabled: true });
  assert.deepEqual((await f.publicRead()).testimonials.map(item => item.authorName), ["Approved"]);
  assert.equal(await db.productTestimonial.count({ where: { productId: f.product.id } }), 2);
  assert.equal(await db.productFaq.count({ where: { productId: f.product.id } }), 1);
});

test("content visibility rejects foreign product and forged or nonboolean fields without writes", async t => {
  const f = await fixture(t);
  const rejected = (status: number, code: string) => (error: unknown) => {
    const failure = error as { getStatus(): number; getResponse(): unknown };
    assert.equal(failure.getStatus(), status); assert.deepEqual(failure.getResponse(), { code }); return true;
  };
  await assert.rejects(f.admin.updateVisibility("foreign", f.product.id, { enabled: false }), rejected(404, "product_not_found"));
  for (const body of [{}, { enabled: "false" }, { testimonialsVisible: null }, { enabled: false, merchantId: "foreign" }, [], null]) {
    await assert.rejects(f.admin.updateVisibility(f.merchantId, f.product.id, body), rejected(400, "product_content_visibility_invalid"));
  }
  assert.deepEqual((await f.admin.getContent(f.merchantId, f.product.id)).visibility, { enabled: true, testimonialsVisible: false });
  const guards = Reflect.getMetadata("__guards__", ProductContentController.prototype.updateVisibility);
  assert.deepEqual(guards.map((g: { name: string }) => g.name), ["AuthGuard", "MerchantOwnershipGuard", "PlanLimitGuard"]);
});

test("actual visibility migration preserves legacy rows and defaults new rows off", async () => {
  const sql = readFileSync("prisma/deploy-migrations/20261116202000_product_content_visibility/migration.sql", "utf8");
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "qa_visibility_migration" (id TEXT PRIMARY KEY) ON COMMIT DROP');
    await tx.$executeRawUnsafe('INSERT INTO "qa_visibility_migration" (id) VALUES (\'legacy\')');
    for (const statement of sql.replaceAll('"products"', '"qa_visibility_migration"').split(';').filter(part => part.trim())) {
      await tx.$executeRawUnsafe(statement);
    }
    await tx.$executeRawUnsafe('INSERT INTO "qa_visibility_migration" (id) VALUES (\'new\')');
    const rows = await tx.$queryRawUnsafe('SELECT id, advanced_content_enabled, testimonials_visible FROM "qa_visibility_migration" ORDER BY id');
    assert.deepEqual(rows, [ { id: "legacy", advanced_content_enabled: true, testimonials_visible: true },
      { id: "new", advanced_content_enabled: true, testimonials_visible: false } ]);
  });
});
