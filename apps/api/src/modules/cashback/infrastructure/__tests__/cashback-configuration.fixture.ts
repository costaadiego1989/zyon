import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import type { CashbackRules } from "@zyon/shared-types";
import { CashbackRepository } from "../cashback.repository.js";
import { CashbackService } from "../../application/cashback.service.js";
import { CashbackQueriesService } from "../../application/cashback-queries.service.js";

export const configurationRules: CashbackRules = {
  earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null,
  monthlyBudgetCents: 100000, releaseTrigger: "payment_confirmed", releaseDelayDays: 0, expiryDays: null,
  minimumRedeemOrderCents: 0, maximumRedeemBps: 2000, maximumRedeemCents: null, allowWithDiscounts: true,
  combination: { allowCoupons: true, allowAdvancedRules: false, limitMode: "respect_general", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null },
  terms: "Crédito promocional para novas compras nesta loja, conforme as regras revisadas.",
};

/** A fresh schema on the dedicated local QA database; never reads project .env. */
export async function cashbackConfigurationFixture() {
  const databaseUrl = "postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback";
  const schema = `cashback_config_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}"`);
  await db.query(`CREATE TABLE merchant_rules(merchant_id TEXT PRIMARY KEY,max_discount_percent NUMERIC,minimum_margin_percent NUMERIC);
    CREATE TABLE buyer_accounts(global_user_id TEXT PRIMARY KEY,display_name TEXT,email TEXT);
    CREATE TABLE payment_intents(id TEXT PRIMARY KEY,merchant_id TEXT,session_id TEXT,idempotency_key TEXT,status TEXT,amount_cents INTEGER,amount_breakdown JSONB);`);
  await db.query(await readFile(new URL("../../../../../prisma/migrations/20261114120000_cashback/migration.sql", import.meta.url), "utf8"));
  const prisma = new PrismaClient({ datasources: { db: { url: `${databaseUrl}?schema=${schema}` } } });
  const repository = new CashbackRepository(prisma);
  const service = new CashbackService(repository);
  const queries = new CashbackQueriesService(repository, service);
  return {
    db, prisma, repository, service, queries,
    program: (merchantId = "merchant-a") => service.getProgram(merchantId, { includeConfigurationRevision: true, includeGeneralCap: true }),
    async reset() {
      await db.query(`TRUNCATE cashback_refund_operations,cashback_buyer_aliases,cashback_event_receipts,cashback_earning_quotes,cashback_budget_periods,cashback_ledger_entries,cashback_reservations,cashback_grants,cashback_wallets,cashback_rule_versions,cashback_programs,merchant_rules,buyer_accounts,payment_intents CASCADE`);
    },
    async close() {
      await prisma.$disconnect();
      if (!/^cashback_config_\d+_[a-f0-9]{32}$/.test(schema)) throw Error("unsafe_test_schema");
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.end();
    },
  };
}
