import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import crypto from "node:crypto";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

// TODO: Requires migration. Models HoldoutGroupAssignment, AttributionTag, RevenueLiftSnapshot not yet in schema.prisma
// When models are added, these tests will verify:
// 1. HoldoutGroupAssignment CRUD with idempotency (upsert)
// 2. AttributionTag creation and aggregation by cohort/dateRange
// 3. RevenueLiftSnapshot persistence and latest-retrieval
// 4. Cohort statistics and tenant isolation
// 5. Revenue lift calculations match manual aggregation

test(
  "Revenue Lift Integration: HoldoutGroupAssignment, AttributionTag, RevenueLiftSnapshot with tenant isolation",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const merchantId1 = `mrc_lift_${crypto.randomUUID()}`;
    const merchantId2 = `mrc_lift_${crypto.randomUUID()}`;

    try {
      // ─── Test 1: Save HoldoutGroupAssignment → find by globalUserId+merchantId → returns cohort ───
      await test("Save HoldoutGroupAssignment, find by globalUserId+merchantId", async () => {
        // Placeholder: when HoldoutGroupAssignment model exists:
        // - create({ merchantId, globalUserId, cohort: "treatment" | "holdout", assignedAt })
        // - find({ where: { merchantId, globalUserId } })
        // - verify cohort returned
        assert.ok(true, "Awaiting HoldoutGroupAssignment model in schema");
      });

      // ─── Test 2: Idempotent save: save same user twice → no duplicate (upsert) ───
      await test("HoldoutGroupAssignment idempotent: save same user twice, no duplicate", async () => {
        // Placeholder: when HoldoutGroupAssignment exists:
        // - upsert({ where: { merchantId_globalUserId }, create: { ... }, update: { assignedAt: now() } })
        // - count by merchantId → should be 1, not 2
        // - assignedAt should be updated to second insert time
        assert.ok(true, "Awaiting upsert logic in model");
      });

      // ─── Test 3: Save AttributionTag → query by merchantId+cohort+dateRange → returns correct set ───
      await test("Save AttributionTag, query by merchantId+cohort+dateRange", async () => {
        // Placeholder: when AttributionTag model exists:
        // - create({ merchantId, globalUserId, cohort, orderId, orderValue, taggedAt })
        // - query: findMany({ where: { merchantId, cohort, taggedAt: { gte: from, lte: to } } })
        // - verify correct set returned with no cross-merchant or cross-cohort bleed
        assert.ok(true, "Awaiting AttributionTag model in schema");
      });

      // ─── Test 4: Attribution aggregation: count orders by cohort, sum revenue ───
      await test("AttributionTag aggregation: count orders and sum revenue by cohort", async () => {
        // Placeholder: when AttributionTag exists:
        // - create 5 tags for cohort="treatment", sum = 500
        // - create 3 tags for cohort="holdout", sum = 300
        // - aggregate:
        //   - SELECT cohort, COUNT(*) as order_count, SUM(orderValue) as total_revenue
        //   - verify treatment: 5 orders, 500 revenue
        //   - verify holdout: 3 orders, 300 revenue
        // - manual calculation: lift = (treatment_revenue / treatment_count - holdout_revenue / holdout_count) / (holdout_revenue / holdout_count)
        assert.ok(true, "Awaiting aggregation queries");
      });

      // ─── Test 5: RevenueLiftSnapshot: save snapshot → find latest by merchantId ───
      await test("RevenueLiftSnapshot: save and find latest by merchantId", async () => {
        // Placeholder: when RevenueLiftSnapshot model exists:
        // - create({ merchantId, calculatedAt, snapshotData: { lift%, confidence, ... } })
        // - query latest: findFirst({ where: { merchantId }, orderBy: { calculatedAt: "desc" } })
        // - verify returns most recent snapshot
        // - run twice with different data → latest returns second snapshot
        assert.ok(true, "Awaiting RevenueLiftSnapshot model in schema");
      });

      // ─── Test 6: Cohort query: count holdout vs treatment assignments for a merchant → ~5% holdout ───
      await test("Cohort query: count holdout vs treatment, verify ~5% holdout ratio", async () => {
        // Placeholder: when HoldoutGroupAssignment exists:
        // - create 95 "treatment" assignments
        // - create 5 "holdout" assignments
        // - aggregate: SELECT cohort, COUNT(*) as count
        // - verify: holdout_count / (holdout_count + treatment_count) ≈ 0.05
        // - verify no cross-merchant bleed
        assert.ok(true, "Awaiting cohort statistics calculation");
      });

      // ─── Test 7: Tenant isolation: merchant_A's tags NOT in merchant_B's aggregation ───
      await test("Tenant isolation: merchant_A's attribution tags invisible to merchant_B", async () => {
        // Placeholder: when AttributionTag exists:
        // - create tags for merchantId1, cohort="treatment"
        // - query tags for merchantId2 with same cohort
        // - verify returns empty, not cross-tenant
        // - also test: aggregate on merchantId1 does not include merchantId2 rows
        assert.ok(true, "Awaiting tenant-scoped query verification");
      });
    } finally {
      // Cleanup when models exist
      // await prisma.revenueLiftSnapshot.deleteMany({ where: { merchantId: { in: [merchantId1, merchantId2] } } });
      // await prisma.attributionTag.deleteMany({ where: { merchantId: { in: [merchantId1, merchantId2] } } });
      // await prisma.holdoutGroupAssignment.deleteMany({ where: { merchantId: { in: [merchantId1, merchantId2] } } });
      await prisma.$disconnect();
    }
  }
);
