/* eslint-disable no-console */
/**
 * Creates the public Zyon demonstration store used by the marketing site.
 *
 * The seed is intentionally isolated from merchant onboarding and payments:
 * it creates no user, API key, billing subscription or payment connection.
 * All records use stable identifiers, so the command is safe to run again.
 *
 * Run locally: pnpm --filter @zyon/api seed:demo-store
 * Run in production only with an explicitly supplied DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the Zyon demo store.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEMO = {
  merchantId: "mrc_zyon_demo",
  slug: "demo",
  agentId: "agent_zyon_demo",
} as const;

const categories = [
  { id: "cat_zyon_demo_essenciais", name: "Essenciais", slug: "essenciais", description: "Peças úteis para acompanhar a rotina." },
  { id: "cat_zyon_demo_tecnologia", name: "Tecnologia", slug: "tecnologia", description: "Tecnologia simples, funcional e bem escolhida." },
] as const;

const products = [
  {
    id: "prod_zyon_demo_bolsa", categoryId: categories[0].id, sku: "DEMO-BOLSA-01",
    name: "Bolsa Aurora", slug: "bolsa-aurora", description: "Uma bolsa versátil para organizar os essenciais e acompanhar a rotina.",
    price: 48900, cost: 24400, stock: 36,
    image: "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=900&q=82",
  },
  {
    id: "prod_zyon_demo_carteira", categoryId: categories[0].id, sku: "DEMO-CARTEIRA-01",
    name: "Carteira Horizonte", slug: "carteira-horizonte", description: "Carteira compacta com espaço para cartões e documentos do dia a dia.",
    price: 32900, cost: 15800, stock: 24,
    image: "https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&w=900&q=82",
  },
  {
    id: "prod_zyon_demo_cadeira", categoryId: categories[0].id, sku: "DEMO-CADEIRA-01",
    name: "Cadeira Orbe", slug: "cadeira-orbe", description: "Uma peça de linhas leves para compor espaços de trabalho, estudo ou descanso.",
    price: 21900, cost: 9800, stock: 18,
    image: "https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=900&q=82",
  },
  {
    id: "prod_zyon_demo_relogio", categoryId: categories[1].id, sku: "DEMO-RELOGIO-01",
    name: "Relógio Traço", slug: "relogio-traco", description: "Caixa em aço escovado, pulseira ajustável e resistência à água.",
    price: 39900, cost: 19200, stock: 15,
    image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=82",
  },
  {
    id: "prod_zyon_demo_camera", categoryId: categories[1].id, sku: "DEMO-CAMERA-01",
    name: "Câmera Instante", slug: "camera-instante", description: "Câmera compacta para registrar viagens e momentos do dia a dia.",
    price: 74900, cost: 43600, stock: 9,
    image: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=900&q=82",
  },
  {
    id: "prod_zyon_demo_garrafa", categoryId: categories[0].id, sku: "DEMO-GARRAFA-01",
    name: "Garrafa Vale", slug: "garrafa-vale", description: "Garrafa térmica de 750 ml em aço inoxidável, livre de BPA.",
    price: 13900, cost: 5700, stock: 42,
    image: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=82",
  },
] as const;

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.merchant.upsert({
      where: { id: DEMO.merchantId },
      create: {
        id: DEMO.merchantId,
        name: "Casa Zyon — Loja Demo",
        storeSlug: DEMO.slug,
        storeCategory: "lifestyle",
        plan: "STORE_ONLY",
        theme: {
          accentColor: "#16A34A",
          secondaryColor: "#14532D",
          textColor: "#F4F7F4",
          mutedTextColor: "#A7B0A8",
          backgroundColor: "#080B09",
          surfaceColor: "#101511",
          surfaceElevatedColor: "#172019",
          borderColor: "#28342B",
          fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif",
          fontDisplay: "Sora, Manrope, ui-sans-serif, system-ui, sans-serif",
          borderRadius: 12,
          mode: "dark",
          density: "comfortable",
          agentName: "Zyon",
        },
        storeSettings: {
          demo: true,
          demoNotice: "Catálogo de demonstração da Zyon. Produtos e condições são ilustrativos.",
          seo: {
            title: "Casa Zyon — Loja autônoma de demonstração",
            description: "Experimente uma loja autônoma Zyon com catálogo e atendimento por inteligência artificial.",
          },
          company: { razaoSocial: "Ambiente demonstrativo Zyon" },
          policies: {
            shipping: "Os prazos apresentados nesta demonstração são ilustrativos.",
            returns: "Os produtos deste catálogo são exemplos para conhecer a experiência Zyon.",
          },
        },
      },
      update: {
        name: "Casa Zyon — Loja Demo",
        storeSlug: DEMO.slug,
        storeCategory: "lifestyle",
        plan: "STORE_ONLY",
        theme: {
          accentColor: "#16A34A", secondaryColor: "#14532D", textColor: "#F4F7F4",
          mutedTextColor: "#A7B0A8", backgroundColor: "#080B09", surfaceColor: "#101511",
          surfaceElevatedColor: "#172019", borderColor: "#28342B",
          fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif",
          fontDisplay: "Sora, Manrope, ui-sans-serif, system-ui, sans-serif",
          borderRadius: 12, mode: "dark", density: "comfortable", agentName: "Zyon",
        },
        storeSettings: {
          demo: true, demoNotice: "Catálogo de demonstração da Zyon. Produtos e condições são ilustrativos.",
          seo: { title: "Casa Zyon — Loja autônoma de demonstração", description: "Experimente uma loja autônoma Zyon com catálogo e atendimento por inteligência artificial." },
          company: { razaoSocial: "Ambiente demonstrativo Zyon" },
          policies: { shipping: "Os prazos apresentados nesta demonstração são ilustrativos.", returns: "Os produtos deste catálogo são exemplos para conhecer a experiência Zyon." },
        },
      },
    });

    await tx.agentRule.upsert({
      where: { merchantId_agentId: { merchantId: DEMO.merchantId, agentId: DEMO.agentId } },
      create: {
        merchantId: DEMO.merchantId, agentId: DEMO.agentId, scope: "storefront",
        identity: { agentName: "Zyon", greeting: "Olá! Eu cuido desta loja demo. Posso apresentar o catálogo, comparar produtos e montar seu carrinho." },
        capabilities: { productDiscovery: true, productComparison: true, cartAssistance: true, negotiation: false },
        guardrails: { demoMode: true, paymentsDisabled: true, maxDiscountPercent: 0 },
        checkoutSettings: { agentMode: "proactive", initialDelaySeconds: 1, maxInterventionsPerSession: 4 },
      },
      update: {
        scope: "storefront",
        identity: { agentName: "Zyon", greeting: "Olá! Eu cuido desta loja demo. Posso apresentar o catálogo, comparar produtos e montar seu carrinho." },
        capabilities: { productDiscovery: true, productComparison: true, cartAssistance: true, negotiation: false },
        guardrails: { demoMode: true, paymentsDisabled: true, maxDiscountPercent: 0 },
        checkoutSettings: { agentMode: "proactive", initialDelaySeconds: 1, maxInterventionsPerSession: 4 },
      },
    });

    await tx.merchantRule.upsert({
      where: { merchantId: DEMO.merchantId },
      create: {
        merchantId: DEMO.merchantId, maxDiscountPercent: 0, minimumMarginPercent: 25,
        allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false,
        allowStackDiscountAndFreeShipping: false, couponBoxEnabled: false,
        autonomousEngineEnabled: false, freeShippingMinCartValue: 0, maxShippingSubsidy: 0,
        maxPartialShippingDiscount: 0, offerExpirationMinutes: 15, blockedRegions: [],
        brandVoice: "clara, acolhedora e objetiva", originZip: "01310100",
        quickReplies: { welcome: ["Ver produtos", "Encontrar um presente", "Comparar opções", "Como funciona a demo?"] },
      },
      update: {
        maxDiscountPercent: 0, minimumMarginPercent: 25, allowFreeShipping: false,
        allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
        couponBoxEnabled: false, autonomousEngineEnabled: false,
        quickReplies: { welcome: ["Ver produtos", "Encontrar um presente", "Comparar opções", "Como funciona a demo?"] },
      },
    });

    for (const category of categories) {
      await tx.productCategory.upsert({
        where: { merchantId_slug: { merchantId: DEMO.merchantId, slug: category.slug } },
        create: { ...category, merchantId: DEMO.merchantId, isActive: true },
        update: { name: category.name, description: category.description, isActive: true },
      });
    }

    for (const product of products) {
      const variantId = `var_${product.id}`;
      await tx.product.upsert({
        where: { id: product.id },
        create: {
          id: product.id, merchantId: DEMO.merchantId, categoryId: product.categoryId,
          name: product.name, slug: product.slug, description: product.description,
          type: "physical", isActive: true, metadata: { demo: true },
        },
        update: {
          categoryId: product.categoryId, name: product.name, slug: product.slug,
          description: product.description, isActive: true, deletedAt: null, metadata: { demo: true },
        },
      });
      await tx.productVariant.upsert({
        where: { id: variantId },
        create: { id: variantId, productId: product.id, sku: product.sku, isActive: true, attributes: { color: "Única" }, weightGrams: 450 },
        update: { sku: product.sku, isActive: true, attributes: { color: "Única" }, weightGrams: 450 },
      });
      await tx.productPrice.upsert({
        where: { variantId },
        create: { variantId, basePriceInCents: product.price, costInCents: product.cost, currency: "BRL" },
        update: { basePriceInCents: product.price, costInCents: product.cost, currency: "BRL" },
      });
      await tx.productStock.upsert({
        where: { variantId_warehouseId: { variantId, warehouseId: "demo" } },
        create: { variantId, warehouseId: "demo", quantity: product.stock, reserved: 0 },
        update: { quantity: product.stock, reserved: 0 },
      });
      await tx.productMedia.upsert({
        where: { id: `media_${product.id}` },
        create: { id: `media_${product.id}`, variantId, url: product.image, type: "IMAGE", alt: product.name, order: 0 },
        update: { variantId, url: product.image, type: "IMAGE", alt: product.name, order: 0 },
      });
    }
  }, { maxWait: 10_000, timeout: 30_000 });

  console.log(`Demo store ready: merchant=${DEMO.merchantId} slug=${DEMO.slug} products=${products.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
