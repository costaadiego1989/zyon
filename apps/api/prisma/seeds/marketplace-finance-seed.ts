import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

process.env.DATABASE_URL ??=
  'postgresql://atendeai:atendeai_dev@localhost:5434/aacp_dev?schema=public';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const MERCHANT_IDS = Array.from(
  { length: 10 },
  (_, i) => `mrc_marketplace_${String(i + 1).padStart(2, '0')}`,
);

const BRAZILIAN_BUYERS = [
  { name: 'Marina Silva', email: 'marina.silva@gmail.com', cpf: '111.444.777-35' },
  { name: 'João Pedro Souza', email: 'joao.p.souza@outlook.com', cpf: '529.982.247-25' },
  { name: 'Camila Rocha', email: 'camila.rocha@yahoo.com.br', cpf: '390.533.447-05' },
  { name: 'Rafael Mendes', email: 'rafael.mendes@uol.com.br', cpf: '146.798.234-09' },
  { name: 'Beatriz Almeida', email: 'beatriz.almeida@gmail.com', cpf: '712.954.823-60' },
  { name: 'Lucas Ferreira', email: 'lucas.ferreira@bol.com.br', cpf: '258.369.147-11' },
  { name: 'Fernanda Lima', email: 'fernanda.lima@gmail.com', cpf: '841.625.937-40' },
  { name: 'Carlos Eduardo', email: 'carlos.edu@terra.com.br', cpf: '657.483.129-22' },
];

