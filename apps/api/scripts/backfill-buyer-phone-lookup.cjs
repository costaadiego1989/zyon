// Adds only a keyed lookup index; encrypted phones and account identity stay intact.
// Execute after the additive deploy migration. Logs contain aggregate counts only.
(async () => {
  const { PrismaClient } = require('@prisma/client');
  const { buyerPhoneLookupHash, decryptPii, isPiiEncrypted } = require('../dist/shared/crypto/pii-cipher.service.js');
  const prisma = new PrismaClient(); const counts = { scanned: 0, indexed: 0, skipped: 0 };
  try {
    let cursor;
    while (true) {
      const rows = await prisma.buyerAccount.findMany({ where: { phoneLookupHash: null, phone: { not: null }, ...(cursor ? { globalUserId: { gt: cursor } } : {}) },
        orderBy: { globalUserId: 'asc' }, take: 100,
        select: { globalUserId: true, phone: true } });
      if (!rows.length) break;
      for (const row of rows) {
        counts.scanned++;
        const phone = isPiiEncrypted(row.phone) ? decryptPii(row.phone) : row.phone;
        const hash = buyerPhoneLookupHash(phone);
        if (!hash) { counts.skipped++; continue; }
        // Do not index a phone that changed concurrently.
        counts.indexed += (await prisma.buyerAccount.updateMany({ where: { globalUserId: row.globalUserId, phone: row.phone, phoneLookupHash: null }, data: { phoneLookupHash: hash } })).count;
      }
      cursor = rows.at(-1).globalUserId;
    }
    console.log('BUYER_PHONE_LOOKUP_BACKFILL=' + JSON.stringify(counts));
  } finally { await prisma.$disconnect(); }
})().catch(error => { console.error('buyer_phone_lookup_backfill_failed:' + error.name); process.exit(1); });
