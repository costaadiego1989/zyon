/* eslint-disable no-console */
/**
 * Idempotent showroom seed for Advanced Product Layout.
 *
 * The seed resolves the merchant through the owner email and writes only its
 * own reserved product and related APL records. It never replaces an existing
 * catalog product or modifies checkout, payment, discounts, or merchant rules.
 *
 * Optional overrides:
 *   AACP_DEMO_MERCHANT_EMAIL=<owner-email>
 *   AACP_DEMO_MERCHANT_ID=<merchant-id>
 */
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(import.meta.dirname, "../../.env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the advanced layout showroom.");
}

const targetEmail = (process.env.AACP_DEMO_MERCHANT_EMAIL ?? "costaadiego1989@gmail.com").trim().toLowerCase();
const configuredMerchantId = process.env.AACP_DEMO_MERCHANT_ID?.trim();
const locale = "pt-BR";

const image = {
  hero: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=1800&q=85",
  ritual: "https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?auto=format&fit=crop&w=1400&q=85",
  // This uses the verified hero asset with a distinct crop. A previous
  // third-party photo intermittently returned an unusable thumbnail in the
  // browser test, which is not acceptable even for a local showroom.
  texture: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=1200&q=85&crop=top",
  detail: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=1200&q=85",
};

function safeSuffix(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-36) || "merchant";
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const merchant = configuredMerchantId
      ? await prisma.merchant.findUnique({
          where: { id: configuredMerchantId },
          select: { id: true, name: true, storeSlug: true },
        })
      : await prisma.merchantUser.findUnique({
          where: { email: targetEmail },
          select: {
            merchant: { select: { id: true, name: true, storeSlug: true } },
          },
        }).then((user) => user?.merchant ?? null);

    if (!merchant) {
      throw new Error(
        configuredMerchantId
          ? `Merchant ${configuredMerchantId} was not found.`
          : `No merchant owner was found for ${targetEmail}.`,
      );
    }

    // New merchants receive a slug at registration. Older local fixtures may
    // predate that invariant; make the showroom reachable without asking its
    // operator to discover and repair a legacy record by hand.
    const storeSlug = merchant.storeSlug ?? `showroom-${safeSuffix(merchant.id)}`;
    if (!merchant.storeSlug) {
      await prisma.merchant.update({
        where: { id: merchant.id },
        data: { storeSlug },
      });
    }

    const suffix = safeSuffix(merchant.id);
    const category = await prisma.productCategory.upsert({
      where: { merchantId_slug: { merchantId: merchant.id, slug: "showroom-advanced-layout" } },
      create: {
        id: `apl_category_${suffix}`,
        merchantId: merchant.id,
        name: "Produtos em destaque",
        slug: "showroom-advanced-layout",
        description: "Produtos de referencia do layout avancado.",
        isActive: true,
      },
      update: {
        name: "Produtos em destaque",
        description: "Produtos de referencia do layout avancado.",
        isActive: true,
      },
    });
    const existingDefaultLocation = await prisma.inventoryLocation.findFirst({
      where: { merchantId: merchant.id, isDefault: true, isActive: true },
    });
    const inventoryLocation = existingDefaultLocation ?? await prisma.inventoryLocation.upsert({
      where: { merchantId_name: { merchantId: merchant.id, name: "Estoque principal" } },
      create: { merchantId: merchant.id, name: "Estoque principal", kind: "warehouse", isDefault: true, isActive: true },
      update: { kind: "warehouse", isDefault: true, isActive: true },
    });
    const productId = `apl_showcase_${suffix}`;
    const variantId = `${productId}_standard`;
    const productSlug = `nucleo-serum-barreira-apl-${suffix}`;
    const product = await prisma.product.upsert({
      where: { id: productId },
      create: {
        id: productId,
        merchantId: merchant.id,
        categoryId: category.id,
        name: "Núcleo — Sérum de Barreira",
        slug: productSlug,
        description: "Hidratação que encontra o seu ritmo. Textura leve, ceramidas e niacinamida em um cuidado diário, sem fragrância adicionada.",
        type: "physical",
        isActive: true,
        metadata: { demo: true, advancedLayoutShowcase: true },
      },
      update: {
        merchantId: merchant.id,
        categoryId: category.id,
        name: "Núcleo — Sérum de Barreira",
        slug: productSlug,
        description: "Hidratação que encontra o seu ritmo. Textura leve, ceramidas e niacinamida em um cuidado diário, sem fragrância adicionada.",
        type: "physical",
        isActive: true,
        deletedAt: null,
        metadata: { demo: true, advancedLayoutShowcase: true },
      },
    });

    await prisma.$transaction([
      prisma.productContentBlock.deleteMany({ where: { productId: product.id, locale } }),
      prisma.productFaq.deleteMany({ where: { productId: product.id, locale } }),
      prisma.productTestimonial.deleteMany({ where: { productId: product.id, locale } }),
      prisma.productVideo.deleteMany({ where: { productId: product.id, locale } }),
    ]);

    await prisma.productVariant.upsert({
      where: { id: variantId },
      create: { id: variantId, productId: product.id, sku: `APL-NUCLEO-${suffix}`, attributes: { size: "30 ml" }, weightGrams: 90, lengthCm: 16, widthCm: 11, heightCm: 6, isActive: true },
      update: { productId: product.id, sku: `APL-NUCLEO-${suffix}`, attributes: { size: "30 ml" }, weightGrams: 90, lengthCm: 16, widthCm: 11, heightCm: 6, isActive: true },
    });
    await prisma.productPrice.upsert({
      where: { variantId },
      create: { variantId, basePriceInCents: 12990, costInCents: 5196, currency: "BRL" },
      update: { basePriceInCents: 12990, costInCents: 5196, currency: "BRL" },
    });
    await prisma.productStock.upsert({
      where: { variantId_warehouseId: { variantId, warehouseId: "apl-showroom" } },
      create: { variantId, warehouseId: "apl-showroom", quantity: 4, reserved: 0 },
      update: { quantity: 4, reserved: 0 },
    });
    await prisma.productMedia.upsert({
      where: { id: `${productId}_hero` },
      create: { id: `${productId}_hero`, variantId, url: image.hero, type: "IMAGE", alt: "Frasco minimalista do sérum Núcleo", order: 0 },
      update: { variantId, url: image.hero, type: "IMAGE", alt: "Frasco minimalista do sérum Núcleo", order: 0 },
    });

    for (const version of [{ key: "large", size: "50 ml", price: 18990, stock: 24 }, { key: "family", size: "100 ml", price: 29990, stock: 0 }]) {
      const id = `${productId}_${version.key}`;
      await prisma.productVariant.upsert({
        where: { id },
        create: { id, productId, sku: `APL-NUCLEO-${suffix}-${version.key}`, attributes: { size: version.size }, weightGrams: 150, lengthCm: 16, widthCm: 11, heightCm: 6, isActive: true },
        update: { attributes: { size: version.size }, weightGrams: 150, lengthCm: 16, widthCm: 11, heightCm: 6, isActive: true },
      });
      await prisma.productPrice.upsert({
        where: { variantId: id },
        create: { variantId: id, basePriceInCents: version.price, currency: "BRL" },
        update: { basePriceInCents: version.price, currency: "BRL" },
      });
      await prisma.productStock.upsert({
        where: { variantId_warehouseId: { variantId: id, warehouseId: "apl-showroom" } },
        create: { variantId: id, warehouseId: "apl-showroom", quantity: version.stock, reserved: 0 },
        update: { quantity: version.stock, reserved: 0 },
      });
    }
    for (const [index, entry] of [{ url: image.texture, alt: "Textura do produto" }, { url: image.detail, alt: "Detalhes do cuidado diário" }].entries()) {
      await prisma.productMedia.upsert({
        where: { id: `${productId}_gallery_${index}` },
        create: { id: `${productId}_gallery_${index}`, variantId, url: entry.url, alt: entry.alt, type: "IMAGE", order: index + 1 },
        update: { url: entry.url, alt: entry.alt, order: index + 1 },
      });
    }

    for (const snapshot of [
      { sku: `APL-NUCLEO-${suffix}`, variantName: "30 ml", quantity: 4, price: 12990, cost: 5196 },
      { sku: `APL-NUCLEO-${suffix}-large`, variantName: "50 ml", quantity: 24, price: 18990, cost: undefined },
      { sku: `APL-NUCLEO-${suffix}-family`, variantName: "100 ml", quantity: 0, price: 29990, cost: undefined },
    ]) {
      await prisma.inventoryItem.upsert({
        where: {
          merchantId_sku_locationId: {
            merchantId: merchant.id,
            sku: snapshot.sku,
            locationId: inventoryLocation.id,
          },
        },
        create: {
          merchantId: merchant.id,
          sku: snapshot.sku,
          productName: product.name,
          variantName: snapshot.variantName,
          locationId: inventoryLocation.id,
          quantity: snapshot.quantity,
          avgCostCents: snapshot.cost,
          salePriceCents: snapshot.price,
        },
        update: {
          productName: product.name,
          variantName: snapshot.variantName,
          quantity: snapshot.quantity,
          avgCostCents: snapshot.cost,
          salePriceCents: snapshot.price,
        },
      });
    }

    await prisma.productContentBlock.createMany({
      data: [
        { productId: product.id, locale, type: "heading", order: 0, isEnabled: true, props: { level: 2, text: "Pele estável começa com uma barreira bem cuidada." } },
        { productId: product.id, locale, type: "paragraph", order: 1, isEnabled: true, props: { text: "Núcleo combina textura leve, ativos de alta tolerância e um ritual de dois minutos para quem quer hidratação consistente sem pesar na rotina." } },
        { productId: product.id, locale, type: "banner", order: 2, isEnabled: true, props: { imageSrc: image.hero, alt: "Frasco minimalista do sérum Núcleo sobre fundo claro", caption: "Tecnologia de barreira, sensorial limpo e resultado que cabe na rotina.", ctaAction: "add_to_cart", ctaLabel: "Adicionar ao carrinho" } },
        { productId: product.id, locale, type: "image_text_split", order: 3, isEnabled: true, props: { imageSrc: image.ritual, imageAlt: "Pessoa aplicando sérum no rosto", imageSide: "right", heading: "Um ritual que acompanha o seu dia", text: "Use três gotas após a limpeza, manhã e noite. A fórmula foi pensada para somar com sua rotina atual, inclusive em peles sensibilizadas por clima, limpeza excessiva ou ativos intensos." } },
        { productId: product.id, locale, type: "callout", order: 4, isEnabled: true, props: { tone: "success", title: "Fórmula de uso diário", text: "Sem fragrância adicionada, com acabamento confortável e absorção rápida. Faça teste de sensibilidade antes do primeiro uso." } },
        { productId: product.id, locale, type: "heading", order: 5, isEnabled: true, props: { level: 3, text: "O que torna a fórmula diferente" } },
        { productId: product.id, locale, type: "list", order: 6, isEnabled: true, props: { style: "unordered", items: ["Niacinamida para apoiar a uniformidade visual da pele.", "Ceramidas para reforçar a sensação de conforto e hidratação.", "Pantenol para uma rotina simples, inclusive após dias mais intensos."] } },
        { productId: product.id, locale, type: "table", order: 7, isEnabled: true, props: { caption: "Leitura rápida da fórmula", headers: ["Ativo", "Função", "Quando você percebe"], rows: [["Niacinamida", "Apoia a uniformidade", "Uso contínuo"], ["Ceramidas", "Ajuda a reter hidratação", "Conforto imediato"], ["Pantenol", "Acalma a sensação de ressecamento", "Após a aplicação"]] } },
        { productId: product.id, locale, type: "image", order: 8, isEnabled: true, props: { src: image.texture, alt: "Textura translúcida do sérum", caption: "Textura fluida, feita para ser aplicada antes do hidratante." } },
        { productId: product.id, locale, type: "carousel", order: 9, isEnabled: true, props: { images: [{ src: image.hero, alt: "Embalagem do Núcleo" }, { src: image.texture, alt: "Textura do produto" }, { src: image.detail, alt: "Detalhe de cosméticos minimalistas" }], caption: "Uma formulação objetiva, do frasco à última gota." } },
        { productId: product.id, locale, type: "button", order: 10, isEnabled: true, props: { label: "Quero incluir no meu ritual", linkType: "add_to_cart", variant: "primary" } },
      ],
    });

    await prisma.productFaq.createMany({
      data: [
        { productId: product.id, locale, question: "Posso usar com vitamina C e retinol?", answer: "Sim. Introduza um produto por vez e, se sua pele for reativa, alterne os ativos mais intensos até encontrar a frequência ideal.", order: 0, isPublished: true },
        { productId: product.id, locale, question: "Qual é a textura?", answer: "É um sérum fluido de rápida absorção. Ele deixa a pele confortável, sem sensação pegajosa, antes do hidratante e do protetor solar.", order: 1, isPublished: true },
        { productId: product.id, locale, question: "Em quanto tempo recebo?", answer: "O prazo final aparece no checkout depois da confirmação do CEP. Você acompanha cada atualização do pedido pelo hub da loja.", order: 2, isPublished: true },
      ],
    });

    await prisma.productTestimonial.createMany({
      data: [
        { productId: product.id, locale, authorName: "Marina R.", body: "Minha pele fica confortável o dia todo e a textura encaixou muito bem antes do protetor.", rating: 5, source: "customer_submission", moderationStatus: "approved", isPublished: true },
        { productId: product.id, locale, authorName: "Camila S.", body: "A rotina ficou mais simples. Uso há algumas semanas e gosto de como a pele amanhece.", rating: 5, source: "customer_submission", moderationStatus: "approved", isPublished: true },
        { productId: product.id, locale, authorName: "Rafael M.", body: "Absorve rápido e não deixou brilho. Foi fácil combinar com os outros produtos que já uso.", rating: 4, source: "curated", moderationStatus: "approved", isPublished: true },
      ],
    });

    await prisma.productVideo.createMany({
      data: [
        { productId: product.id, locale, title: "Player demonstrativo · vídeo enviado pela loja", videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", thumbnailUrl: image.ritual, source: "merchant", moderationStatus: "approved", isPublished: true },
        { productId: product.id, locale, title: "Player demonstrativo · vídeo da comunidade", videoUrl: "https://vimeo.com/76979871", thumbnailUrl: image.detail, source: "customer", moderationStatus: "approved", isPublished: true },
      ],
    });

    const preview = `/store/${storeSlug}?show=content&product=${product.id}`;
    console.log(`Advanced layout showroom ready for ${merchant.name}.`);
    console.log(`merchant=${merchant.id} productId=${product.id} variantId=${variantId}`);
    console.log(`preview=${preview}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export default main;
