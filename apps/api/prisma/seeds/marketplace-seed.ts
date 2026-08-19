import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 10 merchants with diverse store categories
const MERCHANTS = [
  { name: 'Loja Fashion Elite', category: 'roupas', city: 'São Paulo' },
  { name: 'Couro & Estilo', category: 'roupas', city: 'Curitiba' },
  { name: 'Tech House', category: 'eletronicos', city: 'Belo Horizonte' },
  { name: 'Calçados Prime', category: 'calcados', city: 'Porto Alegre' },
  { name: 'Casa & Decoração', category: 'decoracao', city: 'Florianópolis' },
  { name: 'SportFit Brasil', category: 'esportes', city: 'Rio de Janeiro' },
  { name: 'Beleza Natural', category: 'cosmeticos', city: 'Salvador' },
  { name: 'Papelaria Criativa', category: 'papelaria', city: 'Recife' },
  { name: 'Pet World', category: 'pets', city: 'Brasília' },
  { name: 'Gourmet & Cia', category: 'alimentacao', city: 'Campinas' },
];

// 10 products per merchant (category-specific)
const PRODUCTS_BY_CATEGORY: Record<
  string,
  Array<{ name: string; price: number; desc: string }>
> = {
  roupas: [
    { name: 'Calça Jeans Slim', price: 19900, desc: 'Calça jeans slim fit premium' },
    {
      name: 'Calça de Couro Preta',
      price: 49900,
      desc: 'Calça de couro legítimo preta',
    },
    { name: 'Camiseta Básica Branca', price: 7900, desc: 'Camiseta algodão 100%' },
    {
      name: 'Jaqueta Bomber',
      price: 34900,
      desc: 'Jaqueta bomber estilo militar',
    },
    { name: 'Vestido Floral', price: 15900, desc: 'Vestido midi estampa floral' },
    { name: 'Blazer Oversized', price: 29900, desc: 'Blazer oversized corte reto' },
    { name: 'Short Linho', price: 12900, desc: 'Short de linho natural' },
    {
      name: 'Moletom Canguru',
      price: 17900,
      desc: 'Moletom com capuz unissex',
    },
    { name: 'Saia Midi Plissada', price: 14900, desc: 'Saia midi com pregas' },
    {
      name: 'Camisa Social Slim',
      price: 13900,
      desc: 'Camisa social algodão egípcio',
    },
  ],
  eletronicos: [
    {
      name: 'Fone Bluetooth ANC',
      price: 39900,
      desc: 'Fone over-ear cancelamento de ruído',
    },
    {
      name: 'Carregador MagSafe',
      price: 19900,
      desc: 'Carregador wireless magnético',
    },
    {
      name: 'Hub USB-C 7 portas',
      price: 24900,
      desc: 'Hub multiporta HDMI + USB',
    },
    { name: 'Webcam 4K', price: 44900, desc: 'Webcam com auto-foco e microfone' },
    {
      name: 'Teclado Mecânico',
      price: 54900,
      desc: 'Teclado mecânico RGB compact',
    },
    {
      name: 'Mouse Ergonômico',
      price: 29900,
      desc: 'Mouse vertical ergonômico wireless',
    },
    {
      name: 'Power Bank 20000mAh',
      price: 14900,
      desc: 'Bateria portátil carga rápida',
    },
    {
      name: 'Smart Watch Fitness',
      price: 79900,
      desc: 'Relógio GPS + frequência cardíaca',
    },
    {
      name: 'Caixa Bluetooth 30W',
      price: 34900,
      desc: "Speaker portátil à prova d'água",
    },
    {
      name: 'Cabo USB-C Trançado',
      price: 4900,
      desc: 'Cabo 2m carga rápida 100W',
    },
  ],
  calcados: [
    {
      name: 'Tênis Running Pro',
      price: 44900,
      desc: 'Tênis corrida amortecimento gel',
    },
    {
      name: 'Bota Chelsea Couro',
      price: 39900,
      desc: 'Bota chelsea couro marrom',
    },
    {
      name: 'Sandália Flatform',
      price: 17900,
      desc: 'Sandália plataforma verão',
    },
    {
      name: 'Sapatênis Casual',
      price: 22900,
      desc: 'Sapatênis couro sintético',
    },
    { name: 'Chinelo Slide', price: 7900, desc: 'Chinelo slide conforto' },
    {
      name: 'Mocassim Couro',
      price: 29900,
      desc: 'Mocassim couro legítimo preto',
    },
    { name: 'Tênis Skate', price: 34900, desc: 'Tênis vulcanizado skate' },
    {
      name: 'Sapato Social',
      price: 27900,
      desc: 'Sapato social couro verniz',
    },
    {
      name: 'Bota Hiking',
      price: 54900,
      desc: 'Bota trilha impermeável',
    },
    {
      name: 'Alpargata Lona',
      price: 8900,
      desc: 'Alpargata clássica lona',
    },
  ],
  decoracao: [
    {
      name: 'Luminária Articulada',
      price: 19900,
      desc: 'Luminária mesa articulada LED',
    },
    {
      name: 'Quadro Abstract',
      price: 14900,
      desc: 'Quadro decorativo abstrato 60x80',
    },
    { name: 'Vaso Cerâmica', price: 8900, desc: 'Vaso cerâmica artesanal' },
    { name: 'Almofada Veludo', price: 6900, desc: 'Almofada veludo 45x45' },
    {
      name: 'Espelho Redondo',
      price: 24900,
      desc: 'Espelho decorativo moldura dourada',
    },
    {
      name: 'Tapete Geométrico',
      price: 34900,
      desc: 'Tapete 150x200 padrão geométrico',
    },
    {
      name: 'Relógio Parede',
      price: 12900,
      desc: 'Relógio parede minimalista',
    },
    {
      name: 'Porta Retrato',
      price: 4900,
      desc: 'Porta retrato madeira 20x25',
    },
    {
      name: 'Difusor Ambiente',
      price: 7900,
      desc: 'Difusor de aromas 250ml',
    },
    {
      name: 'Organizador Mesa',
      price: 5900,
      desc: 'Organizador madeira escritório',
    },
  ],
  esportes: [
    {
      name: 'Corda de Pular Pro',
      price: 4900,
      desc: 'Corda de pular com rolamento',
    },
    {
      name: 'Colchonete Yoga',
      price: 12900,
      desc: 'Colchonete TPE 6mm antiderrapante',
    },
    {
      name: 'Haltere 10kg',
      price: 14900,
      desc: 'Haltere emborrachado 10kg',
    },
    {
      name: 'Garrafa Térmica 1L',
      price: 8900,
      desc: 'Garrafa inox térmica esportiva',
    },
    {
      name: 'Luva Musculação',
      price: 5900,
      desc: 'Luva academia com munhequeira',
    },
    {
      name: 'Faixa Elástica Kit',
      price: 7900,
      desc: 'Kit 5 faixas resistência',
    },
    {
      name: 'Mochila Esportiva 30L',
      price: 17900,
      desc: 'Mochila compartimento notebook',
    },
    {
      name: 'Caneleira 3kg',
      price: 6900,
      desc: 'Par caneleira peso ajustável',
    },
    { name: 'Bola Futebol', price: 12900, desc: 'Bola society costurada à mão' },
    {
      name: 'Óculos Natação',
      price: 9900,
      desc: 'Óculos natação antiembaçante',
    },
  ],
  cosmeticos: [
    {
      name: 'Sérum Vitamina C',
      price: 8900,
      desc: 'Sérum facial vitamina C 30ml',
    },
    {
      name: 'Protetor Solar FPS60',
      price: 5900,
      desc: 'Protetor solar facial oil-free',
    },
    {
      name: 'Shampoo Natural',
      price: 4900,
      desc: 'Shampoo vegano sem sulfato',
    },
    {
      name: 'Creme Anti-Idade',
      price: 14900,
      desc: 'Creme noturno retinol',
    },
    {
      name: 'Óleo Corporal',
      price: 6900,
      desc: 'Óleo corporal amêndoas 200ml',
    },
    {
      name: 'Máscara Capilar',
      price: 3900,
      desc: 'Máscara hidratação profunda',
    },
    { name: 'Batom Matte', price: 4900, desc: 'Batom matte longa duração' },
    {
      name: 'Perfume Floral 50ml',
      price: 19900,
      desc: 'Eau de parfum floral amadeirado',
    },
    {
      name: 'Kit Skincare',
      price: 24900,
      desc: 'Kit limpeza + tônico + hidratante',
    },
    {
      name: 'Esfoliante Corporal',
      price: 3900,
      desc: 'Esfoliante açúcar e mel',
    },
  ],
  papelaria: [
    {
      name: 'Caderno Bullet Journal',
      price: 5900,
      desc: 'Caderno pontilhado 192 páginas',
    },
    {
      name: 'Kit Canetas Fineliner',
      price: 7900,
      desc: 'Kit 12 canetas ponta fina',
    },
    { name: 'Planner Anual', price: 8900, desc: 'Planner 2027 capa dura' },
    {
      name: 'Adesivos Decorativos',
      price: 2900,
      desc: 'Pack 100 adesivos washi',
    },
    {
      name: 'Marca Texto Pastel',
      price: 3900,
      desc: 'Kit 6 marca texto pastel',
    },
    {
      name: 'Fichário A4',
      price: 6900,
      desc: 'Fichário 4 argolas couro sintético',
    },
    { name: 'Washi Tape Kit', price: 4900, desc: 'Kit 10 rolos washi tape' },
    {
      name: 'Régua 30cm Metal',
      price: 1900,
      desc: 'Régua alumínio anti-reflexo',
    },
    {
      name: 'Post-it Neon',
      price: 2900,
      desc: 'Bloco notas adesivas neon 4 cores',
    },
    {
      name: 'Estojo Premium',
      price: 4900,
      desc: 'Estojo couro ecológico duplo',
    },
  ],
  pets: [
    {
      name: 'Ração Premium 15kg',
      price: 18900,
      desc: 'Ração super premium adultos',
    },
    {
      name: 'Coleira GPS',
      price: 29900,
      desc: 'Coleira rastreador GPS Bluetooth',
    },
    {
      name: 'Cama Pet Ortopédica',
      price: 17900,
      desc: 'Cama ortopédica memory foam G',
    },
    {
      name: 'Brinquedo Interativo',
      price: 5900,
      desc: 'Brinquedo dispensador petiscos',
    },
    {
      name: 'Shampoo Pet Natural',
      price: 3900,
      desc: 'Shampoo neutro pets sensíveis',
    },
    {
      name: 'Guia Retrátil 5m',
      price: 7900,
      desc: 'Guia retrátil trava automática',
    },
    {
      name: 'Comedouro Inox',
      price: 4900,
      desc: 'Comedouro duplo inox antiderrapante',
    },
    {
      name: 'Arranhador Gato',
      price: 12900,
      desc: 'Arranhador sisal torre 3 níveis',
    },
    {
      name: 'Transportadora Avião',
      price: 24900,
      desc: 'Caixa transporte aprovada IATA',
    },
    {
      name: 'Petisco Natural',
      price: 2900,
      desc: 'Bifinho natural sem conservantes',
    },
  ],
  alimentacao: [
    {
      name: 'Azeite Extra Virgem',
      price: 4900,
      desc: 'Azeite português safra 2026',
    },
    {
      name: 'Café Especial 250g',
      price: 3900,
      desc: 'Café arábica torrado artesanal',
    },
    {
      name: 'Chocolate 72% Cacau',
      price: 2900,
      desc: 'Chocolate belga bean-to-bar',
    },
    {
      name: 'Mel Orgânico 500g',
      price: 3900,
      desc: 'Mel silvestre orgânico',
    },
    {
      name: 'Granola Artesanal',
      price: 2900,
      desc: 'Granola castanhas e frutas 400g',
    },
    {
      name: 'Vinho Tinto Reserva',
      price: 8900,
      desc: 'Vinho chileno cabernet sauvignon',
    },
    {
      name: 'Kit Temperos',
      price: 5900,
      desc: 'Kit 8 temperos moedor vidro',
    },
    {
      name: 'Pasta de Amendoim',
      price: 2900,
      desc: 'Pasta integral sem açúcar 500g',
    },
    {
      name: 'Chá Premium Kit',
      price: 4900,
      desc: 'Kit 5 chás gourmet orgânicos',
    },
    {
      name: 'Kombucha Pack 6',
      price: 5900,
      desc: 'Pack 6 kombuchas artesanais',
    },
  ],
};

