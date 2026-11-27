import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
await import('./cashback-release-candidate-environment.mjs');
const { PrismaClient } = await import('@prisma/client');
const { PrismaAuthRepository } = await import('../dist/modules/auth/infrastructure/prisma-auth.repository.js');
const { JwtService } = await import('../dist/modules/auth/domain/services/jwt.service.js');
const { BuyerJwtService } = await import('../dist/modules/buyer-account/domain/services/buyer-jwt.service.js');
const { EmbedTokenService } = await import('../dist/modules/embed/domain/embed-token.service.js');
const evidence = new URL('file:///C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence/');
const manifest = JSON.parse(readFileSync(new URL('candidate-compiled-seed-manifest.json', evidence), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
try {
  const auth = new JwtService(undefined, undefined, new PrismaAuthRepository(prisma));
  const buyerJwt = new BuyerJwtService();
  const embedJwt = new EmbedTokenService();
  const ownerTokens = {};
  for (const merchant of manifest.merchants) {
    const user = await prisma.merchantUser.findUniqueOrThrow({ where: { id: merchant.ownerId } });
    ownerTokens[merchant.id] = await auth.issue({ userId: user.id, merchantId: merchant.id, email: user.email, role: 'owner' }, user.authVersion);
  }
  const first = manifest.cases.find(item => item.key === 'specific-100-10-5-cash');
  const foreign = manifest.cases.find(item => item.key === 'isolation');
  const staff = await prisma.merchantUser.findUniqueOrThrow({ where: { id: 'qa-cashback-v1-staff-specific' } });
  const buyer = manifest.buyers[0];
  const origin = 'http://127.0.0.1:5193';
  const signEmbed = (item, scopes, allowedOrigin = origin) => embedJwt.sign({ typ: 'aacp_embed_v1', merchantId: item.merchantId,
    nonce: item.embedNonce, issuedAtUnix: Math.floor(Date.now() / 1000), expiresAtUnix: Math.floor(Date.now() / 1000) + 7200,
    allowedOrigin, scopes });
  const writeScopes = ['payment:intents:read', 'offers:apply', 'coupons:apply', 'checkout:track', 'checkout:chat', 'checkout:start'];
  const tokens = {
    owner: ownerTokens[first.merchantId],
    staff: await auth.issue({ userId: staff.id, merchantId: first.merchantId, email: staff.email, role: 'staff' }, staff.authVersion),
    buyer: buyerJwt.sign({ globalUserId: buyer.id, email: buyer.email, merchantId: first.merchantId }),
    buyerOtherTenant: buyerJwt.sign({ globalUserId: buyer.id, email: buyer.email, merchantId: foreign.merchantId }),
    embedReadOnly: signEmbed(first, ['payment:intents:read']), embedOtherTenant: signEmbed(foreign, writeScopes),
    embedWidget: signEmbed(first, writeScopes, 'http://127.0.0.1:5194'),
    embedStorefront: signEmbed(first, writeScopes, 'http://127.0.0.1:13151'),
  };
  const result = { environment: 'local', baseUrl: 'http://127.0.0.1:13150/v1', origin,
    ids: { merchantId: first.merchantId, foreignMerchantId: foreign.merchantId, buyerId: buyer.id, sessionId: first.sessionId, foreignSessionId: foreign.sessionId },
    tokens, ownerTokens, caseTokens: Object.fromEntries(manifest.cases.map(item => [item.key, signEmbed(item, writeScopes)])),
    buyerTokens: Object.fromEntries(manifest.merchants.map(merchant => [merchant.id, buyerJwt.sign({ globalUserId: buyer.id, email: buyer.email, merchantId: merchant.id })])) };
  const output = new URL('candidate-auth.private.json', evidence);
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ generated: true, merchantSessions: Object.keys(ownerTokens).length + 1, output: fileURLToPath(output), tokensPrinted: false }));
} finally { await prisma.$disconnect(); }
