/* eslint-disable no-console */
/**
 * Wave-1 demo seed for the Advanced Product Layout feature.
 *
 * Idempotent: looks up an existing demo merchant first; if absent, bails
 * with a clear message (the marketplace seed should run before this one).
 * Creates one demo product with five content blocks, two FAQs, two
 * testimonials, and one video so the renderer can be exercised manually.
 *
 * Run with: `pnpm tsx prisma/seeds/advanced-product-layout-seed.ts`
 */
import type { PrismaClient } from "@prisma/client";

const DEMO_MERCHANT_ID = "mrc_marketplace_01";
const DEMO_PRODUCT_NAME = "Demo Advanced Layout Product";

async function main() {
  // dynamic import keeps this script out of the prod bundle.
  const { prisma } = await import("../../src/shared/persistence/prisma-client.js");

  const merchant = await prisma.merchant.findUnique({
    where: { id: DEMO_MERCHANT_ID },
  });
  if (!merchant) {
    throw new Error(
      `Seed aborted: merchant ${DEMO_MERCHANT_ID} not found. Run marketplace-seed first.`,
    );
  }

  // Upsert product.
  const product =
    (await prisma.product.findFirst({
      where: { merchantId: DEMO_MERCHANT_ID, name: DEMO_PRODUCT_NAME },
    })) ??
    (await prisma.product.create({
      data: {
        merchantId: DEMO_MERCHANT_ID,
        name: DEMO_PRODUCT_NAME,
        description: "Demo product for Advanced Product Layout feature flag.",
        type: "physical",
        isActive: true,
      },
    }));

  const productId = product.id;

  // Wipe existing demo content for this product so the seed is idempotent.
  await prisma.productContentBlock.deleteMany({ where: { productId } });
  await prisma.productFaq.deleteMany({ where: { productId } });
  await prisma.productTestimonial.deleteMany({ where: { productId } });
  await prisma.productVideo.deleteMany({ where: { productId } });

  await prisma.productContentBlock.createMany({
    data: [
      {
        productId,
        type: "heading",
        order: 0,
        isEnabled: true,
        props: { text: "Blend Original", level: 2 },
      },
      {
        productId,
        type: "paragraph",
        order: 1,
        isEnabled: true,
        props: { text: "Hidratação profunda e brilho natural em uma fórmula vegana." },
      },
      {
        productId,
        type: "image",
        order: 2,
        isEnabled: true,
        props: {
          url: "https://placehold.co/1200x800/png?text=Blend+Original",
          alt: "Frasco do Blend Original",
        },
      },
      {
        productId,
        type: "callout",
        order: 3,
        isEnabled: true,
        props: {
          tone: "info",
          title: "Como usar",
          body: "Aplique 3 gotas no rosto limpo, de manhã e à noite.",
        },
      },
      {
        productId,
        type: "button",
        order: 4,
        isEnabled: true,
        props: { label: "Comprar agora", linkUrl: "https://example.com/buy", variant: "primary" },
      },
    ],
  });

  await prisma.productFaq.createMany({
    data: [
      {
        productId,
        question: "O produto é vegano?",
        answer: "Sim, todos os ingredientes são 100% veganos.",
        order: 0,
        isPublished: true,
      },
      {
        productId,
        question: "Qual o prazo de entrega?",
        answer: "Entrega em 3-5 dias úteis para todo o Brasil.",
        order: 1,
        isPublished: true,
      },
    ],
  });

  await prisma.productTestimonial.createMany({
    data: [
      {
        productId,
        authorName: "Maria Silva",
        body: "Resultado visível em 4 semanas. Recomendo!",
        rating: 5,
        source: "curated",
        moderationStatus: "approved",
        isPublished: true,
      },
      {
        productId,
        authorName: "João Pereira",
        body: "Gostei bastante da textura leve.",
        rating: 4,
        source: "curated",
        moderationStatus: "approved",
        isPublished: true,
      },
    ],
  });

  await prisma.productVideo.create({
    data: {
      productId,
      title: "Tutorial de aplicação",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      source: "merchant",
      moderationStatus: "approved",
      isPublished: true,
    },
  });

  console.log(`✓ Seeded advanced layout for product ${productId}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));

export default main;
