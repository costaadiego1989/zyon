import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { PrismaNegotiationStore } from "./prisma-negotiation.store.js";

type LedgerCreateInput = {
  merchantId: string;
  negotiationSessionId: string;
  eventType: string;
  amountCents: number;
  aiCostCents?: number;
  discountBasisPoints?: number;
};

type LedgerCreateCall = LedgerCreateInput & { kind: "create" | "txCreate" };

class FakePrisma {
  calls: LedgerCreateCall[] = [];
  private txCalls: LedgerCreateCall[] = [];

  negotiationSession = {
    create: async ({ data }: any) => ({ id: `ns_${this.calls.length + 1}`, ...data })
  };

  merchantNegotiationPolicy = {
    findUnique: async () => null,
    upsert: async () => undefined
  };

  buyerAgentNegotiationPreference = {
    findUnique: async () => null,
    upsert: async () => undefined
  };

  negotiationCostLedgerEntry = {
    create: async ({ data }: any) => {
      this.calls.push({ kind: "create", ...(data as LedgerCreateInput) });
      return data;
    },
    findFirst: async () => null
  };

  $transaction = async (fn: (tx: FakePrisma) => Promise<unknown>) => {
    // Share storage with the outer prisma so writes land in the same buffer.
    const tx = Object.create(this) as FakePrisma;
    tx.calls = this.calls;
    tx.txCalls = this.txCalls;
    return fn(tx);
  };
}

function newStore(): { prisma: FakePrisma; store: PrismaNegotiationStore } {
  const prisma = new FakePrisma();
  const store = new PrismaNegotiationStore(prisma as unknown as PrismaClient);
  return { prisma, store };
}

test("createNegotiationSessionWithLedger routes cost to aiCostCents (not discountBasisPoints)", async () => {
  const { prisma, store } = newStore();
  const result: any = {
    agreement: true,
    selectedDiscountPercent: 10,
    selectedScope: "global",
    selectedPolicyKeys: ["global"],
    maxRounds: 1,
    estimatedAiCalls: 4,
    estimatedAiCostCents: 12,
    autoAccept: true,
    requiresHumanConfirmation: false,
    audit: []
  };
  await store.createNegotiationSessionWithLedger({
    merchantId: "mrc_1",
    cartFingerprint: "fp",
    result
  });

  assert.equal(prisma.calls.length, 1);
  const entry = prisma.calls[0]!;
  assert.equal(entry.eventType, "negotiation.evaluated");
  assert.equal(entry.amountCents, 12, "legacy amountCents preserved for backward compat");
  assert.equal(entry.aiCostCents, 12, "semantic aiCostCents populated");
  assert.equal(entry.discountBasisPoints, undefined, "must not bleed into discount column");
});

test("applyOfferWithLedger stores basis points in discountBasisPoints (semantic) and amountCents (legacy)", async () => {
  const { prisma, store } = newStore();
  await store.applyOfferWithLedger({
    merchantId: "mrc_1",
    negotiationSessionId: "ns_42",
    checkoutSessionId: "sess_1",
    discountPercent: 15,
    offerData: { id: "off_1" }
  });

  assert.equal(prisma.calls.length, 1);
  const entry = prisma.calls[0]!;
  assert.equal(entry.eventType, "negotiation.offer_applied");
  assert.equal(entry.discountBasisPoints, 1500, "15% → 1500 basis points on semantic column");
  assert.equal(entry.amountCents, 1500, "legacy amountCents mirrors basis points during deprecation window");
  assert.equal(entry.aiCostCents, undefined, "must not bleed into aiCostCents column");
});

test("applyOfferWithLedger rounds fractional discountPercent correctly", async () => {
  const { prisma, store } = newStore();
  await store.applyOfferWithLedger({
    merchantId: "mrc_1",
    negotiationSessionId: "ns_43",
    checkoutSessionId: "sess_2",
    discountPercent: 7.345,
    offerData: { id: "off_2" }
  });
  const entry = prisma.calls[0]!;
  assert.equal(entry.discountBasisPoints, Math.round(7.345 * 100));
  assert.equal(entry.amountCents, Math.round(7.345 * 100));
});

test("appendNegotiationLedgerEntry routes by eventType to the correct semantic column", async () => {
  const { prisma, store } = newStore();

  await store.appendNegotiationLedgerEntry({
    merchantId: "mrc_1",
    negotiationSessionId: "ns_a",
    eventType: "negotiation.evaluated",
    amountCents: 8
  });
  await store.appendNegotiationLedgerEntry({
    merchantId: "mrc_1",
    negotiationSessionId: "ns_b",
    eventType: "negotiation.offer_applied",
    amountCents: 500
  });
  await store.appendNegotiationLedgerEntry({
    merchantId: "mrc_1",
    negotiationSessionId: "ns_c",
    eventType: "negotiation.something_else",
    amountCents: 42
  });

  assert.equal(prisma.calls.length, 3);
  const [evaluated, applied, other] = prisma.calls;
  assert.equal(evaluated?.aiCostCents, 8);
  assert.equal(evaluated?.discountBasisPoints, undefined);
  assert.equal(applied?.discountBasisPoints, 500);
  assert.equal(applied?.aiCostCents, undefined);
  assert.equal(other?.aiCostCents, undefined);
  assert.equal(other?.discountBasisPoints, undefined);
  assert.equal(other?.amountCents, 42);
});

test("applyOfferWithLedger is idempotent — second call does not write a second ledger entry", async () => {
  const { prisma, store } = newStore();
  const input = {
    merchantId: "mrc_1",
    negotiationSessionId: "ns_idem",
    checkoutSessionId: "sess_x",
    discountPercent: 10,
    offerData: { id: "off_idem" }
  };
  const first = await store.applyOfferWithLedger(input);
  const second = await store.applyOfferWithLedger(input);

  assert.equal(first.alreadyApplied, false);
  assert.equal(second.alreadyApplied, true);
  assert.equal(second.offerId, "off_idem");
  assert.equal(prisma.calls.length, 1, "only one ledger row written across both calls");
});