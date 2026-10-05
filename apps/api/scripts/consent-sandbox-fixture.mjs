import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';

if (process.env.RAILWAY_ENVIRONMENT_ID !== 'a347216c-86e3-4a75-8d73-5ae6e122408c') {
  throw new Error('consent_fixture_requires_railway_sandbox');
}
const prisma = new PrismaClient();
try {
  const action = process.argv[2];
  if (action === 'seed') {
    const password = randomBytes(24).toString('base64url');
    const salt = randomBytes(16).toString('base64url');
    const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString('base64url')}`;
    const globalUserId = `consent_qa_${randomUUID().replaceAll('-', '')}`;
    const email = `${globalUserId}@example.invalid`;
    await prisma.buyerAccount.create({ data: { globalUserId, email, passwordHash, displayName: 'Consentimento Teste' } });
    // Capture this output privately in the validation process; never log credentials.
    process.stdout.write(JSON.stringify({ globalUserId, email, password }));
  } else if (action === 'cleanup') {
    const globalUserId = process.argv[3];
    if (!/^consent_qa_[a-f0-9]{32}$/.test(globalUserId ?? '')) throw new Error('invalid_consent_fixture_id');
    await prisma.campaignContactConsent.deleteMany({ where: { globalUserId } });
    await prisma.buyerAccount.deleteMany({ where: { globalUserId, email: `${globalUserId}@example.invalid` } });
    process.stdout.write(JSON.stringify({ cleaned: true }));
  } else throw new Error('invalid_consent_fixture_action');
} finally { await prisma.$disconnect(); }