const SELLER_DEBTS: Array<{ sellerIdx: number; amountCents: number; status: string; resolvedDaysAgo?: number }> = [
  { sellerIdx: 6, amountCents: 32000, status: 'outstanding' },
  { sellerIdx: 3, amountCents: 15750, status: 'resolved', resolvedDaysAgo: 4 },
];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function seed() {
  console.log('🌱 Seeding marketplace finance data...');

  // Existing-marketplace merchant sanity check
  const existing = await prisma.merchant.findMany({
    where: { id: { in: MERCHANT_IDS } },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  if (existing.length < 4) {
    throw new Error(
      `Need ≥4 marketplace merchants from base seed (found ${existing.length}). Run seed:marketplace first.`,
    );
  }
  const merchantIds = existing.map((m) => m.id);
  console.log(`  Using ${merchantIds.length} merchants from base seed.`);

  // ---- 1. Cross-store orders (line items, multi-seller) ----
  // 5 orders; each order has 1-3 line items; each line item = 1 seller.
  type OrderSpec = {
    orderId: string;
    hostMerchantId: string;
    buyerIdx: number;
    lineItems: Array<{ sellerIdx: number; federatedProductId: string; unitPriceCents: number; commissionRateBps: number; quantity: number }>;
  };

  // Pick any existing federated products per order to keep FK-less but realistic.
  const federatedSample = await prisma.federatedProduct.findMany({
    where: { sourceMerchantId: { in: merchantIds } },
    select: {
      id: true,
      sourceMerchantId: true,
      sourceProductId: true,
      priceCents: true,
    },
    orderBy: { sourceMerchantId: 'asc' },
  });

  // Index by merchantId for quick lookup
  const byMerchant = new Map<string, typeof federatedSample>();
  for (const fp of federatedSample) {
    const arr = byMerchant.get(fp.sourceMerchantId) ?? [];
    arr.push(fp);
    byMerchant.set(fp.sourceMerchantId, arr);
  }

  const orderSpecs: OrderSpec[] = [];
  // Order 1: host = mrc_marketplace_01, 2 line items from sellers
  // Order 2: host = mrc_marketplace_03, 3 line items
  // Order 3: host = mrc_marketplace_05, 2 line items
  // Order 4: host = mrc_marketplace_07, 2 line items (one is chargeback'd later)
  // Order 5: host = mrc_marketplace_02, 1 line item (pending return window)
  const orderBlueprints = [
    { idx: 0, lines: [1, 2] },
    { idx: 2, lines: [3, 4, 5] },
    { idx: 4, lines: [6, 7] },
    { idx: 6, lines: [8, 9] },
    { idx: 1, lines: [9] },
  ];

  for (let o = 0; o < orderBlueprints.length; o++) {
    const bp = orderBlueprints[o];
    const host = merchantIds[bp.idx];
    const orderId = `mkt_order_${String(o + 1).padStart(3, '0')}`;
    const buyer = BRAZIL_BUYERS[o % BRAZIL_BUYERS.length];

    const lineItems = bp.lines.map((sellerIdxSlot, liIdx) => {
      // Pick seller merchant distinct from host
      let seller = merchantIds[(bp.idx + sellerIdxSlot + 1) % merchantIds.length];
      if (seller === host) seller = merchantIds[(bp.idx + 2) % merchantIds.length];

      const fpList = byMerchant.get(seller) ?? [];
      const fp = fpList[liIdx % Math.max(fpList.length, 1)];
      const commissionRateBps = 1200 + ((o + liIdx) % 8) * 100; // 12% - 19%
      const unitPriceCents = fp?.priceCents ?? 19900;
      const quantity = 1 + ((o + liIdx) % 3);

      return {
        sellerMerchantId: seller,
        federatedProductId: fp?.id ?? `fp_seed_${seller}_${liIdx}`,
        unitPriceCents,
        commissionRateBps,
        quantity,
      };
    });

    orderSpecs.push({
      orderId,
      hostMerchantId: host,
      buyerIdx: o % BRAZIL_BUYERS.length,
      lineItems,
    });

    // Insert line items
    for (let li = 0; li < lineItems.length; li++) {
      const liSpec = lineItems[li];
      const lineId = `${orderId}_li_${li + 1}`;
      const commissionCents = Math.round((liSpec.unitPriceCents * liSpec.commissionRateBps) / 10000);
      const sellerNetCents = liSpec.unitPriceCents - commissionCents;
      const totalAmountCents = liSpec.unitPriceCents * liSpec.quantity;

      await prisma.crossStoreLineItem.upsert({
        where: { id: lineId },
        create: {
          id: lineId,
          checkoutSessionId: `${orderId}_session`,
          orderId,
          hostMerchantId: liSpec.sellerMerchantId === orderSpecs[o]?.hostMerchantId ? merchantIds[(bp.idx + 5) % merchantIds.length] : orderSpecs[o]!.hostMerchantId,
          sellerMerchantId: liSpec.sellerMerchantId,
          federatedProductId: liSpec.federatedProductId,
          quantity: liSpec.quantity,
          unitPriceCents: liSpec.unitPriceCents,
          commissionRateBps: liSpec.commissionRateBps,
          commissionCents,
          sellerNetCents,
          fulfillmentStatus:
            li === 0 ? 'fulfilled' : li === 1 ? 'shipped' : 'pending',
          fulfillmentReference: li === 0 ? `ME${100000 + o}` : null,
        },
        update: {},
      });
      // Reference buyer only via session id metadata (no FK); no-op.
      void buyer;
    }
  }
  console.log(`  Created ${orderSpecs.length} orders (${orderSpecs.reduce((s, o) => s + o.lineItems.length, 0)} cross-store line items).`);

  // ---- 2. Settlements (mixed statuses) ----
  // For each line item we will create one settlement row.
  // Status variety plan:
  //   - 2 awaiting_return_window (fresh)
  //   - 1 awaiting_chargeback_window (return window passed)
  //   - 1 transfer_scheduled
  //   - 1 transferred (finalized)
  //   - 1 chargeback_filed (will be linked to dispute below)
  //   - 1 chargeback_resolved
  type SettlementSpec = {
    id: string;
    orderId: string;
    lineItemId: string;
    hostMerchantId: string;
    sellerMerchantId: string;
    totalAmountCents: number;
    commissionCents: number;
    sellerNetCents: number;
    status: string;
    returnWindowUntil: Date;
    transferScheduledAt?: Date | null;
    chargebackWindowUntil: Date;
    transferredAt?: Date | null;
    finalizedAt?: Date | null;
    chargebackAt?: Date | null;
    returnAt?: Date | null;
    providerTransferId?: string | null;
  };

  const allLineItems = await prisma.crossStoreLineItem.findMany({
    where: { orderId: { in: orderSpecs.map((o) => o.orderId) } },
    orderBy: [{ orderId: 'asc' }, { id: 'asc' }],
  });

  const settlements: SettlementSpec[] = [];
  for (let i = 0; i < allLineItems.length; i++) {
    const li = allLineItems[i];
    const orderSpec = orderSpecs.find((o) => o.orderId === li.orderId)!;
    const liSpec = orderSpec.lineItems.find((l) => l.federatedProductId === li.federatedProductId);
    if (!liSpec) continue;

    const total = li.unitPriceCents * li.quantity;
    const commission = Math.round((total * li.commissionRateBps) / 10000);
    const sellerNet = total - commission;

    let status: string;
    let returnWindowUntil: Date;
    let chargebackWindowUntil: Date;
    let transferredAt: Date | null = null;
    let finalizedAt: Date | null = null;
    let chargebackAt: Date | null = null;
    let transferScheduledAt: Date | null = null;
    let providerTransferId: string | null = null;
    let returnAt: Date | null = null;

    if (i < 2) {
      // Fresh: still in return window
      status = 'awaiting_return_window';
      returnWindowUntil = daysFromNow(7 - i);
      chargebackWindowUntil = daysFromNow(30 - i);
    } else if (i === 2) {
      // Return window passed, in chargeback window
      status = 'awaiting_chargeback_window';
      returnWindowUntil = daysFromNow(-1);
      chargebackWindowUntil = daysFromNow(15);
    } else if (i === 3) {
      // transfer scheduled in future
      status = 'transfer_scheduled';
      returnWindowUntil = daysFromNow(-5);
      chargebackWindowUntil = daysFromNow(10);
      transferScheduledAt = daysFromNow(3);
    } else if (i === 4) {
      // transferred
      status = 'transferred';
      returnWindowUntil = daysFromNow(-10);
      chargebackWindowUntil = daysFromNow(5);
      transferredAt = daysFromNow(-2);
      finalizedAt = daysFromNow(-2);
      transferScheduledAt = daysFromNow(-2);
      providerTransferId = `stripe_tr_${1000 + i}`;
    } else if (i === 5) {
      // chargeback_filed (open dispute)
      status = 'chargeback_filed';
      returnWindowUntil = daysFromNow(-12);
      chargebackWindowUntil = daysFromNow(-1);
      chargebackAt = daysFromNow(-1);
    } else if (i === 6) {
      // chargeback_resolved in seller's favor
      status = 'chargeback_resolved';
      returnWindowUntil = daysFromNow(-20);
      chargebackWindowUntil = daysFromNow(-5);
      chargebackAt = daysFromNow(-7);
      transferredAt = daysFromNow(-3);
      finalizedAt = daysFromNow(-3);
      transferScheduledAt = daysFromNow(-3);
      providerTransferId = `stripe_tr_${1000 + i}`;
    } else {
      // additional items default to awaiting_return_window
      status = 'awaiting_return_window';
      returnWindowUntil = daysFromNow(7);
      chargebackWindowUntil = daysFromNow(30);
    }

    settlements.push({
      id: `stl_${li.id}`,
      orderId: li.orderId!,
      lineItemId: li.id,
      hostMerchantId: orderSpec.hostMerchantId,
      sellerMerchantId: li.sellerMerchantId,
      totalAmountCents: total,
      commissionCents: commission,
      sellerNetCents: sellerNet,
      status,
      returnWindowUntil,
      transferScheduledAt,
      chargebackWindowUntil,
      transferredAt,
      finalizedAt,
      chargebackAt,
      returnAt,
      providerTransferId,
    });
  }

  // Insert settlements (delete-and-recreate per id for idempotency)
  for (const s of settlements) {
    await prisma.marketplaceSettlement.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        hostMerchantId: s.hostMerchantId,
        sellerMerchantId: s.sellerMerchantId,
        orderId: s.orderId,
        lineItemId: s.lineItemId,
        totalAmountCents: s.totalAmountCents,
        commissionCents: s.commissionCents,
        sellerNetCents: s.sellerNetCents,
        status: s.status,
        returnWindowUntil: s.returnWindowUntil,
        transferScheduledAt: s.transferScheduledAt,
        chargebackWindowUntil: s.chargebackWindowUntil,
        transferredAt: s.transferredAt,
        finalizedAt: s.finalizedAt,
        chargebackAt: s.chargebackAt,
        returnAt: s.returnAt,
        providerTransferId: s.providerTransferId,
      },
      update: {
        status: s.status,
        transferredAt: s.transferredAt,
        finalizedAt: s.finalizedAt,
        chargebackAt: s.chargebackAt,
        transferScheduledAt: s.transferScheduledAt,
        providerTransferId: s.providerTransferId,
      },
    });
  }
  console.log(`  Created ${settlements.length} settlements (varied statuses).`);

  // ---- 3. Seller debts ----
  // Pull the matching settlement ids for each debt scenario
  const settlementsBySeller = new Map<string, typeof settlements>();
  for (const s of settlements) {
    const arr = settlementsBySeller.get(s.sellerMerchantId) ?? [];
    arr.push(s);
    settlementsBySeller.set(s.sellerMerchantId, arr);
  }
  let debtCount = 0;
  for (const spec of SELLER_DEBTS) {
    const sellerId = merchantIds[spec.sellerIdx];
    const candidates = settlementsBySeller.get(sellerId) ?? [];
    if (!candidates.length) continue;
    const s = candidates[0];
    await prisma.marketplaceSellerDebt.upsert({
      where: { id: `debt_${s.id}` },
      create: {
        id: `debt_${s.id}`,
        sellerMerchantId: sellerId,
        settlementId: s.id,
        amountCents: spec.amountCents,
        status: spec.status,
        resolvedAt: spec.resolvedDaysAgo != null ? daysFromNow(-spec.resolvedDaysAgo) : null,
      },
      update: {
        status: spec.status,
        resolvedAt: spec.resolvedDaysAgo != null ? daysFromNow(-spec.resolvedDaysAgo) : null,
      },
    });
    debtCount++;
  }
  console.log(`  Created ${debtCount} seller debts.`);

  // ---- 4. Blocked merchant relationships ----
  // MarketplaceConfig.blockedMerchants is the schema-level mechanism for blocking.
  // Pick 2 host merchants and add a couple of partner merchants to their blocklist.
  const blockedTargets: Array<{ hostIdx: number; blocked: number[]; reason: string }> = [
    {
      hostIdx: 0,
      blocked: [5, 7],
      reason: 'fraude_repetida: chargebacks acima do limite',
    },
    {
      hostIdx: 3,
      blocked: [8],
      reason: 'categoria_fora_da_vitrine',
    },
  ];

  for (const b of blockedTargets) {
    const hostId = merchantIds[b.hostIdx];
    const blockedIds = b.blocked.map((i) => merchantIds[i]);
    await prisma.marketplaceConfig.update({
      where: { merchantId: hostId },
      data: { blockedMerchants: blockedIds },
    });
    void b.reason; // Reason kept for narrative; not persisted in current schema.
  }
  console.log(
    `  Blocked merchant relationships: 2 hosts blocked ${blockedTargets
      .map((b) => `${b.blocked.length} partner(s)`)
      .join(', ')}.`,
  );

  // ---- Summary ----
  const counts = {
    orders: orderSpecs.length,
    lineItems: await prisma.crossStoreLineItem.count({
      where: { orderId: { in: orderSpecs.map((o) => o.orderId) } },
    }),
    settlements: await prisma.marketplaceSettlement.count({
      where: { id: { startsWith: 'stl_' } },
    }),
    debts: await prisma.marketplaceSellerDebt.count({
      where: { id: { startsWith: 'debt_' } },
    }),
    blockedHosts: blockedTargets.length,
  };
  console.log('\n✅ Marketplace finance seed complete:');
  console.log(`   Orders:          ${counts.orders}`);
  console.log(`   Line items:      ${counts.lineItems}`);
  console.log(`   Settlements:     ${counts.settlements}`);
  console.log(`   Chargebacks:     ${settlements.filter((s) => s.status === 'chargeback_filed' || s.status === 'chargeback_resolved').length}`);
  console.log(`   Seller debts:    ${counts.debts}`);
  console.log(`   Blocked hosts:   ${counts.blockedHosts}`);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