async function seed() {
  console.log('🌱 Seeding marketplace data...');

  const createdMerchants: string[] = [];

  for (let i = 0; i < MERCHANTS.length; i++) {
    const m = MERCHANTS[i];
    const merchantId = `mrc_marketplace_${String(i + 1).padStart(2, '0')}`;

    // Create merchant
    await prisma.merchant.upsert({
      where: { id: merchantId },
      create: {
        id: merchantId,
        name: m.name,
        storeCategory: m.category,
        plan: 'BOTH',
      },
      update: { name: m.name },
    });

    // Enable marketplace
    await prisma.marketplaceConfig.upsert({
      where: { merchantId: merchantId },
      create: {
        merchantId: merchantId,
        enabled: true,
        commissionRateBps: 1000 + i * 100, // 10% to 19% varying
        returnWindowDays: 7,
        payoutDelayDays: 14,
        chargebackWindowDays: 30,
        allowedCategories: [],
        blockedMerchants: [],
      },
      update: { enabled: true },
    });

    // Create 10 products
    const category = m.category;
    const products = PRODUCTS_BY_CATEGORY[category] || PRODUCTS_BY_CATEGORY.roupas;

    for (let j = 0; j < products.length; j++) {
      const p = products[j];
      const productId = `prod_${category}_${String(i + 1).padStart(2, '0')}_${String(j + 1).padStart(2, '0')}`;

      await prisma.product.upsert({
        where: { id: productId },
        create: {
          id: productId,
          merchantId: merchantId,
          name: p.name,
          description: p.desc,
          type: 'physical',
          isActive: true,
        },
        update: { name: p.name },
      });

      // Create variant with SKU
      const variantId = `var_${productId}`;
      await prisma.productVariant.upsert({
        where: { id: variantId },
        create: {
          id: variantId,
          productId: productId,
          sku: `SKU-${category.toUpperCase()}-${(i + 1) * 100 + j + 1}`,
          isActive: true,
        },
        update: { sku: `SKU-${category.toUpperCase()}-${(i + 1) * 100 + j + 1}` },
      });

      // Create price separately (ProductPrice is a separate model)
      await prisma.productPrice.upsert({
        where: { variantId: variantId },
        create: {
          variantId: variantId,
          basePriceInCents: p.price,
          currency: 'BRL',
        },
        update: { basePriceInCents: p.price },
      });

      // Create stock (ProductStock with optional warehouseId)
      await prisma.productStock.upsert({
        where: {
          variantId_warehouseId: {
            variantId: variantId,
            warehouseId: null,
          },
        },
        create: {
          variantId: variantId,
          warehouseId: null,
          quantity: 50 + Math.floor(Math.random() * 100),
          reserved: 0,
        },
        update: { quantity: 50 + Math.floor(Math.random() * 100) },
      });

      // Index in federated products
      const searchableText = `${p.name} ${p.desc} ${category}`.toLowerCase();
      await prisma.federatedProduct.upsert({
        where: {
          sourceMerchantId_sourceProductId: {
            sourceMerchantId: merchantId,
            sourceProductId: productId,
          },
        },
        create: {
          sourceMerchantId: merchantId,
          sourceProductId: productId,
          name: p.name,
          description: p.desc,
          category: category,
          priceCents: p.price,
          currency: 'BRL',
          stockAvailable: true,
          searchableText: searchableText,
          syncedAt: new Date(),
        },
        update: {
          name: p.name,
          priceCents: p.price,
          searchableText: searchableText,
          syncedAt: new Date(),
        },
      });
    }

    createdMerchants.push(merchantId);
    console.log(`  ✅ ${m.name} (${merchantId}) — 10 products`);
  }

  console.log(
    `\n🎉 Done! ${createdMerchants.length} merchants, 100 products, all indexed in federated marketplace.`
  );
  console.log('\nMerchant IDs:');
  createdMerchants.forEach((id) => console.log(`  - ${id}`));

  console.log('\n📋 Test scenarios:');
  console.log(
    '  1. Search "calça de couro" from any non-roupas merchant → finds Loja Fashion + Couro & Estilo'
  );
  console.log(
    '  2. Search "fone bluetooth" from any non-eletronicos merchant → finds Tech House'
  );
  console.log(
    '  3. Search "yoga" from any non-esportes merchant → finds SportFit Brasil'
  );
  console.log(
    '  4. Cross-category: any merchant searching any keyword finds relevant partner products'
  );
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
