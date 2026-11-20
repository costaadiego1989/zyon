import { PrismaClient } from "@prisma/client";
import { PrismaFiscalIssuanceStore } from "../src/modules/fiscal/infrastructure/prisma-fiscal-issuance.store.js";
import { PrismaFiscalRepository } from "../src/modules/fiscal/infrastructure/prisma-fiscal.repository.js";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.FISCAL_WORKER_DATABASE_URL! } } });
try {
  const repo = new PrismaFiscalRepository(prisma);
  const input = JSON.parse(process.argv[3]!);
  const begin = async () => {
    try { return await (await new PrismaFiscalIssuanceStore(prisma).open(input.claim)).journal.begin(input.record); }
    catch (error) { if (error instanceof Error && error.message === "fiscal_claim_lost") return false; throw error; }
  };
  const result = process.argv[2] === "stage.begin" ? await begin() : process.argv[2] === "create" ? await repo.createIntent(input.data, input.actor)
    : await repo.claim(input.scope, new Date(input.now), input.leaseMs);
  process.stdout.write(JSON.stringify(result));
} finally { await prisma.$disconnect(); }
