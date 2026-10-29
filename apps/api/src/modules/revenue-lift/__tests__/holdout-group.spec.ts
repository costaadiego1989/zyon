import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HoldoutGroupService } from "../domain/services/holdout-group.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string) {
  // Try dist first, then fallback to src
  let path = join(__dirname, "..", "__fixtures__", name);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    // Fallback to src directory (from dist/modules/revenue-lift/__tests__ → ../../../../src/modules/revenue-lift/__fixtures__)
    path = join(__dirname, "..", "..", "..", "..", "src", "modules", "revenue-lift", "__fixtures__", name);
    return JSON.parse(readFileSync(path, "utf-8"));
  }
}

test("HoldoutGroupService — SHA256 determinism", async (t) => {
  const service = new HoldoutGroupService();

  await t.test("H1/H3: same global_user_id + merchant_id → SAME cohort every time (100x)", () => {
    const userId = "user_determinism_test_1";
    const merchantId = "merchant_xyz";
    const first = service.assignCohort(userId, merchantId);
    for (let i = 0; i < 99; i++) {
      assert.equal(
        service.assignCohort(userId, merchantId),
        first,
        `Run ${i + 2} differs from first assignment`,
      );
    }
  });

  await t.test("H4: 1000 random users → ~5% holdout (within 3%-7% tolerance)", () => {
    let holdoutCount = 0;
    const merchantId = "merchant_distribution_test";
    for (let i = 0; i < 1000; i++) {
      const id = `user_dist_${i}_${Date.now()}`;
      if (service.assignCohort(id, merchantId) === "holdout") {
        holdoutCount++;
      }
    }
    const rate = holdoutCount / 1000;
    assert.ok(
      rate >= 0.03,
      `holdout rate ${(rate * 100).toFixed(1)}% below 3% minimum`,
    );
    assert.ok(
      rate <= 0.07,
      `holdout rate ${(rate * 100).toFixed(1)}% above 7% maximum`,
    );
  });

  await t.test("H2: salt is the literal constant 'holdout_salt_v1' — golden hash vectors", () => {
    const fixture = loadFixture("golden-hash-vectors.json");
    for (const v of fixture.vectors) {
      const cohort = service.assignCohort(v.globalUserId, v.merchantId);
      assert.equal(
        cohort,
        v.expectedCohort,
        `Mismatch on ${v.globalUserId}+${v.merchantId}: got '${cohort}', expected '${v.expectedCohort}' (bucket=${v.expectedBucket}). Salt may have changed!`,
      );
    }
  });

  await t.test("H2: salt constant regression — verify via direct hash computation", () => {
    // Independently compute what the service should return.
    // If the salt ever changes, this test fails immediately.
    const userId = "user_find_holdout_9";
    const merchantId = "merchant_test";
    const salt = "holdout_salt_v1";
    const combined = userId + merchantId + salt;
    const hash = createHash("sha256").update(combined).digest("hex");
    const bucket = parseInt(hash.slice(0, 8), 16) % 100;
    const expected = bucket < 5 ? "holdout" : "treatment";

    assert.equal(
      service.assignCohort(userId, merchantId),
      expected,
      `Service result doesn't match direct SHA256 computation with salt '${salt}'`,
    );
    assert.equal(service.getSalt(), salt);
  });

  await t.test("H6: per-merchant — same user, different merchants → may differ (independent)", () => {
    // user_cross_1: treatment on merchant_a, holdout on merchant_b
    const id = "user_cross_1";
    const cohortA = service.assignCohort(id, "merchant_a");
    const cohortB = service.assignCohort(id, "merchant_b");

    // Both must be valid cohort values
    assert.ok(
      ["holdout", "treatment"].includes(cohortA),
      `Invalid cohort for merchant_a: ${cohortA}`,
    );
    assert.ok(
      ["holdout", "treatment"].includes(cohortB),
      `Invalid cohort for merchant_b: ${cohortB}`,
    );

    // Per golden vectors, these should differ — proving per-merchant assignment
    assert.notEqual(
      cohortA,
      cohortB,
      "user_cross_1 should have DIFFERENT cohorts on merchant_a vs merchant_b (composite key proof)",
    );
  });

  await t.test("H6: same user, same merchant → always same (idempotent, not random)", () => {
    const id = "user_idempotent_check";
    const merchantId = "merchant_idem";
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      results.add(service.assignCohort(id, merchantId));
    }
    assert.equal(results.size, 1, "Multiple different results for same input — assignment is not deterministic!");
  });

  await t.test("returns only valid cohort strings", () => {
    for (let i = 0; i < 100; i++) {
      const cohort = service.assignCohort(`user_valid_${i}`, "merchant_valid");
      assert.ok(
        cohort === "holdout" || cohort === "treatment",
        `Invalid cohort value: '${cohort}'`,
      );
    }
  });
});
