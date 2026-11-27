import type { PrismaClient, Prisma } from "@prisma/client";
import type { CashbackProgramView, CashbackRules, CheckoutSession } from "@zyon/shared-types";
import type { CashbackOrderLine, Wallet } from "../cashback.js";

export const CASHBACK_REPOSITORY = Symbol("CASHBACK_REPOSITORY");
export type CashbackTx = Prisma.TransactionClient;
export interface EarningSnapshot {
  rules: CashbackRules | null; ruleVersion: number; earnCents: number; baseCents: number; cashbackCents: number;
  reservationId: string | null; period: string; orderTotalCents: number; lines: CashbackOrderLine[];
  returnedQuantities: Record<string, number>; refundedCashbackCents: number; refundedExternalCents: number;
  externalCapturedCents: number | null; platformFeeCents: number;
  paymentSession: Pick<CheckoutSession, "merchantId" | "sessionId" | "globalUserId" | "cart" | "shipping">;
  combinationContext?: import("../cashback-combination.js").CombinationContext;
}
export interface QuoteRow {
  id: string; merchant_id: string; buyer_id: string; session_id: string; payment_key: string;
  fingerprint: string; state: "prepared" | "bound" | "confirmed" | "failed";
  payment_intent_id: string | null; data: EarningSnapshot; created_at: Date;
}
export interface CashbackRepositoryPort {
  readonly prisma: PrismaClient;
  transaction<T>(merchantId: string, body: (tx: CashbackTx) => Promise<T>): Promise<T>;
  command<T>(tx: CashbackTx, merchantId: string, key: string, input: unknown, body: () => Promise<T>): Promise<T>;
  program(tx: CashbackTx, merchantId: string): Promise<CashbackProgramView>;
  wallet(tx: CashbackTx, merchantId: string, buyerId: string): Promise<Wallet>;
  saveWallet(tx: CashbackTx, wallet: Wallet): Promise<void>;
  quote(tx: CashbackTx, merchantId: string, sessionId: string, paymentKey: string): Promise<QuoteRow | undefined>;
  updateQuote(tx: CashbackTx, quote: QuoteRow): Promise<void>;
}
